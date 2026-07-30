import type { DaySection } from './day-groups.js';

export const columnsForWidth = (containerWidth: number, minTile = 168, gap = 8): number =>
  Math.max(1, Math.floor((containerWidth + gap) / (minTile + gap)));

export type GridRow =
  | { kind: 'header'; section: number }
  | { kind: 'tiles'; section: number; start: number; count: number };

export const buildRows = (sections: readonly DaySection[], columns: number): GridRow[] => {
  const rows: GridRow[] = [];
  sections.forEach((section, sectionIndex) => {
    rows.push({ kind: 'header', section: sectionIndex });
    for (let start = 0; start < section.items.length; start += columns) {
      rows.push({
        kind: 'tiles',
        section: sectionIndex,
        start,
        count: Math.min(columns, section.items.length - start),
      });
    }
  });
  return rows;
};

export interface VisibleRowRange {
  first: number;
  last: number;
  topOffset: number;
  totalHeight: number;
}

export const visibleRowRange = (
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerHeight: number,
  rows: readonly GridRow[],
  overscan = 3,
): VisibleRowRange => {
  if (rows.length === 0) return { first: 0, last: 0, topOffset: 0, totalHeight: 0 };

  const heightOf = (row: GridRow | undefined): number => (row?.kind === 'header' ? headerHeight : rowHeight);
  const offsetOf = (index: number): number => {
    let offset = 0;
    for (let cursor = 0; cursor < index; cursor += 1) offset += heightOf(rows[cursor]);
    return offset;
  };

  const lastIndex = rows.length - 1;
  const viewportBottom = scrollTop + viewportHeight;

  let bottom = 0;
  let firstVisible = -1;
  let lastVisible = -1;
  for (let index = 0; index <= lastIndex; index += 1) {
    bottom += heightOf(rows[index]);
    if (firstVisible === -1 && bottom > scrollTop) firstVisible = index;
    if (firstVisible !== -1 && lastVisible === -1 && bottom >= viewportBottom) lastVisible = index;
  }

  const firstRow = firstVisible === -1 ? lastIndex : firstVisible;
  const lastRow = lastVisible === -1 ? lastIndex : lastVisible;
  const first = Math.max(0, firstRow - overscan);

  return {
    first,
    last: Math.min(lastIndex, lastRow + overscan),
    topOffset: offsetOf(first),
    totalHeight: bottom,
  };
};
