export const columnsForWidth = (containerWidth: number, minTile = 168, gap = 8): number =>
  Math.max(1, Math.floor((containerWidth + gap) / (minTile + gap)));

export interface LibrarySectionLike {
  items: readonly { fingerprint: string }[];
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

export interface LibraryRowBound {
  offset: number;
  bottom: number;
}

export const rowBounds = (
  rows: readonly LibraryGridRow[],
  rowHeight: number,
  headerHeight: number,
): LibraryRowBound[] => {
  let cursor = 0;
  return rows.map((row) => {
    const offset = cursor;
    cursor += row.kind === 'header' ? headerHeight : rowHeight;
    return { offset, bottom: cursor };
  });
};

export const visibleRowRange = (
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerHeight: number,
  rows: readonly LibraryGridRow[],
  overscan = 3,
): LibraryVisibleRowRange => {
  if (rows.length === 0) return { first: 0, last: 0, topOffset: 0, totalHeight: 0 };

  const bounds = rowBounds(rows, rowHeight, headerHeight);
  const totalHeight = bounds[bounds.length - 1]?.bottom ?? 0;

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


export const renderedRowIndexes = (
  range: Pick<LibraryVisibleRowRange, 'first' | 'last'>,
  activeRowIndex: number | null,
): number[] => {
  const indexes: number[] = [];
  for (let index = range.first; index <= range.last; index += 1) indexes.push(index);
  if (activeRowIndex !== null && (activeRowIndex < range.first || activeRowIndex > range.last)) {
    indexes.push(activeRowIndex);
  }
  return indexes;
};
