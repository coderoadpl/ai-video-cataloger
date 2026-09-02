import {
  compareUtf8Bytes,
  ok,
  type AppError,
  type BackupTier,
  type Result,
} from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export interface BackupScopeEntry {
  sourcePath: string;
  archivePath: string;
  kind: 'file';
}

export interface BackupScopeInput {
  tier: BackupTier;
  homeDirectory: string;
  globalCatalogSnapshot: string;
  photosSnapshot: string | null;
  folders: readonly { folderId: string; path: string }[];
}

export interface BackupScope {
  entries: BackupScopeEntry[];
  folders: Array<{ folderId: string; path: string }>;
}

export const collectBackupScope = async (
  fs: FileSystemPort,
  input: BackupScopeInput,
): Promise<Result<BackupScope, AppError>> => {
  const entries: BackupScopeEntry[] = [];
  if (input.tier === 'critical') {
    const catalog = await addFile(fs, entries, input.globalCatalogSnapshot, 'catalog.db');
    if (!catalog.ok) return catalog;
    if (input.photosSnapshot !== null) {
      const photos = await addFile(fs, entries, input.photosSnapshot, 'photos.db');
      if (!photos.ok) return photos;
    }
    const appRoot = fs.join(input.homeDirectory, '.ai-video-cataloger');
    const config = await addFile(fs, entries, fs.join(appRoot, 'config.json'), 'config.json');
    if (!config.ok) return config;
    for (const folder of input.folders) {
      const folderConfig = await addFile(
        fs,
        entries,
        fs.join(folder.path, '.ai-video-cataloger', 'config.json'),
        `folders/${folder.folderId}/config.json`,
      );
      if (!folderConfig.ok) return folderConfig;
    }
    const faces = await addTree(fs, entries, fs.join(appRoot, 'faces', 'obs'), 'faces/obs');
    if (!faces.ok) return faces;
  } else {
    const appRoot = fs.join(input.homeDirectory, '.ai-video-cataloger');
    for (const relative of ['photo-artifacts/proxies', 'photo-artifacts/thumbs', 'read-only-folders']) {
      const tree = await addTree(fs, entries, fs.join(appRoot, ...relative.split('/')), relative);
      if (!tree.ok) return tree;
    }
  }
  entries.sort((left, right) => compareUtf8Bytes(left.archivePath, right.archivePath));
  return ok({ entries, folders: input.folders.map((folder) => ({ ...folder })) });
};

const addFile = async (
  fs: FileSystemPort,
  entries: BackupScopeEntry[],
  sourcePath: string,
  archivePath: string,
): Promise<Result<void, AppError>> => {
  if (archivePath.endsWith('.tmp')) return ok(undefined);
  const isFile = await fs.isFile(sourcePath);
  if (!isFile.ok) return isFile;
  if (isFile.value) entries.push({ sourcePath, archivePath, kind: 'file' });
  return ok(undefined);
};

const addTree = async (
  fs: FileSystemPort,
  entries: BackupScopeEntry[],
  sourceRoot: string,
  archiveRoot: string,
): Promise<Result<void, AppError>> => {
  const exists = await fs.isDirectory(sourceRoot);
  if (!exists.ok) return exists;
  if (!exists.value) return ok(undefined);
  const listed = await fs.listDirectory(sourceRoot);
  if (!listed.ok) return listed;
  const sorted = [...listed.value].sort((left, right) => compareUtf8Bytes(left.name, right.name));
  for (const entry of sorted) {
    if (entry.name.endsWith('.tmp') || entry.kind === 'symlink') continue;
    const archivePath = `${archiveRoot}/${entry.name}`;
    if (entry.kind === 'directory') {
      const nested = await addTree(fs, entries, entry.path, archivePath);
      if (!nested.ok) return nested;
    } else {
      entries.push({ sourcePath: entry.path, archivePath, kind: 'file' });
    }
  }
  return ok(undefined);
};
