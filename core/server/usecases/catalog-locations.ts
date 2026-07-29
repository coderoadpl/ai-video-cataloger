import { ok, type AppError, type CatalogPlace, type GpsSource, type Result, type TimelineIntervalKind } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore } from '../ports.js';

export interface CatalogLocationsDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface CatalogLocation {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  lat: number;
  lon: number;
  missing: boolean;
  folder: {
    folderId: string;
    currentPath: string;
    displayName: string;
    online: boolean;
  };
  source: GpsSource | null;
  accuracyM: number | null;
  intervalKind: TimelineIntervalKind | null;
  place: CatalogPlace | null;
}

export interface CatalogLocationsOutput {
  totalFiles: number;
  locatedFiles: number;
  locations: CatalogLocation[];
}

export const catalogLocations = async (
  deps: CatalogLocationsDeps,
): Promise<Result<CatalogLocationsOutput, AppError>> => {
  const snapshot = await deps.globalCatalog.listLocations();
  if (!snapshot.ok) return snapshot;

  const onlineByFolderId = new Map<string, boolean>();
  const locations: CatalogLocation[] = [];
  for (const row of snapshot.value.rows) {
    let online = onlineByFolderId.get(row.folder.folderId);
    if (online === undefined) {
      const exists = await deps.fs.exists(row.folder.currentPath);
      if (!exists.ok) return exists;
      online = exists.value;
      onlineByFolderId.set(row.folder.folderId, online);
    }
    locations.push({
      fingerprint: row.fingerprint,
      fileName: row.fileName,
      finalName: row.finalName,
      lat: row.lat,
      lon: row.lon,
      missing: row.missing,
      folder: {
        folderId: row.folder.folderId,
        currentPath: row.folder.currentPath,
        displayName: row.folder.displayName,
        online,
      },
      source: row.source,
      accuracyM: row.accuracyM,
      intervalKind: row.intervalKind,
      place: row.place,
    });
  }

  return ok({
    totalFiles: snapshot.value.totalFiles,
    locatedFiles: locations.length,
    locations,
  });
};
