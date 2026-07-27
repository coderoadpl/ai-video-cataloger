import { derivedFolderId, ok, type AppError, type Result } from '@core/domain/index.js';

import type { CatalogFileRecord, FileSystemPort, GlobalCatalogStore } from '../ports.js';
import { healRestoredRecords, type CatalogFolderRecord } from './catalog-index.js';
import { discoverCatalogFolders } from './process-drive.js';
import { scanFolder, type ScanDeps, type ScanVideo } from './scan.js';
import { readFolderMarker } from './folder-identity.js';

export interface CatalogTreeFolder {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videoCount: number;
  pendingCount: number | null;
  processedCount: number | null;
}

export interface CatalogTreeOutput {
  root: string;
  folders: CatalogTreeFolder[];
  pendingTotal: number;
  processedTotal: number;
  videoTotal: number;
  hasUnknownPending: boolean;
}

export interface ScanTreeDeps extends Pick<ScanDeps, 'fs'> {
  globalCatalog?: GlobalCatalogStore | undefined;
}

const relativeSegments = (fs: FileSystemPort, root: string, path: string): string[] => {
  const segments: string[] = [];
  let current = path;
  while (current !== root) {
    const parent = fs.dirname(current);
    if (parent === current) break;
    segments.unshift(fs.basename(current));
    current = parent;
  }
  return segments;
};

export const scanTree = async (
  deps: ScanTreeDeps,
  input: { folder: string },
): Promise<Result<CatalogTreeOutput, AppError>> => {
  const discovery = await discoverCatalogFolders(deps.fs, { root: input.folder });
  if (!discovery.ok) return discovery;
  const root = discovery.value.root;

  const folders: CatalogTreeFolder[] = [];
  let pendingTotal = 0;
  let processedTotal = 0;
  let videoTotal = 0;
  let hasUnknownPending = false;
  for (const discovered of discovery.value.folders) {
    const counts = await folderCounts(deps, discovered.path, discovered.videoPaths);
    if (!counts.ok) return counts;
    videoTotal += discovered.videoPaths.length;
    if (counts.value.pendingCount === null) {
      hasUnknownPending = true;
    } else {
      pendingTotal += counts.value.pendingCount;
    }
    if (counts.value.processedCount !== null) processedTotal += counts.value.processedCount;
    const segments = relativeSegments(deps.fs, root, discovered.path);
    folders.push({
      path: discovered.path,
      name: discovered.path === root ? deps.fs.basename(root) : segments[segments.length - 1] ?? deps.fs.basename(discovered.path),
      relativePath: segments.join('/'),
      depth: segments.length,
      videoCount: discovered.videoPaths.length,
      pendingCount: counts.value.pendingCount,
      processedCount: counts.value.processedCount,
    });
  }

  return ok({ root, folders, pendingTotal, processedTotal, videoTotal, hasUnknownPending });
};

export interface CatalogTreeAbsentGroup {
  folderPath: string;
  entries: CatalogFolderRecord[];
}

const isUnderRoot = (fs: FileSystemPort, root: string, candidate: string): boolean => {
  const resolved = fs.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}/`) || resolved.startsWith(`${root}\\`);
};

export const catalogTreeAbsentFiles = async (
  deps: ScanTreeDeps,
  input: { folder: string },
): Promise<Result<{ groups: CatalogTreeAbsentGroup[] }, AppError>> => {
  const globalCatalog = deps.globalCatalog;
  if (globalCatalog === undefined) return ok({ groups: [] });
  const root = deps.fs.resolve(input.folder);
  const folders = await globalCatalog.listFolders();
  if (!folders.ok) return folders;
  const groups: CatalogTreeAbsentGroup[] = [];
  for (const folder of folders.value) {
    if (!isUnderRoot(deps.fs, root, folder.currentPath)) continue;
    const records = await globalCatalog.listFolderRecords(folder.folderId);
    if (!records.ok) return records;
    const missingRecords = records.value.filter((record) => record.file.missingAt !== null);
    if (missingRecords.length === 0) continue;

    const restored = await healRestoredRecords(
      { fs: deps.fs, globalCatalog },
      folder.folderId,
      folder.currentPath,
      missingRecords,
    );
    if (!restored.ok) return restored;

    const entries = missingRecords
      .filter((record) => !restored.value.has(record.file.fingerprint))
      .map((record) => ({
        fingerprint: record.file.fingerprint,
        fileName: record.file.fileName,
        finalName: record.analysis?.finalName ?? null,
        missing: true,
        missingAt: record.file.missingAt,
      }));
    if (entries.length > 0) groups.push({ folderPath: folder.currentPath, entries });
  }
  groups.sort((left, right) => left.folderPath.localeCompare(right.folderPath));
  return ok({ groups });
};

export interface ScanTreeFolderDeps extends ScanDeps {
  globalCatalog?: GlobalCatalogStore | undefined;
}

export const scanTreeFolderDetails = async (
  deps: ScanTreeFolderDeps,
  input: { folder: string },
): Promise<Result<{ videos: ScanVideo[] }, AppError>> => {
  const result = await scanFolder(deps, input);
  if (!result.ok) return result;
  return ok({ videos: result.value.videos });
};

const folderCounts = async (
  deps: ScanTreeDeps,
  folder: string,
  videoPaths: readonly string[],
): Promise<Result<{ pendingCount: number | null; processedCount: number | null }, AppError>> => {
  if (deps.globalCatalog === undefined) return ok({ pendingCount: null, processedCount: null });
  const folderId = await indexedFolderId(deps, deps.globalCatalog, folder);
  if (!folderId.ok) return folderId;
  if (folderId.value === null) return ok({ pendingCount: null, processedCount: null });
  const records = await deps.globalCatalog.listFolderRecords(folderId.value);
  if (!records.ok) return records;
  const processedCount = processedDiskNames(deps.fs, records.value, new Set(videoPaths.map((videoPath) => deps.fs.basename(videoPath)))).size;
  return ok({
    pendingCount: Math.max(0, videoPaths.length - processedCount),
    processedCount,
  });
};

// A folder the app cannot write carries no marker: its records live in the global index under the
// path-derived id. Reading only the marker leaves an analysed read-only folder counted as unknown
// forever, and falling back blindly would answer "nothing processed" for a folder the index never
// saw, so the derived id counts only once the index actually holds that folder.
const indexedFolderId = async (
  deps: ScanTreeDeps,
  globalCatalog: GlobalCatalogStore,
  folder: string,
): Promise<Result<string | null, AppError>> => {
  const marker = await readFolderMarker(deps.fs, folder);
  if (!marker.ok) return marker;
  if (marker.value !== null) return ok(marker.value.folderId);
  const derived = derivedFolderId(deps.fs.resolve(folder));
  const indexed = await globalCatalog.getFolder(derived);
  if (!indexed.ok) return indexed;
  return ok(indexed.value === null ? null : derived);
};

const processedDiskNames = (
  fs: FileSystemPort,
  records: readonly CatalogFileRecord[],
  diskNames: ReadonlySet<string>,
): Set<string> => {
  const processed = new Set<string>();
  for (const record of records) {
    if (record.analysis === null || record.file.missingAt !== null) continue;
    const names = [record.file.fileName, record.analysis.finalName].filter((name): name is string => name !== null);
    const match = names.find((name) => diskNames.has(name) || diskNames.has(fs.basename(name)));
    if (match !== undefined) processed.add(match);
  }
  return processed;
};
