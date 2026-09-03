import {
  appError,
  ok,
  spendMonth,
  type AppError,
  type AnalysisLanguageResolution,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type Result,
} from '@core/domain/index.js';

import type {
  CatalogFileRecord,
  DriveRunRecord,
  FileSystemPort,
  ForgetEntryResult,
  GlobalCatalogStore,
  SpendLedgerPort,
  ReconcileFolderResult,
} from '../ports.js';
import { isReadOnlyWriteError, readFolderMarker, resolveFolderIdentity } from './folder-identity.js';
import { exportFolderSnapshot, folderSnapshotPath, importFolderSnapshot } from './catalog-snapshot.js';
import { reanchorFaceCropPath } from './faces.js';
import { isSupportedVideoExtension } from './shared.js';

export interface CatalogIndexDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
  spendLedger?: SpendLedgerPort | undefined;
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

export interface ForgetCatalogEntryResult extends ForgetEntryResult {
  snapshotSkipped: boolean;
}

export interface ProcessedVariantInput {
  folderPath: string;
  file: Omit<CatalogFile, 'folderId'>;
  variant: CatalogVariant;
  languageResolution: AnalysisLanguageResolution;
}

export interface IndexStatusFolder {
  folderId: string;
  currentPath: string;
  displayName: string;
}

export interface IndexStatusOutput {
  databasePath: string;
  durability: ReturnType<GlobalCatalogStore['durabilityStatus']>;
  counts: { folders: number; files: number; analyses: number };
  folders: IndexStatusFolder[];
  latestRun: DriveRunRecord | null;
  currentMonthSpend: {
    kind: 'estimate';
    provider: 'gemini';
    month: string;
    entries: number;
    estimatedCostUsd: number;
  };
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
  options: { forceImport?: boolean; firstSeenAt?: string } = {},
): Promise<Result<{ folderId: string; imported: number; persistent: boolean }, AppError>> => {
  const identity = await resolveFolderIdentity(deps.fs, folderPath);
  if (!identity.ok) return identity;
  const folderId = identity.value.folderId;

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
    firstSeenAt: existing.value?.firstSeenAt ?? options.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const upserted = await deps.globalCatalog.upsertFolder(folder);
  if (!upserted.ok) return upserted;
  return ok({ folderId, imported, persistent: identity.value.persistent });
};

export const upsertProcessedVideo = async (
  deps: CatalogIndexDeps,
  input: ProcessedVideoInput,
): Promise<Result<{ snapshotSkipped: boolean }, AppError>> => {
  const resolved = await resolveFolderIntoIndex(deps, input.folderPath);
  if (!resolved.ok) return resolved;

  const file: CatalogFile = {
    fingerprint: input.fingerprint,
    folderId: resolved.value.folderId,
    fileName: input.fileName,
    size: input.size,
    durationS: input.durationS,
    width: null,
    height: null,
    gpsLat: input.gpsLat,
    gpsLon: input.gpsLon,
    processedAt: input.processedAt,
    analyzer: input.analyzer,
    model: input.model,
    missingAt: null,
    capturedAt: null,
    capturedAtSource: null,
    gpsSource: input.gpsLat === null || input.gpsLon === null ? null : 'camera',
    gpsAccuracyM: null,
    gpsIntervalKind: null,
    gpsResolvedAt: null,
    place: null,
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
  if (folder.value === null) return ok({ snapshotSkipped: false });
  if (!resolved.value.persistent) return ok({ snapshotSkipped: true });
  const snapshot = await exportFolderSnapshot(deps, folder.value);
  if (!snapshot.ok) {
    if (isReadOnlyWriteError(snapshot.error)) return ok({ snapshotSkipped: true });
    return snapshot;
  }
  return ok({ snapshotSkipped: false });
};

export const upsertProcessedVariant = async (
  deps: CatalogIndexDeps,
  input: ProcessedVariantInput,
): Promise<Result<{ snapshotSkipped: boolean; selectedConfigId: string }, AppError>> => {
  const resolved = await resolveFolderIntoIndex(deps, input.folderPath);
  if (!resolved.ok) return resolved;
  const existingVariants = await deps.globalCatalog.listVariants(input.file.fingerprint);
  if (!existingVariants.ok) return existingVariants;
  const upsertedFile = await deps.globalCatalog.upsertFile({ ...input.file, folderId: resolved.value.folderId });
  if (!upsertedFile.ok) return upsertedFile;
  const upsertedVariant = await deps.globalCatalog.upsertVariant(input.variant, input.languageResolution);
  if (!upsertedVariant.ok) return upsertedVariant;
  if (existingVariants.value.length === 0) {
    const selected = await deps.globalCatalog.setSelectedVariant(input.file.fingerprint, input.variant.configId);
    if (!selected.ok) return selected;
  }
  const selectedConfigId = await deps.globalCatalog.getSelectedConfigId(input.file.fingerprint);
  if (!selectedConfigId.ok) return selectedConfigId;
  if (selectedConfigId.value === null) {
    return { ok: false, error: appError('internal', 'Processed variant has no selected configuration') };
  }
  const folder = await deps.globalCatalog.getFolder(resolved.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) return ok({ snapshotSkipped: false, selectedConfigId: selectedConfigId.value });
  if (!resolved.value.persistent) return ok({ snapshotSkipped: true, selectedConfigId: selectedConfigId.value });
  const snapshot = await exportFolderSnapshot(deps, folder.value);
  if (!snapshot.ok) {
    if (isReadOnlyWriteError(snapshot.error)) {
      return ok({ snapshotSkipped: true, selectedConfigId: selectedConfigId.value });
    }
    return snapshot;
  }
  return ok({ snapshotSkipped: false, selectedConfigId: selectedConfigId.value });
};

export const reconcileFolderPresence = async (
  deps: CatalogIndexDeps,
  input: {
    folderPath: string;
    presentFingerprints: readonly string[];
    fingerprintsPresentElsewhere?: readonly string[];
    markMissing?: boolean;
    now?: number;
  },
): Promise<Result<ReconcileFolderResult, AppError>> => {
  const marker = await readFolderMarker(deps.fs, input.folderPath);
  if (!marker.ok) return marker;
  if (marker.value === null) return ok({ marked: 0, cleared: 0 });
  return deps.globalCatalog.reconcileFolder({
    folderId: marker.value.folderId,
    presentFingerprints: input.presentFingerprints,
    ...(input.fingerprintsPresentElsewhere === undefined
      ? {}
      : { fingerprintsPresentElsewhere: input.fingerprintsPresentElsewhere }),
    ...(input.markMissing === undefined ? {} : { markMissing: input.markMissing }),
    now: input.now ?? Date.now(),
  });
};

export interface CatalogFolderRecord {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  missing: boolean;
  missingAt: number | null;
}

export const folderCatalogRecords = async (
  deps: CatalogIndexDeps,
  input: { folder: string },
): Promise<Result<{ records: CatalogFolderRecord[] }, AppError>> => {
  const marker = await readFolderMarker(deps.fs, input.folder);
  if (!marker.ok) return marker;
  if (marker.value === null) return ok({ records: [] });
  const records = await deps.globalCatalog.listFolderRecords(marker.value.folderId);
  if (!records.ok) return records;
  const healed = await healRestoredRecords(deps, marker.value.folderId, input.folder, records.value);
  if (!healed.ok) return healed;
  return ok({
    records: records.value.map((record) => {
      const restored = healed.value.has(record.file.fingerprint);
      return {
        fingerprint: record.file.fingerprint,
        fileName: record.file.fileName,
        finalName: record.analysis?.finalName ?? null,
        missing: !restored && record.file.missingAt !== null,
        missingAt: restored ? null : record.file.missingAt,
      };
    }),
  });
};

const restoredFingerprints = async (
  fs: FileSystemPort,
  folderPath: string,
  missingRecords: readonly CatalogFileRecord[],
): Promise<Result<Set<string>, AppError>> => {
  const restored = new Set<string>();
  const entries = await fs.listDirectory(folderPath);
  if (!entries.ok) return ok(restored);
  const presentByName = new Map<string, string>();
  for (const entry of entries.value) {
    if (entry.kind !== 'file' || !isSupportedVideoExtension(fs.extname(entry.name))) continue;
    presentByName.set(fs.basename(entry.path), entry.path);
  }

  for (const record of missingRecords) {
    const candidateNames = [record.file.fileName, record.analysis?.finalName ?? null]
      .filter((name): name is string => name !== null)
      .map((name) => fs.basename(name));
    const diskPath = candidateNames.map((name) => presentByName.get(name)).find((path) => path !== undefined);
    if (diskPath === undefined) continue;
    const hash = await fs.partialContentHash(diskPath);
    // A file the app cannot read stays marked missing, exactly as the scan path treats an
    // unreadable video as untracked; failing here would take the whole folder down with it.
    if (!hash.ok) continue;
    if (hash.value === record.file.fingerprint) restored.add(record.file.fingerprint);
  }
  return ok(restored);
};

export const healRestoredRecords = async (
  deps: CatalogIndexDeps,
  folderId: string,
  folderPath: string,
  records: readonly CatalogFileRecord[],
): Promise<Result<Set<string>, AppError>> => {
  const missingRecords = records.filter((record) => record.file.missingAt !== null);
  if (missingRecords.length === 0) return ok(new Set());
  const restored = await restoredFingerprints(deps.fs, folderPath, missingRecords);
  if (!restored.ok) return restored;
  if (restored.value.size > 0) {
    const cleared = await deps.globalCatalog.reconcileFolder({
      folderId,
      presentFingerprints: [...restored.value],
      markMissing: false,
      now: Date.now(),
    });
    if (!cleared.ok) return cleared;
  }
  return restored;
};

export const forgetCatalogEntry = async (
  deps: CatalogIndexDeps,
  input: { fingerprint: string },
): Promise<Result<ForgetCatalogEntryResult, AppError>> => {
  const forgotten = await deps.globalCatalog.forgetEntry(input.fingerprint);
  if (!forgotten.ok) return forgotten;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  for (const cropPath of forgotten.value.cropPaths) {
    const deleted = await deps.fs.deleteFile(reanchorFaceCropPath(currentCatalogDir, cropPath));
    if (!deleted.ok) return deleted;
  }
  if (forgotten.value.folderId === null) return ok({ ...forgotten.value, snapshotSkipped: false });
  const folder = await deps.globalCatalog.getFolder(forgotten.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) return ok({ ...forgotten.value, snapshotSkipped: false });
  const snapshot = await exportFolderSnapshot(deps, folder.value);
  if (snapshot.ok) return ok({ ...forgotten.value, snapshotSkipped: false });
  if (!isReadOnlyWriteError(snapshot.error)) return snapshot;
  return ok({ ...forgotten.value, snapshotSkipped: true });
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
  const latestRun = await deps.globalCatalog.latestDriveRun();
  if (!latestRun.ok) return latestRun;
  const month = spendMonth(new Date());
  const spend = deps.spendLedger === undefined
    ? ok({ entries: 0, estimatedCostUsd: 0 })
    : await deps.spendLedger.total({ provider: 'gemini', month });
  if (!spend.ok) return spend;
  return ok({
    databasePath: deps.globalCatalog.databasePath(),
    durability: deps.globalCatalog.durabilityStatus(),
    counts: counts.value,
    folders: folders.value.map(toStatusFolder),
    latestRun: latestRun.value,
    currentMonthSpend: {
      kind: 'estimate',
      provider: 'gemini',
      month,
      entries: spend.value.entries,
      estimatedCostUsd: spend.value.estimatedCostUsd,
    },
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

  const rebuiltSearch = await deps.globalCatalog.rebuildSearchIndex();
  if (!rebuiltSearch.ok) return rebuiltSearch;

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
