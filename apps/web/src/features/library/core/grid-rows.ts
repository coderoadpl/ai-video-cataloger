import type { LibraryItem } from './day-groups.js';

export const columnsForWidth = (containerWidth: number, minTile = 168, gap = 8): number =>
  Math.max(1, Math.floor((containerWidth + gap) / (minTile + gap)));

export interface LibrarySectionLike {
  items: readonly LibraryItem[];
}

export type LibraryGridRow =
  | { kind: 'header'; section: number }
  | { kind: 'tiles'; section: number; start: number; count: number };

export const buildRows = (sections: readonly LibrarySectionLike[], columns: number): LibraryGridRow[] => {
  const rows: LibraryGridRow[] = [];
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

export interface LibraryVisibleRowRange {
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
  rows: readonly LibraryGridRow[],
  overscan = 3,
): LibraryVisibleRowRange => {
  if (rows.length === 0) return { first: 0, last: 0, topOffset: 0, totalHeight: 0 };

  const heightOf = (row: LibraryGridRow): number => (row.kind === 'header' ? headerHeight : rowHeight);
  let cursor = 0;
  const bounds: { offset: number; bottom: number }[] = rows.map((row) => {
    const offset = cursor;
    cursor += heightOf(row);
    return { offset, bottom: cursor };
  });
  const totalHeight = cursor;

  const lastIndex = rows.length - 1;
  const firstVisibleIndex = bounds.findIndex((bound) => bound.bottom > scrollTop);
  const firstVisible = firstVisibleIndex === -1 ? lastIndex : firstVisibleIndex;

  const viewportBottom = scrollTop + viewportHeight;
  let lastVisible = firstVisible;
  for (let index = firstVisible; index <= lastIndex; index += 1) {
    lastVisible = index;
    if ((bounds[index]?.bottom ?? totalHeight) >= viewportBottom) break;
  }

  const first = Math.max(0, firstVisible - overscan);
  const last = Math.min(lastIndex, lastVisible + overscan);

  return { first, last, topOffset: bounds[first]?.offset ?? 0, totalHeight };
};

export const rowIndexOfFingerprint = (
  sections: readonly LibrarySectionLike[],
  columns: number,
  fingerprint: string,
): number | null => {
  const rows = buildRows(sections, columns);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || row.kind !== 'tiles') continue;
    const section = sections[row.section];
    if (section === undefined) continue;
    const tiles = section.items.slice(row.start, row.start + row.count);
    if (tiles.some((item) => item.fingerprint === fingerprint)) return index;
  }
  return null;
};
