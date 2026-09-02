import { open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises';

import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import { JOB_CANCELLED_ERROR_MESSAGE } from '@core/server/index.js';

const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_UPLOAD_ATTEMPTS = 5;

const googleErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      message: z.string().optional(),
      errors: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
    }).passthrough(),
  ]),
}).passthrough();

const uploadedFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.string().regex(/^\d+$/).optional(),
}).passthrough();

export interface GoogleUploadedFile {
  id: string;
  name: string;
  sizeBytes: number;
}

export interface GoogleUploadInput {
  fetchImpl: typeof fetch;
  uploadBaseUrl: string;
  accessToken: string;
  folderId: string;
  sourcePath: string;
  name: string;
  appProperties: Record<string, string>;
  sharedDrive: boolean;
  signal: AbortSignal;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
}

export const mapGoogleDriveError = (
  status: number,
  body: string,
  retryAfter: string | null,
  secrets: readonly string[] = [],
): AppError => {
  const parsed = parseGoogleError(body);
  const reason = parsed === null || typeof parsed.error === 'string'
    ? typeof parsed?.error === 'string' ? parsed.error : ''
    : parsed.error.errors?.map((item) => item.reason ?? '').join(' ') ?? '';
  if (status === 401 || reason === 'invalid_grant') return appError('backup_auth_required', 'Google Drive authorization is required');
  if (status === 403 && reason.includes('storageQuotaExceeded')) {
    return appError('backup_quota_exceeded', 'Google Drive storage quota is exhausted');
  }
  if (status === 429 || status === 403 && reason.toLowerCase().includes('ratelimit')) {
    return appError('rate_limited', 'Google Drive rate limit exceeded', { retryAfter });
  }
  let excerpt = body.slice(0, 512);
  for (const secret of secrets) {
    if (secret.length > 0) excerpt = excerpt.replaceAll(secret, '[redacted]');
  }
  return appError('backup_destination_error', `Google Drive request failed with HTTP ${String(status)}: ${excerpt}`);
};

export const uploadGoogleDriveFile = async (
  input: GoogleUploadInput,
): Promise<Result<GoogleUploadedFile, AppError>> => {
  let sizeBytes: number;
  try {
    sizeBytes = (await stat(input.sourcePath)).size;
  } catch {
    return { ok: false, error: appError('backup_destination_error', 'Could not read the backup upload source') };
  }
  return sizeBytes > RESUMABLE_THRESHOLD
    ? resumableUpload(input, sizeBytes)
    : multipartUpload(input, sizeBytes);
};

export const downloadGoogleDriveResponse = async (
  response: Response,
  destinationPath: string,
  signal: AbortSignal,
): Promise<Result<{ sizeBytes: number }, AppError>> => {
  if (response.body === null) return { ok: false, error: appError('backup_destination_error', 'Google download returned no body') };
  const tempPath = `${destinationPath}.tmp`;
  const reader = response.body.getReader();
  let file: FileHandle | null = null;
  try {
    file = await open(tempPath, 'w', 0o600);
    let sizeBytes = 0;
    while (true) {
      if (signal.aborted) return aborted();
      const item = await reader.read();
      if (item.done) break;
      await file.write(item.value);
      sizeBytes += item.value.byteLength;
    }
    await file.sync();
    await file.close();
    file = null;
    await rename(tempPath, destinationPath);
    return ok({ sizeBytes });
  } catch (cause) {
    return transportFailure(cause);
  } finally {
    if (file !== null) await file.close();
    reader.releaseLock();
    await rm(tempPath, { force: true });
  }
};

const multipartUpload = async (
  input: GoogleUploadInput,
  sizeBytes: number,
): Promise<Result<GoogleUploadedFile, AppError>> => {
  try {
    const boundary = 'avc-backup-boundary';
    const metadata = Buffer.from(JSON.stringify(uploadMetadata(input)));
    const bytes = await readFile(input.sourcePath);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      metadata,
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await input.fetchImpl(uploadUrl(input, 'multipart'), {
      method: 'POST',
      headers: authorizationHeaders(input.accessToken, { 'content-type': `multipart/related; boundary=${boundary}` }),
      body,
      signal: input.signal,
    });
    if (!response.ok) return googleResponseFailure(response, [input.accessToken]);
    return parseUploadedFile(await response.json(), sizeBytes);
  } catch (cause) {
    return transportFailure(cause);
  }
};

const resumableUpload = async (
  input: GoogleUploadInput,
  sizeBytes: number,
): Promise<Result<GoogleUploadedFile, AppError>> => {
  const sleep = input.sleep ?? defaultSleep;
  const random = input.random ?? Math.random;
  let sessionUrl: string;
  try {
    const session = await input.fetchImpl(uploadUrl(input, 'resumable'), {
      method: 'POST',
      headers: authorizationHeaders(input.accessToken, {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': 'application/octet-stream',
        'x-upload-content-length': String(sizeBytes),
      }),
      body: JSON.stringify(uploadMetadata(input)),
      signal: input.signal,
    });
    if (!session.ok) return googleResponseFailure(session, [input.accessToken]);
    const location = session.headers.get('location');
    if (location === null) return { ok: false, error: appError('backup_destination_error', 'Google resumable upload returned no session URL') };
    sessionUrl = location;
  } catch (cause) {
    return transportFailure(cause);
  }

  let file: FileHandle;
  try {
    file = await open(input.sourcePath, 'r');
  } catch (cause) {
    return transportFailure(cause);
  }
  try {
    let offset = 0;
    while (offset < sizeBytes) {
      const length = Math.min(UPLOAD_CHUNK_SIZE, sizeBytes - offset);
      const chunk = Buffer.alloc(length);
      const read = await file.read(chunk, 0, length, offset);
      if (read.bytesRead !== length) return { ok: false, error: appError('backup_destination_error', 'Backup upload source was truncated') };
      let response: Response | null = null;
      for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
        if (input.signal.aborted) {
          await cancelResumableSession(input, sessionUrl);
          return aborted();
        }
        try {
          response = await input.fetchImpl(sessionUrl, {
            method: 'PUT',
            headers: authorizationHeaders(input.accessToken, {
              'content-length': String(length),
              'content-range': `bytes ${String(offset)}-${String(offset + length - 1)}/${String(sizeBytes)}`,
            }),
            body: chunk,
            signal: input.signal,
          });
          if (response.status === 308 || response.ok) break;
          if (!await retryableResponse(response) || attempt === MAX_UPLOAD_ATTEMPTS - 1) {
            return googleResponseFailure(response, [input.accessToken]);
          }
        } catch (cause) {
          if (input.signal.aborted) {
            await cancelResumableSession(input, sessionUrl);
            return aborted();
          }
          if (attempt === MAX_UPLOAD_ATTEMPTS - 1) return transportFailure(cause);
        }
        await sleep(Math.floor(random() * 100 * 2 ** attempt));
      }
      if (response === null) return { ok: false, error: appError('backup_destination_error', 'Google resumable upload did not respond') };
      if (response.status === 308) {
        offset = acknowledgedOffset(response.headers.get('range'), offset + length);
        continue;
      }
      return parseUploadedFile(await response.json(), sizeBytes);
    }
    return { ok: false, error: appError('backup_destination_error', 'Google resumable upload ended without metadata') };
  } catch (cause) {
    if (input.signal.aborted) {
      await cancelResumableSession(input, sessionUrl);
      return aborted();
    }
    return transportFailure(cause);
  } finally {
    await file.close();
  }
};

const cancelResumableSession = async (input: GoogleUploadInput, sessionUrl: string): Promise<void> => {
  try {
    await input.fetchImpl(sessionUrl, {
      method: 'DELETE',
      headers: authorizationHeaders(input.accessToken),
    });
  } catch {
    return;
  }
};

const uploadMetadata = (input: GoogleUploadInput): Record<string, unknown> => ({
  name: input.name,
  parents: [input.folderId],
  appProperties: input.appProperties,
});

const uploadUrl = (input: GoogleUploadInput, uploadType: 'multipart' | 'resumable'): string => {
  const url = new URL(`${input.uploadBaseUrl}/files`);
  url.searchParams.set('uploadType', uploadType);
  url.searchParams.set('fields', 'id,name,size');
  if (input.sharedDrive) url.searchParams.set('supportsAllDrives', 'true');
  return url.toString();
};

export const authorizationHeaders = (accessToken: string, additional: Record<string, string> = {}): Headers => {
  const headers = new Headers(additional);
  headers.set('authorization', `Bearer ${accessToken}`);
  return headers;
};

export const parseGoogleResponse = async <T>(
  response: Response,
  schema: z.ZodType<T>,
  operation: string,
): Promise<Result<T, AppError>> => {
  try {
    const value: unknown = await response.json();
    const parsed = schema.safeParse(value);
    return parsed.success
      ? ok(parsed.data)
      : { ok: false, error: appError('backup_destination_error', `Google Drive returned invalid ${operation} data`) };
  } catch {
    return { ok: false, error: appError('backup_destination_error', `Google Drive returned invalid ${operation} data`) };
  }
};

export const googleResponseFailure = async <T>(
  response: Response,
  secrets: readonly string[],
): Promise<Result<T, AppError>> => {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = 'unreadable response body';
  }
  return {
    ok: false,
    error: mapGoogleDriveError(response.status, body, response.headers.get('retry-after'), secrets),
  };
};

const parseUploadedFile = (value: unknown, fallbackSize: number): Result<GoogleUploadedFile, AppError> => {
  const parsed = uploadedFileSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: appError('backup_destination_error', 'Google upload returned invalid metadata') };
  return ok({ id: parsed.data.id, name: parsed.data.name, sizeBytes: parsed.data.size === undefined ? fallbackSize : Number(parsed.data.size) });
};

const parseGoogleError = (body: string): z.output<typeof googleErrorSchema> | null => {
  try {
    const decoded: unknown = JSON.parse(body);
    const parsed = googleErrorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const acknowledgedOffset = (range: string | null, fallback: number): number => {
  if (range === null) return fallback;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (match?.[1] === undefined) return fallback;
  return Number(match[1]) + 1;
};

const retryableResponse = async (response: Response): Promise<boolean> => {
  if (response.status === 429 || response.status >= 500) return true;
  if (response.status !== 403) return false;
  let body = '';
  try {
    body = await response.clone().text();
  } catch {
    return false;
  }
  return mapGoogleDriveError(response.status, body, response.headers.get('retry-after')).code === 'rate_limited';
};
const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const aborted = <T>(): Result<T, AppError> => ({ ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) });
const transportFailure = <T>(cause: unknown): Result<T, AppError> => ({
  ok: false,
  error: appError('backup_destination_error', cause instanceof Error ? cause.message : 'Google Drive request failed'),
});
