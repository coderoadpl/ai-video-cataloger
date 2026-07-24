import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { CatalogFileRecord, FileSystemPort, GlobalCatalogStore } from '../ports.js';
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
  countsApproximate: boolean;
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
      countsApproximate: counts.value.countsApproximate,
    });
  }

  return ok({ root, folders, pendingTotal, processedTotal, videoTotal, hasUnknownPending });
};

export const scanTreeFolderDetails = (deps: ScanDeps, input: { folder: string }): Promise<Result<{ videos: ScanVideo[] }, AppError>> =>
  scanFolder(deps, input).then((result) => result.ok ? ok({ videos: result.value.videos }) : result);

const folderCounts = async (
  deps: ScanTreeDeps,
  folder: string,
  videoPaths: readonly string[],
): Promise<Result<{ pendingCount: number | null; processedCount: number | null; countsApproximate: boolean }, AppError>> => {
  if (deps.globalCatalog === undefined) return ok({ pendingCount: null, processedCount: null, countsApproximate: false });
  const marker = await readFolderMarker(deps.fs, folder);
  if (!marker.ok) return marker;
  if (marker.value === null) return ok({ pendingCount: null, processedCount: null, countsApproximate: false });
  const records = await deps.globalCatalog.listFolderRecords(marker.value.folderId);
  if (!records.ok) return records;
  const processedCount = processedDiskNames(deps.fs, records.value, new Set(videoPaths.map((videoPath) => deps.fs.basename(videoPath)))).size;
  return ok({
    pendingCount: Math.max(0, videoPaths.length - processedCount),
    processedCount,
    countsApproximate: true,
  });
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
