import { describe, expect, it } from 'vitest';

import type { LibraryDaySection, LibraryItem } from './day-groups.js';
import { buildRows, columnsForWidth, visibleRowRange, type LibraryGridRow } from './grid-rows.js';

const stubItem = (fingerprint: string): LibraryItem => ({
  fingerprint,
  variantCount: 1,
  fileName: `${fingerprint}.mp4`,
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
  width: null,
  height: null,
});

describe('columnsForWidth', () => {
  it('computes column count from container width, tile minimum and gap', () => {
    expect(columnsForWidth(360, 168, 8)).toBe(2);
    expect(columnsForWidth(168, 168, 8)).toBe(1);
    expect(columnsForWidth(0, 168, 8)).toBe(1);
  });
});

describe('buildRows', () => {
  it('builds a header row per section plus tile rows chunked by column count', () => {
    const sections: LibraryDaySection[] = [
      { day: 'd1', items: [stubItem('a'), stubItem('b'), stubItem('c')] },
      { day: 'd2', items: [stubItem('d')] },
    ];

    const rows = buildRows(sections, 2);

    expect(rows).toEqual<LibraryGridRow[]>([
      { kind: 'header', section: 0 },
      { kind: 'tiles', section: 0, start: 0, count: 2 },
      { kind: 'tiles', section: 0, start: 2, count: 1 },
      { kind: 'header', section: 1 },
      { kind: 'tiles', section: 1, start: 0, count: 1 },
    ]);
  });

  it('emits only a header row for an empty section', () => {
    const sections: LibraryDaySection[] = [{ day: 'd1', items: [] }];

    expect(buildRows(sections, 3)).toEqual<LibraryGridRow[]>([{ kind: 'header', section: 0 }]);
  });
});

describe('visibleRowRange', () => {
  const rows: LibraryGridRow[] = [
    { kind: 'header', section: 0 },
    { kind: 'tiles', section: 0, start: 0, count: 2 },
    { kind: 'tiles', section: 0, start: 2, count: 2 },
    { kind: 'tiles', section: 0, start: 4, count: 2 },
    { kind: 'tiles', section: 0, start: 6, count: 2 },
    { kind: 'tiles', section: 0, start: 8, count: 2 },
  ];

  it('returns the full document extent for an empty row list', () => {
    expect(visibleRowRange(0, 400, 100, 40, [])).toEqual({ first: 0, last: 0, topOffset: 0, totalHeight: 0 });
  });

  it('windows to the visible rows with overscan clamped to the row-list bounds', () => {
    const range = visibleRowRange(240, 100, 100, 40, rows, 1);

    expect(range.totalHeight).toBe(40 + 100 * 5);
    expect(range.first).toBe(2);
    expect(range.last).toBeLessThanOrEqual(rows.length - 1);
    expect(range.topOffset).toBe(140);
  });

  it('clamps the range at the start and end of the row list', () => {
    const atTop = visibleRowRange(0, 50, 100, 40, rows, 5);
    expect(atTop.first).toBe(0);

    const atBottom = visibleRowRange(10_000, 50, 100, 40, rows, 5);
    expect(atBottom.last).toBe(rows.length - 1);
  });
});
