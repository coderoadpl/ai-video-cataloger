import { randomUUID } from 'node:crypto';

import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  folderMarkerSchema,
  ok,
  type AppError,
  type FolderMarker,
  type Result,
} from '@core/domain/index.js';
import { z } from 'zod';

import type { FileSystemPort } from '../ports.js';

const catalogDirectoryName = '.ai-video-cataloger';
const markerFileName = 'folder-id';

const READ_ONLY_ERRNO_CODES: ReadonlySet<string> = new Set(['EACCES', 'EROFS', 'EPERM']);
const errnoDetailsSchema = z.object({ code: z.string() });

export const isReadOnlyWriteError = (error: AppError): boolean => {
  const parsed = errnoDetailsSchema.safeParse(error.details);
  return parsed.success && READ_ONLY_ERRNO_CODES.has(parsed.data.code);
};

export interface ResolvedFolderIdentity {
  folderId: string;
  persistent: boolean;
}

export const folderMarkerPath = (fs: FileSystemPort, folder: string): string =>
  fs.join(folder, catalogDirectoryName, markerFileName);

export const readFolderMarker = async (
  fs: FileSystemPort,
  folder: string,
): Promise<Result<FolderMarker | null, AppError>> => {
  const content = await fs.readTextFile(folderMarkerPath(fs, folder));
  if (!content.ok) return content;
  if (content.value === null) return ok(null);
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return ok(null);
  }
  const parsed = folderMarkerSchema.safeParse(decoded);
  return ok(parsed.success ? parsed.data : null);
};

export const resolveFolderIdentity = async (
  fs: FileSystemPort,
  folder: string,
): Promise<Result<ResolvedFolderIdentity, AppError>> => {
  const derived: ResolvedFolderIdentity = { folderId: pathFolderId(fs.resolve(folder)), persistent: false };
  const existing = await readFolderMarker(fs, folder);
  if (!existing.ok) return isReadOnlyWriteError(existing.error) ? ok(derived) : existing;
  if (existing.value !== null) return ok({ folderId: existing.value.folderId, persistent: true });

  const marker: FolderMarker = {
    folderId: randomUUID(),
    schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  };
  const markerPath = folderMarkerPath(fs, folder);
  const ensured = await fs.ensureDirectory(fs.dirname(markerPath));
  if (!ensured.ok) return isReadOnlyWriteError(ensured.error) ? ok(derived) : ensured;
  const written = await fs.writeTextFile(markerPath, JSON.stringify(marker, null, 2));
  if (!written.ok) return isReadOnlyWriteError(written.error) ? ok(derived) : written;
  return ok({ folderId: marker.folderId, persistent: true });
};

export const pathFolderId = (folder: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < folder.length; index += 1) {
    hash = Math.imul(hash ^ folder.charCodeAt(index), 16_777_619);
  }
  return `path-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
