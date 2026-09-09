import { z } from 'zod';

import { derivedFolderId, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';
import { readFolderMarker } from './folder-identity.js';

const catalogDirectoryName = '.ai-video-cataloger';
const readOnlyMirrorDirectoryName = 'read-only-folders';

export interface ArtifactRoot {
  path: string;
  catalogDirectory: string;
}

export const folderArtifactRoot = (fs: FileSystemPort, folder: string): ArtifactRoot => ({
  path: folder,
  catalogDirectory: fs.join(folder, catalogDirectoryName),
});

export const readOnlyArtifactRootById = (fs: FileSystemPort, folderId: string): ArtifactRoot => {
  const mirror = fs.join(fs.homeDirectory(), catalogDirectoryName, readOnlyMirrorDirectoryName, folderId);
  return { path: mirror, catalogDirectory: mirror };
};

export const readOnlyArtifactRoot = (fs: FileSystemPort, folder: string): ArtifactRoot =>
  readOnlyArtifactRootById(fs, derivedFolderId(fs.resolve(folder)));

export const legacyReadOnlyArtifactRoot = (fs: FileSystemPort, folder: string): ArtifactRoot =>
  readOnlyArtifactRootById(fs, legacyDerivedFolderId(fs.resolve(folder).normalize('NFD')));

export const artifactRootFor = (fs: FileSystemPort, folder: string, writable: boolean): ArtifactRoot =>
  writable ? folderArtifactRoot(fs, folder) : readOnlyArtifactRoot(fs, folder);

// a mirror created before path canonicalization is keyed by an id hashed from the decomposed
// on-disk name macOS used to hand over, which no caller can still produce: rebuild that form here
// so a pre-existing read-only mirror for a diacritic folder is not silently orphaned
const legacyDerivedFolderId = (folder: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < folder.length; index += 1) {
    hash = Math.imul(hash ^ folder.charCodeAt(index), 16_777_619);
  }
  return `path-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const discoverArtifactRoot = async (
  fs: FileSystemPort,
  folder: string,
  knownFolderId?: string,
): Promise<Result<ArtifactRoot, AppError>> => {
  const marker = await readFolderMarker(fs, folder);
  if (!marker.ok) return marker;
  if (marker.value !== null) return ok(folderArtifactRoot(fs, folder));
  if (knownFolderId !== undefined) {
    const knownMirror = readOnlyArtifactRootById(fs, knownFolderId);
    const knownMirrored = await fs.exists(knownMirror.path);
    if (!knownMirrored.ok) return knownMirrored;
    if (knownMirrored.value) return ok(knownMirror);
  }
  const mirror = readOnlyArtifactRoot(fs, folder);
  const mirrored = await fs.exists(mirror.path);
  if (!mirrored.ok) return mirrored;
  if (mirrored.value) return ok(mirror);
  const legacyMirror = legacyReadOnlyArtifactRoot(fs, folder);
  const legacyMirrored = await fs.exists(legacyMirror.path);
  if (!legacyMirrored.ok) return legacyMirrored;
  return ok(legacyMirrored.value ? legacyMirror : folderArtifactRoot(fs, folder));
};

export const prepareArtifactRootForWrite = async (
  fs: FileSystemPort,
  folder: string,
  root: ArtifactRoot,
): Promise<Result<ArtifactRoot, AppError>> => {
  const canonical = readOnlyArtifactRoot(fs, folder);
  const legacy = legacyReadOnlyArtifactRoot(fs, folder);
  if (canonical.path === legacy.path || (root.path !== canonical.path && root.path !== legacy.path)) return ok(root);
  const exists = await fs.isDirectory(legacy.path);
  if (!exists.ok) return exists;
  if (!exists.value) return ok(canonical);
  const migrated = await mergeLegacyMirror(fs, legacy.path, canonical.path);
  return migrated.ok ? ok(canonical) : migrated;
};

export const discoverArtifactRootForWrite = async (
  fs: FileSystemPort,
  folder: string,
  knownFolderId?: string,
): Promise<Result<ArtifactRoot, AppError>> => {
  const root = await discoverArtifactRoot(fs, folder, knownFolderId);
  return root.ok ? prepareArtifactRootForWrite(fs, folder, root.value) : root;
};

const mergeLegacyMirror = async (
  fs: FileSystemPort,
  legacy: string,
  canonical: string,
): Promise<Result<void, AppError>> => {
  const exists = await fs.exists(canonical);
  if (!exists.ok) return exists;
  if (!exists.value) {
    const renamed = await fs.renamePath(legacy, canonical);
    if (renamed.ok) return renamed;
    const race = z.object({ code: z.enum(['ENOENT', 'EEXIST', 'ENOTEMPTY']) }).safeParse(renamed.error.details);
    if (!race.success) return renamed;
    const rediscovered = await fs.exists(canonical);
    if (!rediscovered.ok) return rediscovered;
    if (!rediscovered.value) return renamed;
  }
  const remaining = await fs.exists(legacy);
  if (!remaining.ok) return remaining;
  if (!remaining.value) return ok(undefined);
  const directory = await fs.isDirectory(canonical);
  if (!directory.ok) return directory;
  if (directory.value) {
    const listed = await fs.listDirectory(legacy);
    if (!listed.ok) {
      const remaining = await fs.exists(legacy);
      if (!remaining.ok) return remaining;
      return remaining.value ? listed : ok(undefined);
    }
    for (const entry of listed.value) {
      const target = fs.join(canonical, entry.name);
      const merged = await mergeLegacyMirror(fs, entry.path, target);
      if (!merged.ok) return merged;
    }
  }
  return fs.deletePath(legacy);
};
