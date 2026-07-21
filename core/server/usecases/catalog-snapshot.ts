import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  newerWins,
  ok,
  snapshotLineSchema,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
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
      version: GLOBAL_CATALOG_SCHEMA_VERSION,
      folder,
      exportedAt: new Date().toISOString(),
    }),
  ];
  for (const record of records.value) {
    lines.push(JSON.stringify({ type: 'record', file: record.file, analysis: record.analysis }));
  }

  const snapshotPath = folderSnapshotPath(deps.fs, folder.currentPath);
  const ensured = await deps.fs.ensureDirectory(deps.fs.dirname(snapshotPath));
  if (!ensured.ok) return ensured;
  const written = await deps.fs.writeTextFile(snapshotPath, `${lines.join('\n')}\n`);
  if (!written.ok) return written;
  return ok({ path: snapshotPath, records: records.value.length });
};

export const importFolderSnapshot = async (
  deps: CatalogSyncDeps,
  folderPath: string,
): Promise<Result<{ imported: number; header: CatalogFolder | null }, AppError>> => {
  const content = await deps.fs.readTextFile(folderSnapshotPath(deps.fs, folderPath));
  if (!content.ok) return content;
  if (content.value === null) return ok({ imported: 0, header: null });

  let imported = 0;
  let header: CatalogFolder | null = null;
  for (const rawLine of content.value.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = snapshotLineSchema.safeParse(decoded);
    if (!parsed.success) continue;
    if (parsed.data.type === 'header') {
      header = parsed.data.folder;
      continue;
    }
    const applied = await applyRecord(deps, parsed.data.file, parsed.data.analysis);
    if (!applied.ok) return applied;
    if (applied.value) imported += 1;
  }
  return ok({ imported, header });
};

const applyRecord = async (
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
