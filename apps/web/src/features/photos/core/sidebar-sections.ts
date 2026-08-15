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

export const ownerRootFor = (currentPath: string, roots: readonly PhotoRoot[]): string | null => {
  const matches = roots.filter((root) => isUnderRoot(currentPath, root.root));
  if (matches.length === 0) return null;
  return matches.reduce((deepest, candidate) =>
    candidate.root.length > deepest.root.length ? candidate : deepest).root;
};

export const sidebarSections = (
  items: readonly PhotoListItem[],
  scope: 'folder' | 'tree',
  selectedRoot: string | null,
): SidebarSection[] => {
  if (scope === 'folder') {
    if (selectedRoot === null || items.length === 0) return [];
    return [{ root: selectedRoot, items: [...items] }];
  }
  return [];
};
