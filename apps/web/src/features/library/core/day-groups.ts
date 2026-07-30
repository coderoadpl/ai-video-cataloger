import type { z } from 'zod';

import type { searchResultSchema } from '@core/contract/index.js';

export type LibraryItem = z.output<typeof searchResultSchema>;

export interface LibraryDaySection {
  day: string | null;
  items: LibraryItem[];
}

export const groupByCaptureDay = (
  items: readonly LibraryItem[],
  toLocalDay: (isoUtc: string) => string,
): LibraryDaySection[] => {
  const dated: LibraryDaySection[] = [];
  const byDay = new Map<string, LibraryDaySection>();
  const undated: LibraryItem[] = [];

  for (const item of items) {
    if (item.capturedAt === null) {
      undated.push(item);
      continue;
    }
    const day = toLocalDay(item.capturedAt);
    const existing = byDay.get(day);
    if (existing !== undefined) {
      existing.items.push(item);
      continue;
    }
    const section: LibraryDaySection = { day, items: [item] };
    byDay.set(day, section);
    dated.push(section);
  }

  if (undated.length === 0) return dated;
  return [...dated, { day: null, items: undated }];
};
