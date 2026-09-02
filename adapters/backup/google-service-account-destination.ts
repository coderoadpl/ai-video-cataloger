import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { GOOGLE_DRIVE_FILE_SCOPE } from './google-oauth-destination.js';

export const GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT = 'backup.service_account.key';

const DEFAULT_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3';
const JWT_LIFETIME_SECONDS = 3600;

const serviceAccountKeySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().min(1),
  private_key_id: z.string().min(1),
  token_uri: z.url(),
}).passthrough();

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
}).passthrough();

const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driveId: z.string().min(1),
}).passthrough();
const driveSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
const remoteFileLocationSchema = z.object({
  id: z.string().min(1),
  parents: z.array(z.string().min(1)),
  driveId: z.string().min(1),
}).passthrough();
const permissionsSchema = z.object({
  permissions: z.array(z.object({
    emailAddress: z.string().optional(),
    role: z.string(),
    type: z.string(),
  }).passthrough()),
}).passthrough();
const filesSchema = z.object({ files: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()) }).passthrough();
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

type ServiceAccountKey = z.output<typeof serviceAccountKeySchema>;

export interface GoogleServiceAccountBackupDestinationOptions {
  config: ConfigStore;
  secrets: SecretsStore;
  fetchImpl?: typeof fetch | undefined;
  driveBaseUrl?: string | undefined;
  uploadBaseUrl?: string | undefined;
  now?: (() => number) | undefined;
}

export class GoogleServiceAccountBackupDestination implements BackupDestinationPort {
  private readonly config: ConfigStore;
  private readonly secrets: SecretsStore;
  private readonly fetchImpl: typeof fetch;
  private readonly driveBaseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly now: () => number;
  private accessToken: string | null = null;

  constructor(options: GoogleServiceAccountBackupDestinationOptions) {
    this.config = options.config;
    this.secrets = options.secrets;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.driveBaseUrl = options.driveBaseUrl ?? DEFAULT_DRIVE_BASE_URL;
    this.uploadBaseUrl = options.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL;
    this.now = options.now ?? Date.now;
  }

  describe(): Result<BackupDestinationDescription, AppError> {
    return ok({ provider: 'service_account', folderName: '' });
  }

  async importKeyJson(keyJson: string): Promise<Result<{ fingerprint: string }, AppError>> {
    const parsed = parseServiceAccountKey(keyJson);
    if (!parsed.ok) return parsed;
    try {
      createPrivateKey(parsed.value.private_key);
    } catch {
      return { ok: false, error: appError('validation', 'The service-account private key is invalid') };
    }
    const fingerprint = `sha256:${createHash('sha256')
      .update(parsed.value.client_email + parsed.value.private_key_id)
      .digest('hex')
      .slice(0, 12)}`;
    const stored = await this.secrets.set(GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT, keyJson);
    if (!stored.ok) return stored;
    const configured = await this.config.set({ kind: 'home' }, 'backup_service_account_fingerprint', fingerprint);
    if (!configured.ok) {
      await this.secrets.delete(GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT);
      return configured;
    }
    this.accessToken = null;
    return ok({ fingerprint });
  }

  async test(signal: AbortSignal): Promise<Result<BackupConnectionReport, AppError>> {
    const key = await this.key();
    if (!key.ok) return key;
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const drive = await this.drive(folder.value.driveId, signal);
    if (!drive.ok) return drive;
    const membership = await this.verifyMembership(folder.value.driveId, key.value.client_email, signal);
    if (!membership.ok) return membership;
    const listed = await this.request(filesInFolderUrl(this.driveBaseUrl, folder.value.folderId, folder.value.driveId), {}, signal);
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
    return ok({
      accountEmail: key.value.client_email,
      driveName: drive.value.name,
      folderName: folder.value.name,
      remainingQuotaBytes: null,
    });
  }

  async ensureFolder(signal: AbortSignal): Promise<Result<{ folderId: string; name: string; driveId: string }, AppError>> {
    const configuredDrive = await this.config.get({ kind: 'home' }, 'backup_shared_drive_id');
    if (!configuredDrive.ok) return configuredDrive;
    const configuredFolder = await this.config.get({ kind: 'home' }, 'backup_folder_id');
    if (!configuredFolder.ok) return configuredFolder;
    if (configuredDrive.value === null || configuredDrive.value.length === 0) {
      return { ok: false, error: appError('validation', 'A Shared Drive id is required') };
    }
    if (configuredFolder.value === null || configuredFolder.value.length === 0) {
      return { ok: false, error: appError('validation', 'A backup folder id is required') };
    }
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(configuredFolder.value)}`);
    url.searchParams.set('fields', 'id,name,driveId');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.request(url.toString(), {}, signal);
    if (!response.ok) return response;
    const parsed = await parseGoogleResponse(response.value, folderSchema, 'folder metadata');
    if (!parsed.ok) return parsed;
    if (parsed.value.driveId !== configuredDrive.value) {
      return { ok: false, error: appError('validation', 'The backup folder must be inside the configured Shared Drive') };
    }
    return ok({ folderId: parsed.value.id, name: parsed.value.name, driveId: parsed.value.driveId });
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
      setSharedDriveParameters(url, folder.value.driveId);
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
    const validated = await this.validateRemoteFile(remoteId, signal);
    if (!validated.ok) return validated;
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(remoteId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.request(url.toString(), {}, signal);
    if (!response.ok) return response;
    return downloadGoogleDriveResponse(response.value, destinationPath, signal);
  }

  async remove(remoteId: string, signal: AbortSignal): Promise<Result<{ removed: boolean }, AppError>> {
    const validated = await this.validateRemoteFile(remoteId, signal);
    if (!validated.ok) return validated;
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(remoteId)}`);
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.request(url.toString(), { method: 'DELETE' }, signal);
    if (!response.ok) return response;
    return ok({ removed: true });
  }

  private async drive(driveId: string, signal: AbortSignal): Promise<Result<{ name: string }, AppError>> {
    const response = await this.request(`${this.driveBaseUrl}/drives/${encodeURIComponent(driveId)}?fields=id,name`, {}, signal);
    if (!response.ok) return response;
    const parsed = await parseGoogleResponse(response.value, driveSchema, 'Shared Drive metadata');
    return parsed.ok ? ok({ name: parsed.value.name }) : parsed;
  }

  private async validateRemoteFile(remoteId: string, signal: AbortSignal): Promise<Result<void, AppError>> {
    const folder = await this.ensureFolder(signal);
    if (!folder.ok) return folder;
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(remoteId)}`);
    url.searchParams.set('fields', 'id,parents,driveId');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.request(url.toString(), {}, signal);
    if (!response.ok) return response;
    const parsed = await parseGoogleResponse(response.value, remoteFileLocationSchema, 'backup location');
    if (!parsed.ok) return parsed;
    if (parsed.value.driveId !== folder.value.driveId || !parsed.value.parents.includes(folder.value.folderId)) {
      return { ok: false, error: appError('validation', 'The remote backup is outside the configured Shared Drive folder') };
    }
    return ok(undefined);
  }

  private async verifyMembership(driveId: string, email: string, signal: AbortSignal): Promise<Result<void, AppError>> {
    const url = new URL(`${this.driveBaseUrl}/files/${encodeURIComponent(driveId)}/permissions`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', 'permissions(emailAddress,role,type)');
    const response = await this.request(url.toString(), {}, signal);
    if (!response.ok) return response;
    const parsed = await parseGoogleResponse(response.value, permissionsSchema, 'Shared Drive membership');
    if (!parsed.ok) return parsed;
    const permission = parsed.value.permissions.find((item) => item.emailAddress === email);
    if (permission === undefined || !['fileOrganizer', 'organizer'].includes(permission.role)) {
      return { ok: false, error: appError('validation', 'The service account must have at least the Content manager role in the Shared Drive') };
    }
    return ok(undefined);
  }

  private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<Result<Response, AppError>> {
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
      return transportFailure(cause);
    }
    if (!response.ok) return googleResponseFailure(response, [token.value, usedToken]);
    return ok(response);
  }

  private async token(signal: AbortSignal): Promise<Result<string, AppError>> {
    if (this.accessToken !== null) return ok(this.accessToken);
    const key = await this.key();
    if (!key.ok) return key;
    const nowSeconds = Math.floor(this.now() / 1000);
    const header = encodeJson({ alg: 'RS256', typ: 'JWT', kid: key.value.private_key_id });
    const payload = encodeJson({
      iss: key.value.client_email,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      aud: key.value.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + JWT_LIFETIME_SECONDS,
    });
    let assertion: string;
    try {
      const unsigned = `${header}.${payload}`;
      assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key.value.private_key).toString('base64url')}`;
    } catch {
      return { ok: false, error: appError('backup_auth_required', 'The service-account key could not sign an authorization assertion') };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(key.value.token_uri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal,
      });
    } catch (cause) {
      return transportFailure(cause);
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Could not read the Google token response') };
    }
    if (!response.ok) return { ok: false, error: mapGoogleDriveError(response.status, body, response.headers.get('retry-after'), [assertion]) };
    const parsed = parseJson(body, tokenSchema);
    if (!parsed.ok) return parsed;
    this.accessToken = parsed.value.access_token;
    return ok(this.accessToken);
  }

  private async key(): Promise<Result<ServiceAccountKey, AppError>> {
    const stored = await this.secrets.get(GOOGLE_SERVICE_ACCOUNT_KEY_ACCOUNT);
    if (!stored.ok) return stored;
    if (stored.value === null) return { ok: false, error: appError('backup_auth_required', 'Import a service-account key to continue') };
    return parseServiceAccountKey(stored.value);
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
      sharedDrive: true,
      signal,
    });
    if (!result.ok && result.error.code === 'backup_auth_required' && !retried) {
      this.accessToken = null;
      return this.uploadFile(folderId, sourcePath, name, appProperties, true, signal);
    }
    return result;
  }
}

const parseServiceAccountKey = (keyJson: string): Result<ServiceAccountKey, AppError> => {
  try {
    const decoded: unknown = JSON.parse(keyJson);
    const parsed = serviceAccountKeySchema.safeParse(decoded);
    return parsed.success
      ? ok(parsed.data)
      : { ok: false, error: appError('validation', 'The service-account key JSON is invalid') };
  } catch {
    return { ok: false, error: appError('validation', 'The service-account key JSON is invalid') };
  }
};

const filesInFolderUrl = (baseUrl: string, folderId: string, driveId: string): string => {
  const url = new URL(`${baseUrl}/files`);
  url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
  setSharedDriveParameters(url, driveId);
  url.searchParams.set('fields', 'files(id,name)');
  return url.toString();
};

const setSharedDriveParameters = (url: URL, driveId: string): void => {
  url.searchParams.set('corpora', 'drive');
  url.searchParams.set('driveId', driveId);
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  url.searchParams.set('supportsAllDrives', 'true');
};

const mergeHeaders = (headers: HeadersInit | undefined, token: string): Headers => {
  const merged = new Headers(headers);
  merged.set('authorization', authorizationHeaders(token).get('authorization') ?? '');
  return merged;
};

const encodeJson = (value: Record<string, string | number>): string => Buffer.from(JSON.stringify(value)).toString('base64url');

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

const transportFailure = <T>(cause: unknown): Result<T, AppError> => ({
  ok: false,
  error: appError('backup_destination_error', cause instanceof Error ? cause.message : 'Google Drive request failed'),
});
