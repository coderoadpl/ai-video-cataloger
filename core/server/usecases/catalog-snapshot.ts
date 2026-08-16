import {
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  appError,
  newerWins,
  ok,
  snapshotLineSchema,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type Result,
} from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore } from '../ports.js';

export interface CatalogSyncDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

const catalogDirectoryName = '.ai-video-cataloger';
const snapshotFileName = 'catalog.ndjson';

export const folderSnapshotPath = (fs: FileSystemPort, folder: string): string =>
  fs.join(folder, catalogDirectoryName, snapshotFileName);

export const exportFolderSnapshot = async (
  deps: CatalogSyncDeps,
  folder: CatalogFolder,
): Promise<Result<{ path: string; records: number }, AppError>> => {
  const records = await deps.globalCatalog.listFolderRecords(folder.folderId);
  if (!records.ok) return records;

  const lines: string[] = [
    JSON.stringify({
      type: 'header',
      version: CATALOG_SNAPSHOT_SCHEMA_VERSION,
      folder,
      exportedAt: new Date().toISOString(),
    }),
  ];
  for (const record of records.value) {
    const variants = await deps.globalCatalog.listVariants(record.file.fingerprint);
    if (!variants.ok) return variants;
    const selectedConfigId = await deps.globalCatalog.getSelectedConfigId(record.file.fingerprint);
    if (!selectedConfigId.ok) return selectedConfigId;
    lines.push(JSON.stringify({
      type: 'record',
      file: record.file,
      analyses: variants.value,
      selectedConfigId: selectedConfigId.value,
    }));
  }

  const snapshotPath = folderSnapshotPath(deps.fs, folder.currentPath);
  const ensured = await deps.fs.ensureDirectory(deps.fs.dirname(snapshotPath));
  if (!ensured.ok) return ensured;
  const tempPath = `${snapshotPath}.tmp`;
  const written = await deps.fs.writeTextFile(tempPath, `${lines.join('\n')}\n`);
  if (!written.ok) return written;
  const renamed = await deps.fs.renamePath(tempPath, snapshotPath);
  if (!renamed.ok) return renamed;
  return ok({ path: snapshotPath, records: records.value.length });
};

export const importFolderSnapshot = async (
  deps: CatalogSyncDeps,
  folderPath: string,
): Promise<Result<{ imported: number; header: CatalogFolder | null; malformedLines: number }, AppError>> => {
  const content = await deps.fs.readTextFile(folderSnapshotPath(deps.fs, folderPath));
  if (!content.ok) return content;
  if (content.value === null) return ok({ imported: 0, header: null, malformedLines: 0 });

  let imported = 0;
  let malformedLines = 0;
  let header: CatalogFolder | null = null;
  for (const rawLine of content.value.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(trimmed);
    } catch {
      malformedLines += 1;
      continue;
    }
    const parsed = snapshotLineSchema.safeParse(decoded);
    if (!parsed.success) {
      malformedLines += 1;
      continue;
    }
    if (parsed.data.type === 'header') {
      if (parsed.data.version > CATALOG_SNAPSHOT_SCHEMA_VERSION) {
        return {
          ok: false,
          error: appError(
            'snapshot_incompatible',
            `Snapshot schema version ${String(parsed.data.version)} is newer than the supported version ${String(CATALOG_SNAPSHOT_SCHEMA_VERSION)}; upgrade the app to import it`,
          ),
        };
      }
      header = parsed.data.folder;
      continue;
    }
    const applied = 'analysis' in parsed.data
      ? await applyLegacyRecord(deps, parsed.data.file, parsed.data.analysis)
      : await applyRecord(deps, parsed.data.file, parsed.data.analyses, parsed.data.selectedConfigId);
    if (!applied.ok) return applied;
    if (applied.value) imported += 1;
  }
  return ok({ imported, header, malformedLines });
};

const applyRecord = async (
  deps: CatalogSyncDeps,
  file: CatalogFile,
  variants: readonly CatalogVariant[],
  selectedConfigId: string | null,
): Promise<Result<boolean, AppError>> => {
  const existing = await deps.globalCatalog.getFile(file.fingerprint);
  if (!existing.ok) return existing;
  if (existing.value !== null && !newerWins(existing.value.processedAt, file.processedAt)) {
    return ok(false);
  }
  const upsertedFile = await deps.globalCatalog.upsertFile(file);
  if (!upsertedFile.ok) return upsertedFile;
  for (const variant of variants) {
    const languageResolution = variant.resolvedOutputLanguage === null || variant.resolvedTagLanguage === null
      ? undefined
      : { outputLanguage: variant.resolvedOutputLanguage, tagLanguage: variant.resolvedTagLanguage };
    const upsertedVariant = await deps.globalCatalog.upsertVariant(variant, languageResolution);
    if (!upsertedVariant.ok) return upsertedVariant;
  }
  const selected = await deps.globalCatalog.setSelectedVariant(file.fingerprint, selectedConfigId);
  if (!selected.ok) return selected;
  return ok(true);
};

const applyLegacyRecord = async (
  deps: CatalogSyncDeps,
  file: CatalogFile,
  analysis: CatalogAnalysis | null,
): Promise<Result<boolean, AppError>> => {
  const existing = await deps.globalCatalog.getFile(file.fingerprint);
  if (!existing.ok) return existing;
  if (existing.value !== null && !newerWins(existing.value.processedAt, file.processedAt)) {
    return ok(false);
  }
  const upsertedFile = await deps.globalCatalog.upsertFile(file);
  if (!upsertedFile.ok) return upsertedFile;
  if (analysis !== null) {
    const upsertedAnalysis = await deps.globalCatalog.upsertAnalysis(analysis);
    if (!upsertedAnalysis.ok) return upsertedAnalysis;
  }
  return ok(true);
};
