import { type CatalogVideo } from './catalog-video.js';
import { type CatalogTreeNode } from './catalog-tree-model.js';

export interface FolderCountsData {
  known: boolean;
  pending: number;
  done: number;
  duplicates: number;
  videoCount: number;
}

export interface FolderRow {
  kind: 'folder';
  key: string;
  relativePath: string;
  name: string;
  path: string;
  depth: number;
  isRoot: boolean;
  expanded: boolean;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
  counts: FolderCountsData;
}

export interface VideoRow {
  kind: 'video';
  key: string;
  depth: number;
  video: CatalogVideo;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
}

export interface StatusRow {
  kind: 'status';
  key: string;
  depth: number;
  variant: 'loading' | 'error';
  error: unknown;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
}

export type TreeRow = FolderRow | VideoRow | StatusRow;

export interface LoadedFolder {
  videos: readonly CatalogVideo[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export interface BuildTreeRowsInput {
  root: CatalogTreeNode;
  rootVideos: readonly CatalogVideo[];
  isExpanded: (relativePath: string) => boolean;
  loadedFolder: (relativePath: string) => LoadedFolder | undefined;
}

const directVideoCountOf = (node: CatalogTreeNode): number => node.directVideoCount ?? node.videos.length;

export const folderNeedsFetch = (node: CatalogTreeNode): boolean =>
  node.relativePath !== '' && directVideoCountOf(node) > 0 && node.videos.length === 0;

export const countsFromVideos = (videos: readonly CatalogVideo[]): FolderCountsData => {
  let duplicates = 0;
  let done = 0;
  for (const video of videos) {
    if (video.duplicate != null) duplicates += 1;
    else if (video.status === 'completed') done += 1;
  }
  return { known: true, pending: videos.length - done - duplicates, done, duplicates, videoCount: videos.length };
};

const countsForFolder = (node: CatalogTreeNode, ownVideos: readonly CatalogVideo[] | undefined): FolderCountsData => {
  if (ownVideos !== undefined) return countsFromVideos(ownVideos);
  if (node.directPendingCount !== null && node.directProcessedCount !== null) {
    return {
      known: true,
      pending: node.directPendingCount,
      done: node.directProcessedCount,
      duplicates: 0,
      videoCount: directVideoCountOf(node),
    };
  }
  return { known: false, pending: 0, done: 0, duplicates: 0, videoCount: directVideoCountOf(node) };
};

export const buildTreeRows = ({ root, rootVideos, isExpanded, loadedFolder }: BuildTreeRowsInput): TreeRow[] => {
  const rows: TreeRow[] = [];

  const walk = (node: CatalogTreeNode, ancestorContinues: readonly boolean[], isLast: boolean): void => {
    const isRoot = node.relativePath === '';
    const expanded = isRoot ? isExpanded('') : isExpanded(node.relativePath);
    const loaded = isRoot ? undefined : loadedFolder(node.relativePath);
    const ownVideos = isRoot
      ? rootVideos
      : node.videos.length > 0
        ? node.videos
        : loaded?.videos;

    rows.push({
      kind: 'folder',
      key: `folder:${node.relativePath}`,
      relativePath: node.relativePath,
      name: node.name,
      path: node.path,
      depth: node.depth,
      isRoot,
      expanded,
      ancestorContinues,
      isLast,
      counts: countsForFolder(node, ownVideos),
    });

    if (!expanded) return;

    const childAncestors = node.depth === 0 ? [] : [...ancestorContinues, !isLast];
    const childDepth = node.depth + 1;
    const hasChildFolders = node.children.length > 0;

    if (ownVideos === undefined && folderNeedsFetch(node)) {
      rows.push({
        kind: 'status',
        key: `status:${node.relativePath}`,
        depth: childDepth,
        variant: loaded?.isError === true ? 'error' : 'loading',
        error: loaded?.error ?? null,
        ancestorContinues: childAncestors,
        isLast: !hasChildFolders,
      });
    } else if (ownVideos !== undefined) {
      ownVideos.forEach((video, index) => {
        const lastVideo = index === ownVideos.length - 1 && !hasChildFolders;
        rows.push({
          kind: 'video',
          key: `video:${video.path}`,
          depth: childDepth,
          video,
          ancestorContinues: childAncestors,
          isLast: lastVideo,
        });
      });
    }

    node.children.forEach((child, index) => {
      walk(child, childAncestors, index === node.children.length - 1);
    });
  };

  walk(root, [], true);
  return rows;
};
