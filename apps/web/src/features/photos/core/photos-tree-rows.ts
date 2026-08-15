import type { PhotoListItem } from './photo-list-item.js';
import type { PhotoTreeNode } from './photos-tree-model.js';

export interface PhotoFolderRow {
  kind: 'folder';
  key: string;
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  isRoot: boolean;
  expanded: boolean;
  photoCount: number;
  analysedCount: number;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
}

export interface PhotoStatusRow {
  kind: 'status';
  key: string;
  depth: number;
  variant: 'loading' | 'error';
  error: unknown;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
}

export interface PhotoItemRow {
  kind: 'photo';
  key: string;
  depth: number;
  item: PhotoListItem;
  ancestorContinues: readonly boolean[];
  isLast: boolean;
}

export type PhotoTreeRow = PhotoFolderRow | PhotoStatusRow | PhotoItemRow;

export interface LoadedPhotoFolder {
  items: readonly PhotoListItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export const photoFolderKey = (root: string, relativePath: string): string => `${root}::${relativePath}`;

export const folderNeedsFetch = (node: PhotoTreeNode): boolean => node.directPhotoCount > 0;

export interface BuildPhotoTreeRowsInput {
  roots: readonly PhotoTreeNode[];
  isExpanded: (key: string) => boolean;
  loadedFolder: (key: string) => LoadedPhotoFolder | undefined;
}

export const buildPhotoTreeRows = ({ roots, isExpanded, loadedFolder }: BuildPhotoTreeRowsInput): PhotoTreeRow[] => {
  const rows: PhotoTreeRow[] = [];

  const walk = (node: PhotoTreeNode, ancestorContinues: readonly boolean[], isLast: boolean, isRoot: boolean): void => {
    const key = photoFolderKey(node.root, node.relativePath);
    const expanded = isExpanded(key);
    rows.push({
      kind: 'folder',
      key: `folder:${key}`,
      path: node.path,
      name: node.name,
      relativePath: node.relativePath,
      root: node.root,
      depth: node.depth,
      isRoot,
      expanded,
      photoCount: node.photoCount,
      analysedCount: node.analysedCount,
      ancestorContinues,
      isLast,
    });

    if (!expanded) return;

    const childAncestors = node.depth === 0 ? [] : [...ancestorContinues, !isLast];
    const childDepth = node.depth + 1;
    const hasChildFolders = node.children.length > 0;
    const needsFetch = folderNeedsFetch(node);
    const loaded = needsFetch ? loadedFolder(key) : undefined;

    if (needsFetch && (loaded === undefined || loaded.isLoading || loaded.isError)) {
      rows.push({
        kind: 'status',
        key: `status:${key}`,
        depth: childDepth,
        variant: loaded?.isError === true ? 'error' : 'loading',
        error: loaded?.error ?? null,
        ancestorContinues: childAncestors,
        isLast: !hasChildFolders,
      });
    } else if (loaded !== undefined) {
      loaded.items.forEach((item, index) => {
        rows.push({
          kind: 'photo',
          key: `photo:${key}:${item.fingerprint}`,
          depth: childDepth,
          item,
          ancestorContinues: childAncestors,
          isLast: index === loaded.items.length - 1 && !hasChildFolders,
        });
      });
    }

    node.children.forEach((child, index) => {
      walk(child, childAncestors, index === node.children.length - 1, false);
    });
  };

  roots.forEach((root) => walk(root, [], true, true));
  return rows;
};
