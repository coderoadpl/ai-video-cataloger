import type { z } from 'zod';

import type { catalogTreeOutputSchema } from '@core/contract/index.js';

import type { CatalogVideo } from './catalog-video.js';

export type CatalogTreeData = z.output<typeof catalogTreeOutputSchema>;

export interface CatalogTreeNode {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos: readonly CatalogVideo[];
  pendingCount: number;
  processedCount: number;
  children: CatalogTreeNode[];
}

interface MutableNode {
  path: string;
  name: string;
  relativePath: string;
  depth: number;
  videos: readonly CatalogVideo[];
  directPending: number;
  directProcessed: number;
  children: MutableNode[];
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const joinPath = (root: string, relativePath: string): string => `${root.replace(/\/+$/, '')}/${relativePath}`;

const finalize = (node: MutableNode): CatalogTreeNode => {
  const children = node.children
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(finalize);
  const pendingCount = children.reduce((sum, child) => sum + child.pendingCount, node.directPending);
  const processedCount = children.reduce((sum, child) => sum + child.processedCount, node.directProcessed);
  return {
    path: node.path,
    name: node.name,
    relativePath: node.relativePath,
    depth: node.depth,
    videos: node.videos,
    pendingCount,
    processedCount,
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
      directPending: 0,
      directProcessed: 0,
      children: [],
    };
    nodes.set(relativePath, node);
    if (relativePath !== '') ensure(segments.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  const root = ensure('');
  for (const folder of data.folders) {
    const node = ensure(folder.relativePath);
    node.videos = folder.videos;
    node.directPending = folder.pendingCount;
    node.directProcessed = folder.processedCount;
  }

  return finalize(root);
};
