import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';
import { discoverCatalogFolders } from './process-drive.js';
import { scanFolder, type ScanDeps, type ScanVideo } from './scan.js';

export interface CatalogTreeFolder {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos: ScanVideo[];
  pendingCount: number;
  processedCount: number;
}

export interface CatalogTreeOutput {
  root: string;
  folders: CatalogTreeFolder[];
  pendingTotal: number;
  processedTotal: number;
}

const isPending = (status: ScanVideo['status']): boolean =>
  status === 'pending' || status === 'not_tracked';

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
  deps: ScanDeps,
  input: { folder: string },
): Promise<Result<CatalogTreeOutput, AppError>> => {
  const discovery = await discoverCatalogFolders(deps.fs, { root: input.folder });
  if (!discovery.ok) return discovery;
  const root = discovery.value.root;

  const folders: CatalogTreeFolder[] = [];
  let pendingTotal = 0;
  let processedTotal = 0;
  for (const discovered of discovery.value.folders) {
    const scan = await scanFolder(deps, { folder: discovered.path });
    if (!scan.ok) return scan;
    const videos = scan.value.videos;
    const pendingCount = videos.filter((video) => isPending(video.status)).length;
    const processedCount = videos.filter((video) => video.status === 'completed').length;
    pendingTotal += pendingCount;
    processedTotal += processedCount;
    const segments = relativeSegments(deps.fs, root, discovered.path);
    folders.push({
      path: discovered.path,
      name: discovered.path === root ? deps.fs.basename(root) : segments[segments.length - 1] ?? deps.fs.basename(discovered.path),
      relativePath: segments.join('/'),
      depth: segments.length,
      videos,
      pendingCount,
      processedCount,
    });
  }

  return ok({ root, folders, pendingTotal, processedTotal });
};
