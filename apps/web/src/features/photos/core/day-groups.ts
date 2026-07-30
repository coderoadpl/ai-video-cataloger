import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

export type PhotoListItem = z.output<typeof photoListItemSchema>;

export interface DaySection {
  day: string | null;
  label: string;
  items: PhotoListItem[];
}

export const groupByCaptureDay = (
  items: readonly PhotoListItem[],
  toLocalDay: (isoUtc: string) => string,
): DaySection[] => {
  const dated: DaySection[] = [];
  const byDay = new Map<string, DaySection>();
  const untimed: PhotoListItem[] = [];

  for (const item of items) {
    if (item.capturedAt === null) {
      untimed.push(item);
      continue;
    }
    const day = toLocalDay(item.capturedAt);
    const existing = byDay.get(day);
    if (existing !== undefined) {
      existing.items.push(item);
      continue;
    }
    const section: DaySection = { day, label: day, items: [item] };
    byDay.set(day, section);
    dated.push(section);
  }

  if (untimed.length === 0) return dated;
  return [...dated, { day: null, label: '', items: untimed }];
};
