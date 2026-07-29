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
): Promise<Result<ArtifactRoot, AppError>> => {
  const marker = await readFolderMarker(fs, folder);
  if (!marker.ok) return marker;
  if (marker.value !== null) return ok(folderArtifactRoot(fs, folder));
  const mirror = readOnlyArtifactRoot(fs, folder);
  const mirrored = await fs.exists(mirror.path);
  if (!mirrored.ok) return mirrored;
  if (mirrored.value) return ok(mirror);
  const legacyMirror = readOnlyArtifactRootById(fs, legacyDerivedFolderId(fs.resolve(folder).normalize('NFD')));
  const legacyMirrored = await fs.exists(legacyMirror.path);
  if (!legacyMirrored.ok) return legacyMirrored;
  return ok(legacyMirrored.value ? legacyMirror : folderArtifactRoot(fs, folder));
};
