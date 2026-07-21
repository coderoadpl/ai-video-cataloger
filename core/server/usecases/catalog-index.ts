import {
  ok,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type Result,
} from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore } from '../ports.js';
import { ensureFolderMarker, readFolderMarker } from './folder-identity.js';
import { exportFolderSnapshot, folderSnapshotPath, importFolderSnapshot } from './catalog-snapshot.js';

export interface CatalogIndexDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface ProcessedVideoInput {
  folderPath: string;
  fingerprint: string;
  fileName: string;
  size: number;
  durationS: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  processedAt: string;
  analyzer: string | null;
  model: string | null;
  finalName: string | null;
  description: string | null;
  transcript: string | null;
  language: string | null;
  tags: string[];
}

export interface IndexStatusFolder {
  folderId: string;
  currentPath: string;
  displayName: string;
}

export interface IndexStatusOutput {
  databasePath: string;
  counts: { folders: number; files: number; analyses: number };
  folders: IndexStatusFolder[];
}

export interface IndexRebuildOutput {
  databasePath: string;
  reconciledFolders: number;
  importedFiles: number;
  folders: IndexStatusFolder[];
}

export const resolveFolderIntoIndex = async (
  deps: CatalogIndexDeps,
  folderPath: string,
  options: { forceImport?: boolean } = {},
): Promise<Result<{ folderId: string; imported: number }, AppError>> => {
  const marker = await ensureFolderMarker(deps.fs, folderPath);
  if (!marker.ok) return marker;
  const folderId = marker.value.folderId;

  const existing = await deps.globalCatalog.getFolder(folderId);
  if (!existing.ok) return existing;

  let imported = 0;
  if (existing.value === null || options.forceImport === true) {
    const snapshotExists = await deps.fs.exists(folderSnapshotPath(deps.fs, folderPath));
    if (!snapshotExists.ok) return snapshotExists;
    if (snapshotExists.value) {
      const importResult = await importFolderSnapshot(deps, folderPath);
      if (!importResult.ok) return importResult;
      imported = importResult.value.imported;
    }
  }

  const now = new Date().toISOString();
  const folder: CatalogFolder = {
    folderId,
    currentPath: folderPath,
    displayName: deps.fs.basename(folderPath),
    firstSeenAt: existing.value?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const upserted = await deps.globalCatalog.upsertFolder(folder);
  if (!upserted.ok) return upserted;
  return ok({ folderId, imported });
};

export const upsertProcessedVideo = async (
  deps: CatalogIndexDeps,
  input: ProcessedVideoInput,
): Promise<Result<void, AppError>> => {
  const resolved = await resolveFolderIntoIndex(deps, input.folderPath);
  if (!resolved.ok) return resolved;

  const file: CatalogFile = {
    fingerprint: input.fingerprint,
    folderId: resolved.value.folderId,
    fileName: input.fileName,
    size: input.size,
    durationS: input.durationS,
    gpsLat: input.gpsLat,
    gpsLon: input.gpsLon,
    processedAt: input.processedAt,
    analyzer: input.analyzer,
    model: input.model,
  };
  const upsertedFile = await deps.globalCatalog.upsertFile(file);
  if (!upsertedFile.ok) return upsertedFile;

  const analysis: CatalogAnalysis = {
    fingerprint: input.fingerprint,
    finalName: input.finalName,
    description: input.description,
    transcript: input.transcript,
    language: input.language,
    tags: input.tags,
  };
  const upsertedAnalysis = await deps.globalCatalog.upsertAnalysis(analysis);
  if (!upsertedAnalysis.ok) return upsertedAnalysis;

  const folder = await deps.globalCatalog.getFolder(resolved.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) return ok(undefined);
  const snapshot = await exportFolderSnapshot(deps, folder.value);
  if (!snapshot.ok) return snapshot;
  return ok(undefined);
};

export const hasProcessedAnalysis = async (
  deps: CatalogIndexDeps,
  fingerprint: string,
): Promise<Result<boolean, AppError>> => {
  const analysis = await deps.globalCatalog.getAnalysis(fingerprint);
  if (!analysis.ok) return analysis;
  return ok(analysis.value !== null);
};

export const indexStatus = async (deps: CatalogIndexDeps): Promise<Result<IndexStatusOutput, AppError>> => {
  const counts = await deps.globalCatalog.counts();
  if (!counts.ok) return counts;
  const folders = await deps.globalCatalog.listFolders();
  if (!folders.ok) return folders;
  return ok({
    databasePath: deps.globalCatalog.databasePath(),
    counts: counts.value,
    folders: folders.value.map(toStatusFolder),
  });
};

export const indexRebuild = async (deps: CatalogIndexDeps): Promise<Result<IndexRebuildOutput, AppError>> => {
  const folders = await deps.globalCatalog.listFolders();
  if (!folders.ok) return folders;

  let reconciledFolders = 0;
  let importedFiles = 0;
  for (const folder of folders.value) {
    const marker = await readFolderMarker(deps.fs, folder.currentPath);
    if (!marker.ok) return marker;
    if (marker.value === null || marker.value.folderId !== folder.folderId) continue;
    const synced = await resolveFolderIntoIndex(deps, folder.currentPath, { forceImport: true });
    if (!synced.ok) return synced;
    reconciledFolders += 1;
    importedFiles += synced.value.imported;
  }

  const refreshed = await deps.globalCatalog.listFolders();
  if (!refreshed.ok) return refreshed;
  return ok({
    databasePath: deps.globalCatalog.databasePath(),
    reconciledFolders,
    importedFiles,
    folders: refreshed.value.map(toStatusFolder),
  });
};

const toStatusFolder = (folder: CatalogFolder): IndexStatusFolder => ({
  folderId: folder.folderId,
  currentPath: folder.currentPath,
  displayName: folder.displayName,
});
