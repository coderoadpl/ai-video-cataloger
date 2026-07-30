import type { DaySection } from './day-groups.js';

export const flattenOrder = (sections: readonly DaySection[]): string[] =>
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
