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
  return ok(mirrored.value ? mirror : folderArtifactRoot(fs, folder));
};
