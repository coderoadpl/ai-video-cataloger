import type { z } from 'zod';

import type { catalogTreeOutputSchema } from '@core/contract/index.js';

import type { CatalogVideo } from './catalog-video.js';

type ContractCatalogTreeData = z.output<typeof catalogTreeOutputSchema>;

interface CatalogTreeFolderData {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos?: readonly CatalogVideo[] | undefined;
  videoCount?: number | undefined;
  pendingCount: number | null;
  processedCount: number | null;
}

export type CatalogTreeData = Omit<ContractCatalogTreeData, 'folders' | 'videoTotal' | 'hasUnknownPending'> & {
  folders: readonly CatalogTreeFolderData[];
  videoTotal?: number | undefined;
  hasUnknownPending?: boolean | undefined;
};

export interface CatalogTreeNode {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos: readonly CatalogVideo[];
  directVideoCount?: number | undefined;
  videoCount?: number | undefined;
  pendingCount: number | null;
  processedCount: number | null;
  directPendingCount: number | null;
  directProcessedCount: number | null;
  children: CatalogTreeNode[];
}

interface MutableNode {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos: readonly CatalogVideo[];
  videoCount: number;
  directPending: number;
  directProcessed: number;
  hasUnknownPending: boolean;
  children: MutableNode[];
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const joinPath = (root: string, relativePath: string): string => `${root.replace(/\/+$/, '')}/${relativePath}`;

const finalize = (node: MutableNode): CatalogTreeNode => {
  const children = node.children
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(finalize);
  const pendingCount = children.reduce((sum, child) => sum + (child.pendingCount ?? 0), node.directPending);
  const processedCount = children.reduce((sum, child) => sum + (child.processedCount ?? 0), node.directProcessed);
  const hasUnknownPending = node.hasUnknownPending || children.some((child) => child.pendingCount === null);
  return {
    path: node.path,
    name: node.name,
    relativePath: node.relativePath,
    depth: node.depth,
    videos: node.videos,
    directVideoCount: node.videoCount,
    videoCount: children.reduce((sum, child) => sum + (child.videoCount ?? 0), node.videoCount),
    pendingCount: hasUnknownPending ? null : pendingCount,
    processedCount,
    directPendingCount: node.hasUnknownPending ? null : node.directPending,
    directProcessedCount: node.hasUnknownPending ? null : node.directProcessed,
    children,
  };
};

export const flattenTreeVideos = (node: CatalogTreeNode): CatalogVideo[] => [
  ...node.videos,
  ...node.children.flatMap(flattenTreeVideos),
];

export const buildCatalogTree = (data: CatalogTreeData): CatalogTreeNode => {
  const rootName = basename(data.root);
  const nodes = new Map<string, MutableNode>();

  const ensure = (relativePath: string): MutableNode => {
    const existing = nodes.get(relativePath);
    if (existing !== undefined) return existing;
    const segments = relativePath === '' ? [] : relativePath.split('/');
    const node: MutableNode = {
      path: relativePath === '' ? data.root : joinPath(data.root, relativePath),
      name: relativePath === '' ? rootName : segments[segments.length - 1] ?? rootName,
      relativePath,
      depth: segments.length,
      videos: [],
      videoCount: 0,
      directPending: 0,
      directProcessed: 0,
      hasUnknownPending: false,
      children: [],
    };
    nodes.set(relativePath, node);
    if (relativePath !== '') ensure(segments.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  const root = ensure('');
  for (const folder of data.folders) {
    const node = ensure(folder.relativePath);
    node.videos = folder.videos ?? [];
    node.videoCount = folder.videoCount ?? node.videos.length;
    node.directPending = folder.pendingCount ?? 0;
    node.directProcessed = folder.processedCount ?? 0;
    node.hasUnknownPending = folder.pendingCount === null;
  }

  return finalize(root);
};
