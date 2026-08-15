import type { PhotoListItem } from './photo-list-item.js';

export interface OrderSection {
  items: readonly PhotoListItem[];
}

export const flattenOrder = (sections: readonly OrderSection[]): string[] =>
  sections.flatMap((section) => section.items.map((item) => item.fingerprint));

export const adjacentFingerprint = (
  order: readonly string[],
  current: string,
  delta: 1 | -1,
): string | null => {
  const index = order.indexOf(current);
  if (index === -1) return null;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= order.length) return null;
  return order[nextIndex] ?? null;
};
