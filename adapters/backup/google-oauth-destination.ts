import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import {
  appError,
  ok,
  remoteBackupSchema,
  type AppError,
  type BackupTier,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';
import type {
  BackupConnectionReport,
  BackupDestinationDescription,
  BackupDestinationPort,
  ConfigStore,
  SecretsStore,
} from '@core/server/index.js';

import {
  authorizationHeaders,
  downloadGoogleDriveResponse,
  googleResponseFailure,
  mapGoogleDriveError,
  parseGoogleResponse,
  uploadGoogleDriveFile,
  type GoogleUploadedFile,
} from './google-drive.js';

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_REFRESH_TOKEN_ACCOUNT = 'backup.google.refresh_token';

const BACKUP_FOLDER_NAME = 'AI Video Cataloger Backups';
const DEFAULT_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3';
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
}).passthrough();

const filesSchema = z.object({ files: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()) }).passthrough();
const folderSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
const folderHealthSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trashed: z.boolean(),
}).passthrough();
const aboutSchema = z.object({
  user: z.object({ emailAddress: z.string().min(1) }),
  storageQuota: z.object({ limit: z.string().regex(/^\d+$/).optional(), usage: z.string().regex(/^\d+$/).optional() }),
}).passthrough();
const remoteFilesSchema = z.object({
  files: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    size: z.string().regex(/^\d+$/),
    createdTime: z.iso.datetime(),
    appProperties: z.record(z.string(), z.string()),
  }).passthrough()),
  nextPageToken: z.string().min(1).optional(),
}).passthrough();

export interface GoogleOAuthBackupDestinationOptions {
  config: ConfigStore;
  secrets: SecretsStore;
  clientId: string;
  clientSecret: string;
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch | undefined;
  authorizationUrl?: string | undefined;
  tokenUrl?: string | undefined;
  driveBaseUrl?: string | undefined;
  uploadBaseUrl?: string | undefined;
  authTimeoutMs?: number | undefined;
}

export class GoogleOAuthBackupDestination implements BackupDestinationPort {
  private readonly config: ConfigStore;
  private readonly secrets: SecretsStore;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly authorizationUrl: string;
  private readonly tokenUrl: string;
  private readonly driveBaseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly authTimeoutMs: number;
  private accessToken: string | null = null;

  constructor(options: GoogleOAuthBackupDestinationOptions) {
    this.config = options.config;
    this.secrets = options.secrets;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.openExternal = options.openExternal;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authorizationUrl = options.authorizationUrl ?? DEFAULT_AUTHORIZATION_URL;
    this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.driveBaseUrl = options.driveBaseUrl ?? DEFAULT_DRIVE_BASE_URL;
    this.uploadBaseUrl = options.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL;
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  }

  describe(): Result<BackupDestinationDescription, AppError> {
    return ok({ provider: 'google_oauth', folderName: BACKUP_FOLDER_NAME });
  }

  async connect(signal: AbortSignal): Promise<Result<BackupConnectionReport, AppError>> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const authorization = await receiveAuthorizationCode({
      state,
      signal,
      timeoutMs: this.authTimeoutMs,
      openExternal: this.openExternal,
      authorizationUrl: this.authorizationUrl,
      clientId: this.clientId,
      challenge,
    });
    if (!authorization.ok) return authorization;
    const exchanged = await this.exchangeAuthorizationCode(
      authorization.value.code,
      authorization.value.redirectUri,
      verifier,
      signal,
    );
    if (!exchanged.ok) return exchanged;
    if (exchanged.value.refreshToken === null) {
      return { ok: false, error: appError('backup_auth_required', 'Google did not return a refresh token') };
    }
    const stored = await this.secrets.set(GOOGLE_REFRESH_TOKEN_ACCOUNT, exchanged.value.refreshToken);
    if (!stored.ok) return stored;
    this.accessToken = exchanged.value.accessToken;
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const about = await this.about(signal);
    if (!about.ok) return about;
    if (about.value.accountEmail === null) return destinationSchemaError('account metadata');
    const email = await this.config.set({ kind: 'home' }, 'backup_account_email', about.value.accountEmail);
    if (!email.ok) return email;
    return ok({ ...about.value, folderName: folder.value.name });
  }

  async test(signal: AbortSignal): Promise<Result<BackupConnectionReport, AppError>> {
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const listed = await this.request(filesInFolderUrl(this.driveBaseUrl, folder.value.folderId), {}, signal);
    if (!listed.ok) return listed;
    const parsedList = await parseGoogleResponse(listed.value, filesSchema, 'files.list');
    if (!parsedList.ok) return parsedList;
    const directory = await mkdtemp(path.join(tmpdir(), 'avc-google-test-'));
    const sourcePath = path.join(directory, 'connection-test.bin');
    try {
      await writeFile(sourcePath, Buffer.alloc(1024), { mode: 0o600 });
      const uploaded = await this.uploadFile(folder.value.folderId, sourcePath, 'connection-test.bin', {}, false, signal);
      if (!uploaded.ok) return uploaded;
      const removed = await this.remove(uploaded.value.id, signal);
      if (!removed.ok) return removed;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const about = await this.about(signal);
    if (!about.ok) return about;
    return ok({ ...about.value, folderName: folder.value.name });
  }

  async ensureFolder(signal: AbortSignal): Promise<Result<{ folderId: string; name: string }, AppError>> {
    const configured = await this.config.get({ kind: 'home' }, 'backup_folder_id');
    if (!configured.ok) return configured;
    if (configured.value !== null && configured.value.length > 0) {
      const stored = await this.storedFolder(configured.value, signal);
      if (!stored.ok) return stored;
      if (stored.value !== null) return ok(stored.value);
    }
    const query = new URL(`${this.driveBaseUrl}/files`);
    query.searchParams.set('q', `mimeType='application/vnd.google-apps.folder' and name='${BACKUP_FOLDER_NAME}' and trashed=false`);
    query.searchParams.set('spaces', 'drive');
    query.searchParams.set('fields', 'files(id,name)');
    const listed = await this.request(query.toString(), {}, signal);
    if (!listed.ok) return listed;
    const parsed = await parseGoogleResponse(listed.value, filesSchema, 'folder search');
    if (!parsed.ok) return parsed;
    const existing = parsed.value.files[0];
    const folder = existing === undefined ? await this.createFolder(signal) : ok(existing);
    if (!folder.ok) return folder;
    const stored = await this.config.set({ kind: 'home' }, 'backup_folder_id', folder.value.id);
    if (!stored.ok) return stored;
    return ok({ folderId: folder.value.id, name: folder.value.name });
  }

  private async storedFolder(
    folderId: string,
    signal: AbortSignal,
  ): Promise<Result<{ folderId: string; name: string } | null, AppError>> {
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(folderId)}`);
    url.searchParams.set('fields', 'id,name,trashed');
    const response = await this.request(url.toString(), {}, signal, [404]);
    if (!response.ok) return response;
    if (response.value.status === 404) return ok(null);
    const parsed = await parseGoogleResponse(response.value, folderHealthSchema, 'folder lookup');
    if (!parsed.ok) return parsed;
    if (parsed.value.trashed) return ok(null);
    return ok({ folderId: parsed.value.id, name: parsed.value.name });
  }

  async list(tier: BackupTier | null, signal: AbortSignal): Promise<Result<RemoteBackup[], AppError>> {
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const backups: RemoteBackup[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${this.driveBaseUrl}/files`);
      const tierQuery = tier === null ? '' : ` and appProperties has { key='tier' and value='${tier}' }`;
      url.searchParams.set('q', `'${folder.value.folderId}' in parents and trashed=false${tierQuery}`);
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('orderBy', 'createdTime desc');
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('fields', 'nextPageToken,files(id,name,size,createdTime,appProperties)');
      if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
      const response = await this.request(url.toString(), {}, signal);
      if (!response.ok) return response;
      const parsed = await parseGoogleResponse(response.value, remoteFilesSchema, 'backup list');
      if (!parsed.ok) return parsed;
      for (const file of parsed.value.files) {
        const remote = remoteBackupSchema.safeParse({
          remoteId: file.id,
          name: file.name,
          tier: file.appProperties.tier,
          createdAt: file.appProperties.createdAt ?? file.createdTime,
          sizeBytes: Number(file.size),
          appVersion: file.appProperties.appVersion,
          schemaVersions: {
            globalCatalog: Number(file.appProperties.schemaGlobalCatalog),
            photos: Number(file.appProperties.schemaPhotos),
          },
        });
        if (!remote.success) return destinationSchemaError('backup metadata');
        backups.push(remote.data);
      }
      pageToken = parsed.value.nextPageToken;
    } while (pageToken !== undefined);
    return ok(backups);
  }

  async upload(
    input: Parameters<BackupDestinationPort['upload']>[0],
    signal: AbortSignal,
  ): Promise<Result<RemoteBackup, AppError>> {
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const properties = {
      tier: input.manifest.tier,
      createdAt: input.manifest.createdAt,
      appVersion: input.manifest.appVersion,
      schemaGlobalCatalog: String(input.manifest.schemaVersions.globalCatalog),
      schemaPhotos: String(input.manifest.schemaVersions.photos),
    };
    const uploaded = await this.uploadFile(folder.value.folderId, input.sourcePath, input.name, properties, false, signal);
    if (!uploaded.ok) return uploaded;
    return ok({
      remoteId: uploaded.value.id,
      name: uploaded.value.name,
      tier: input.manifest.tier,
      createdAt: input.manifest.createdAt,
      sizeBytes: uploaded.value.sizeBytes,
      appVersion: input.manifest.appVersion,
      schemaVersions: input.manifest.schemaVersions,
    });
  }

  async download(remoteId: string, destinationPath: string, signal: AbortSignal): Promise<Result<{ sizeBytes: number }, AppError>> {
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(remoteId)}`);
    url.searchParams.set('alt', 'media');
    const response = await this.request(url.toString(), {}, signal);
    if (!response.ok) return response;
    return downloadGoogleDriveResponse(response.value, destinationPath, signal);
  }

  async remove(remoteId: string, signal: AbortSignal): Promise<Result<{ removed: boolean }, AppError>> {
    const response = await this.request(`${this.driveBaseUrl}/files/${encodeURIComponent(remoteId)}`, { method: 'DELETE' }, signal);
    if (!response.ok) return response;
    return ok({ removed: true });
  }

  private async createFolder(signal: AbortSignal): Promise<Result<{ id: string; name: string }, AppError>> {
    const response = await this.request(`${this.driveBaseUrl}/files?fields=id,name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    }, signal);
    if (!response.ok) return response;
    return parseGoogleResponse(response.value, folderSchema, 'folder creation');
  }

  private async about(signal: AbortSignal): Promise<Result<BackupConnectionReport, AppError>> {
    const response = await this.request(`${this.driveBaseUrl}/about?fields=user(emailAddress),storageQuota(limit,usage)`, {}, signal);
    if (!response.ok) return response;
    const parsed = await parseGoogleResponse(response.value, aboutSchema, 'about');
    if (!parsed.ok) return parsed;
    const limit = parsed.value.storageQuota.limit;
    const usage = parsed.value.storageQuota.usage;
    return ok({
      accountEmail: parsed.value.user.emailAddress,
      driveName: null,
      folderName: BACKUP_FOLDER_NAME,
      remainingQuotaBytes: limit === undefined ? null : Math.max(0, Number(limit) - Number(usage ?? '0')),
    });
  }

  private async request(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    acceptedErrorStatuses: readonly number[] = [],
  ): Promise<Result<Response, AppError>> {
    const token = await this.token(signal);
    if (!token.ok) return token;
    let usedToken = token.value;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, headers: mergeHeaders(init.headers, token.value), signal });
      if (response.status === 401) {
        this.accessToken = null;
        const refreshed = await this.token(signal);
        if (!refreshed.ok) return refreshed;
        usedToken = refreshed.value;
        response = await this.fetchImpl(url, { ...init, headers: mergeHeaders(init.headers, refreshed.value), signal });
      }
    } catch (cause) {
      return { ok: false, error: appError('backup_destination_error', cause instanceof Error ? cause.message : 'Google Drive request failed') };
    }
    if (!response.ok && !acceptedErrorStatuses.includes(response.status)) return googleResponseFailure(response, [token.value, usedToken]);
    return ok(response);
  }

  private async token(signal: AbortSignal): Promise<Result<string, AppError>> {
    if (this.accessToken !== null) return ok(this.accessToken);
    const refresh = await this.secrets.get(GOOGLE_REFRESH_TOKEN_ACCOUNT);
    if (!refresh.ok) return refresh;
    if (refresh.value === null) return { ok: false, error: appError('backup_auth_required', 'Connect Google Drive to continue') };
    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refresh.value,
        }),
        signal,
      });
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Could not refresh Google Drive authorization') };
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Could not read the Google token response') };
    }
    if (!response.ok) return {
      ok: false,
      error: mapGoogleDriveError(response.status, body, response.headers.get('retry-after'), [refresh.value, this.clientSecret]),
    };
    const parsed = parseJson(body, tokenSchema);
    if (!parsed.ok) return parsed;
    this.accessToken = parsed.value.access_token;
    return ok(this.accessToken);
  }

  private async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    verifier: string,
    signal: AbortSignal,
  ): Promise<Result<{ accessToken: string; refreshToken: string | null }, AppError>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
        signal,
      });
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Could not exchange the Google authorization code') };
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Could not read the Google authorization response') };
    }
    if (!response.ok) return {
      ok: false,
      error: mapGoogleDriveError(response.status, body, response.headers.get('retry-after'), [code, verifier, this.clientSecret]),
    };
    const parsed = parseJson(body, tokenSchema);
    if (!parsed.ok) return parsed;
    return ok({ accessToken: parsed.value.access_token, refreshToken: parsed.value.refresh_token ?? null });
  }

  private async uploadFile(
    folderId: string,
    sourcePath: string,
    name: string,
    appProperties: Record<string, string>,
    retried: boolean,
    signal: AbortSignal,
  ): Promise<Result<GoogleUploadedFile, AppError>> {
    const token = await this.token(signal);
    if (!token.ok) return token;
    const result = await uploadGoogleDriveFile({
      fetchImpl: this.fetchImpl,
      uploadBaseUrl: this.uploadBaseUrl,
      accessToken: token.value,
      folderId,
      sourcePath,
      name,
      appProperties,
      sharedDrive: false,
      signal,
    });
    if (!result.ok && result.error.code === 'backup_auth_required' && !retried) {
      this.accessToken = null;
      return this.uploadFile(folderId, sourcePath, name, appProperties, true, signal);
    }
    return result;
  }
}

interface AuthorizationCodeInput {
  state: string;
  signal: AbortSignal;
  timeoutMs: number;
  openExternal(url: string): Promise<void>;
  authorizationUrl: string;
  clientId: string;
  challenge: string;
}

const receiveAuthorizationCode = async (
  input: AuthorizationCodeInput,
): Promise<Result<{ code: string; redirectUri: string }, AppError>> => {
  if (input.signal.aborted) return { ok: false, error: appError('backup_auth_required', 'Google authorization was cancelled') };
  let handled = false;
  let settle: ((result: Result<string, AppError>) => void) | undefined;
  const received = new Promise<Result<string, AppError>>((resolve) => {
    settle = resolve;
  });
  const server = createServer((request, response) => {
    if (handled) {
      response.writeHead(410).end();
      return;
    }
    handled = true;
    const callback = new URL(request.url ?? '/', 'http://127.0.0.1');
    const code = callback.searchParams.get('code');
    const state = callback.searchParams.get('state');
    if (callback.pathname !== '/oauth/callback' || state !== input.state || code === null) {
      response.writeHead(400, { 'content-type': 'text/plain' }).end('Authorization failed');
      settle?.({ ok: false, error: appError('backup_auth_required', 'Google authorization callback was invalid') });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' }).end('Authorization complete. You can close this window.');
    settle?.(ok(code));
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = (): void => settle?.({ ok: false, error: appError('backup_auth_required', 'Google authorization was cancelled') });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') return { ok: false, error: appError('backup_auth_required', 'Could not start Google authorization callback') };
    const redirectUri = `http://127.0.0.1:${String(address.port)}/oauth/callback`;
    const authorization = new URL(input.authorizationUrl);
    authorization.searchParams.set('client_id', input.clientId);
    authorization.searchParams.set('redirect_uri', redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('scope', GOOGLE_DRIVE_FILE_SCOPE);
    authorization.searchParams.set('code_challenge', input.challenge);
    authorization.searchParams.set('code_challenge_method', 'S256');
    authorization.searchParams.set('state', input.state);
    authorization.searchParams.set('access_type', 'offline');
    authorization.searchParams.set('prompt', 'consent');
    input.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      settle?.({ ok: false, error: appError('backup_auth_required', 'Google authorization timed out') });
    }, input.timeoutMs);
    await input.openExternal(authorization.toString());
    const code = await received;
    return code.ok ? ok({ code: code.value, redirectUri }) : code;
  } catch {
    return { ok: false, error: appError('backup_auth_required', 'Could not complete Google authorization') };
  } finally {
    if (timer !== null) clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

const filesInFolderUrl = (baseUrl: string, folderId: string): string => {
  const url = new URL(`${baseUrl}/files`);
  url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('fields', 'files(id,name)');
  return url.toString();
};

const mergeHeaders = (headers: HeadersInit | undefined, token: string): Headers => {
  const merged = new Headers(headers);
  merged.set('authorization', authorizationHeaders(token).get('authorization') ?? '');
  return merged;
};

const parseJson = <T>(body: string, schema: z.ZodType<T>): Result<T, AppError> => {
  try {
    const decoded: unknown = JSON.parse(body);
    const parsed = schema.safeParse(decoded);
    return parsed.success ? ok(parsed.data) : destinationSchemaError('token response');
  } catch {
    return destinationSchemaError('token response');
  }
};

const destinationSchemaError = <T>(operation: string): Result<T, AppError> => ({
  ok: false,
  error: appError('backup_destination_error', `Google Drive returned invalid ${operation} data`),
});
