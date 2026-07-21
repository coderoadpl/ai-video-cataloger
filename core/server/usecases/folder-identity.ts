import { randomUUID } from 'node:crypto';

import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  folderMarkerSchema,
  ok,
  type AppError,
  type FolderMarker,
  type Result,
} from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

const catalogDirectoryName = '.ai-video-cataloger';
const markerFileName = 'folder-id';

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

export const ensureFolderMarker = async (
  fs: FileSystemPort,
  folder: string,
): Promise<Result<FolderMarker, AppError>> => {
  const existing = await readFolderMarker(fs, folder);
  if (!existing.ok) return existing;
  if (existing.value !== null) return ok(existing.value);

  const marker: FolderMarker = {
    folderId: randomUUID(),
    schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  };
  const markerPath = folderMarkerPath(fs, folder);
  const ensured = await fs.ensureDirectory(fs.dirname(markerPath));
  if (!ensured.ok) return ensured;
  const written = await fs.writeTextFile(markerPath, JSON.stringify(marker, null, 2));
  if (!written.ok) return written;
  return ok(marker);
};
