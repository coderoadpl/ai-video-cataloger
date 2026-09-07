import { ok, type AppError, type CatalogPlace, type GpsSource, type Result, type TimelineIntervalKind } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore, PhotosStore } from '../ports.js';
import { photoArtifactsRoot, photoThumbPath } from './photo-artifacts.js';

export interface CatalogLocationsDeps {
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  fs: FileSystemPort;
}

export interface CatalogLocationFolder {
  folderId: string;
  currentPath: string;
  displayName: string;
  online: boolean;
}

export interface CatalogLocation {
  fingerprint: string;
  media: 'video' | 'photo';
  fileName: string;
  finalName: string | null;
  thumbPath: string | null;
  lat: number;
  lon: number;
  missing: boolean;
  folderId: string;
  source: GpsSource | null;
  accuracyM: number | null;
  intervalKind: TimelineIntervalKind | null;
  place: CatalogPlace | null;
}

export interface CatalogLocationsOutput {
  totalFiles: number;
  locatedFiles: number;
  totalPhotos: number;
  locatedPhotos: number;
  folders: Record<string, CatalogLocationFolder>;
  locations: CatalogLocation[];
}

export const catalogLocations = async (
  deps: CatalogLocationsDeps,
): Promise<Result<CatalogLocationsOutput, AppError>> => {
  const snapshot = await deps.globalCatalog.listLocations();
  if (!snapshot.ok) return snapshot;

  const photoSnapshot = await deps.photos.listPhotoLocations();
  if (!photoSnapshot.ok) return photoSnapshot;

  const onlineByFolderPath = new Map<string, boolean>();
  const resolveOnline = async (folderPath: string): Promise<Result<boolean, AppError>> => {
    const cached = onlineByFolderPath.get(folderPath);
    if (cached !== undefined) return ok(cached);
    const exists = await deps.fs.exists(folderPath);
    if (!exists.ok) return exists;
    onlineByFolderPath.set(folderPath, exists.value);
    return ok(exists.value);
  };

  const locations: CatalogLocation[] = [];
  const folders: Record<string, CatalogLocationFolder> = {};
  const addFolder = async (folder: { folderId: string; currentPath: string; displayName: string }): Promise<Result<string, AppError>> => {
    const cached = folders[folder.folderId];
    if (cached !== undefined) return ok(cached.folderId);
    const online = await resolveOnline(folder.currentPath);
    if (!online.ok) return online;
    folders[folder.folderId] = {
      folderId: folder.folderId,
      currentPath: folder.currentPath,
      displayName: folder.displayName,
      online: online.value,
    };
    return ok(folder.folderId);
  };
  for (const row of snapshot.value.rows) {
    const folderId = await addFolder(row.folder);
    if (!folderId.ok) return folderId;
    locations.push({
      fingerprint: row.fingerprint,
      media: 'video',
      fileName: row.fileName,
      finalName: row.finalName,
      thumbPath: null,
      lat: row.lat,
      lon: row.lon,
      missing: row.missing,
      folderId: folderId.value,
      source: row.source,
      accuracyM: row.accuracyM,
      intervalKind: row.intervalKind,
      place: row.place,
    });
  }

  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  for (const row of photoSnapshot.value.rows) {
    const folderId = await addFolder(row.folder);
    if (!folderId.ok) return folderId;
    locations.push({
      fingerprint: row.fingerprint,
      media: 'photo',
      fileName: row.fileName,
      finalName: null,
      thumbPath: row.thumbState === 'done' ? photoThumbPath(deps.fs, artifactsRoot, row.fingerprint) : null,
      lat: row.lat,
      lon: row.lon,
      missing: row.missing,
      folderId: folderId.value,
      source: row.source,
      accuracyM: row.accuracyM,
      intervalKind: row.intervalKind,
      place: row.place,
    });
  }

  return ok({
    totalFiles: snapshot.value.totalFiles,
    locatedFiles: snapshot.value.rows.length,
    totalPhotos: photoSnapshot.value.totalPhotos,
    locatedPhotos: photoSnapshot.value.rows.length,
    folders,
    locations,
  });
};
