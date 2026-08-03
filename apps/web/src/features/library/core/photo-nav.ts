import type { z } from 'zod';

import type { photosTreeOutputSchema } from '@core/contract/index.js';

export type LibraryPhotoRoot = z.output<typeof photosTreeOutputSchema>['roots'][number];

const isUnderRoot = (currentPath: string, root: string): boolean =>
  currentPath === root || currentPath.startsWith(`${root}/`);

export const ownerPhotoRootFor = (currentPath: string, roots: readonly LibraryPhotoRoot[]): string | null => {
  const matches = roots.filter((root) => isUnderRoot(currentPath, root.root));
  if (matches.length === 0) return null;
  return matches.reduce((deepest, candidate) => candidate.root.length > deepest.root.length ? candidate : deepest).root;
};

export const adjacentPhotoFingerprint = (order: readonly string[], current: string, delta: 1 | -1): string | null => {
  const index = order.indexOf(current);
  if (index === -1) return null;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= order.length) return null;
  return order[nextIndex] ?? null;
};
