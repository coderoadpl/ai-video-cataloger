import type { PhotoListItem } from './day-groups.js';

export interface PhotoRoot {
  root: string;
  photos: number;
  missing: number;
  lastScanAt: string;
}

export interface SidebarSection {
  root: string;
  items: PhotoListItem[];
}

const isUnderRoot = (currentPath: string, root: string): boolean =>
  currentPath === root || currentPath.startsWith(`${root}/`);

export const ownerRootFor = (currentPath: string, roots: readonly PhotoRoot[]): string | null =>
  roots.find((root) => isUnderRoot(currentPath, root.root))?.root ?? null;

export const sidebarSections = (
  items: readonly PhotoListItem[],
  roots: readonly PhotoRoot[],
  scope: 'folder' | 'all',
  selectedRoot: string | null,
): SidebarSection[] => {
  if (scope === 'folder') {
    if (selectedRoot === null) return [];
    return [{ root: selectedRoot, items: [...items] }];
  }
  return roots
    .map((root): SidebarSection => ({
      root: root.root,
      items: items.filter((item) => isUnderRoot(item.currentPath, root.root)),
    }))
    .filter((section) => section.items.length > 0);
};
