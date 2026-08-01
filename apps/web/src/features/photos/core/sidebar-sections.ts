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
  roots: readonly PhotoRoot[],
  scope: 'folder' | 'all',
  selectedRoot: string | null,
): SidebarSection[] => {
  if (scope === 'folder') {
    if (selectedRoot === null) return [];
    return [{ root: selectedRoot, items: [...items] }];
  }
  const seen = new Set<string>();
  const byRoot = new Map<string, PhotoListItem[]>();
  for (const item of items) {
    const key = `${item.fingerprint}::${item.currentPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = ownerRootFor(item.currentPath, roots);
    if (owner === null) continue;
    const bucket = byRoot.get(owner) ?? [];
    bucket.push(item);
    byRoot.set(owner, bucket);
  }
  return roots
    .map((root): SidebarSection => ({ root: root.root, items: byRoot.get(root.root) ?? [] }))
    .filter((section) => section.items.length > 0);
};
