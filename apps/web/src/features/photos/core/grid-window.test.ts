import { describe, expect, it } from 'vitest';

import type { DaySection } from './day-groups.js';
import { buildRows, columnsForWidth, visibleRowRange, type GridRow } from './grid-window.js';
import type { PhotoListItem } from './day-groups.js';

const stubItem = (fingerprint: string): PhotoListItem => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath: `/photos/${fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: 100,
  height: 100,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  proxyPath: null,
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
    const sections: DaySection[] = [
      { day: 'd1', label: 'd1', items: [stubItem('a'), stubItem('b'), stubItem('c')] },
      { day: 'd2', label: 'd2', items: [stubItem('d')] },
    ];

    const rows = buildRows(sections, 2);

    expect(rows).toEqual<GridRow[]>([
      { kind: 'header', section: 0 },
      { kind: 'tiles', section: 0, start: 0, count: 2 },
      { kind: 'tiles', section: 0, start: 2, count: 1 },
      { kind: 'header', section: 1 },
      { kind: 'tiles', section: 1, start: 0, count: 1 },
    ]);
  });

  it('emits only a header row for an empty section', () => {
    const sections: DaySection[] = [{ day: 'd1', label: 'd1', items: [] }];

    expect(buildRows(sections, 3)).toEqual<GridRow[]>([{ kind: 'header', section: 0 }]);
  });
});

describe('visibleRowRange', () => {
  const rows: GridRow[] = [
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

  it('windows a fifty-thousand-photo library to a bounded row count anywhere in the list', () => {
    const sections: DaySection[] = Array.from({ length: 500 }, (_, section) => ({
      day: `d${String(section)}`,
      label: `d${String(section)}`,
      items: Array.from({ length: 100 }, (_, item) => stubItem(`s${String(section)}-${String(item)}`)),
    }));
    const bigRows = buildRows(sections, 6);
    expect(bigRows).toHaveLength(500 + 500 * Math.ceil(100 / 6));

    const rowHeight = 180;
    const headerHeight = 40;
    const totalHeight = 500 * headerHeight + 500 * Math.ceil(100 / 6) * rowHeight;
    for (const scrollTop of [0, totalHeight / 2, totalHeight]) {
      const range = visibleRowRange(scrollTop, 900, rowHeight, headerHeight, bigRows, 3);
      expect(range.totalHeight).toBe(totalHeight);
      expect(range.last - range.first).toBeLessThanOrEqual(16);
      expect(range.first).toBeGreaterThanOrEqual(0);
      expect(range.last).toBeLessThanOrEqual(bigRows.length - 1);
    }
  });
});
