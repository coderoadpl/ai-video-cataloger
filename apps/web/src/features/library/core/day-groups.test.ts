import { describe, expect, it } from 'vitest';

import { groupByCaptureDay, type LibraryItem } from './day-groups.js';

const item = (overrides: Partial<LibraryItem> & { fingerprint: string }): LibraryItem => ({
  variantCount: 1,
  fileName: `${overrides.fingerprint}.mp4`,
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: null,
  tags: [],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: null,
  place: null,
  ...overrides,
});

const fixedLocalDay = (isoUtc: string): string => isoUtc.slice(0, 10);

describe('groupByCaptureDay', () => {
  it('groups consecutive same-day items and preserves incoming order within a section', () => {
    const items = [
      item({ fingerprint: 'a', capturedAt: '2024-03-02T10:00:00.000Z' }),
      item({ fingerprint: 'b', capturedAt: '2024-03-02T08:00:00.000Z' }),
      item({ fingerprint: 'c', capturedAt: '2024-03-01T09:00:00.000Z' }),
    ];

    const sections = groupByCaptureDay(items, fixedLocalDay);

    expect(sections).toEqual([
      { day: '2024-03-02', items: [items[0], items[1]] },
      { day: '2024-03-01', items: [items[2]] },
    ]);
  });

  it('handles a UTC-midnight boundary through the injected toLocalDay function', () => {
    const items = [item({ fingerprint: 'a', capturedAt: '2024-03-02T00:00:00.000Z' })];
    const shiftedLocalDay = (): string => '2024-03-01';

    const sections = groupByCaptureDay(items, shiftedLocalDay);

    expect(sections).toEqual([{ day: '2024-03-01', items: [items[0]] }]);
  });

  it('collects every null-capturedAt item into one trailing section', () => {
    const items = [
      item({ fingerprint: 'a', capturedAt: '2024-03-02T10:00:00.000Z' }),
      item({ fingerprint: 'b', capturedAt: null }),
      item({ fingerprint: 'c', capturedAt: null }),
    ];

    const sections = groupByCaptureDay(items, fixedLocalDay);

    expect(sections).toEqual([
      { day: '2024-03-02', items: [items[0]] },
      { day: null, items: [items[1], items[2]] },
    ]);
  });

  it('returns an empty array for no items', () => {
    expect(groupByCaptureDay([], fixedLocalDay)).toEqual([]);
  });
});
