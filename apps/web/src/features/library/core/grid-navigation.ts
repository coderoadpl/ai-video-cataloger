import type { LibraryGridRow, LibrarySectionLike } from './grid-rows.js';

export interface GridTileRow {
  rowIndex: number;
  fingerprints: string[];
}

export type GridMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

export const gridTileRows = (
  rows: readonly LibraryGridRow[],
  sections: readonly LibrarySectionLike[],
): GridTileRow[] => {
  const tileRows: GridTileRow[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== 'tiles') return;
    const section = sections[row.section];
    if (section === undefined) return;
    tileRows.push({
      rowIndex,
      fingerprints: section.items.slice(row.start, row.start + row.count).map((item) => item.fingerprint),
    });
  });
  return tileRows;
};

const locate = (
  tileRows: readonly GridTileRow[],
  fingerprint: string,
): { row: number; column: number } | null => {
  for (const [row, tileRow] of tileRows.entries()) {
    const column = tileRow.fingerprints.indexOf(fingerprint);
    if (column !== -1) return { row, column };
  }
  return null;
};

const firstFingerprint = (tileRows: readonly GridTileRow[]): string | null =>
  tileRows[0]?.fingerprints[0] ?? null;

const lastFingerprint = (tileRows: readonly GridTileRow[]): string | null => {
  const lastRow = tileRows[tileRows.length - 1];
  return lastRow === undefined ? null : lastRow.fingerprints[lastRow.fingerprints.length - 1] ?? null;
};

const flatOrder = (tileRows: readonly GridTileRow[]): string[] =>
  tileRows.flatMap((tileRow) => tileRow.fingerprints);

export const moveGridFocus = (
  tileRows: readonly GridTileRow[],
  current: string | null,
  move: GridMove,
): string | null => {
  if (tileRows.length === 0) return null;
  if (move === 'home') return firstFingerprint(tileRows);
  if (move === 'end') return lastFingerprint(tileRows);
  if (current === null) return firstFingerprint(tileRows);
  const position = locate(tileRows, current);
  if (position === null) return firstFingerprint(tileRows);

  if (move === 'left' || move === 'right') {
    const order = flatOrder(tileRows);
    const index = order.indexOf(current);
    const next = index + (move === 'right' ? 1 : -1);
    return order[next] ?? current;
  }

  const nextRow = tileRows[position.row + (move === 'down' ? 1 : -1)];
  if (nextRow === undefined) return current;
  const column = Math.min(position.column, nextRow.fingerprints.length - 1);
  return nextRow.fingerprints[column] ?? current;
};

export const tileRowIndexOf = (tileRows: readonly GridTileRow[], fingerprint: string | null): number | null => {
  if (fingerprint === null) return null;
  const position = locate(tileRows, fingerprint);
  return position === null ? null : tileRows[position.row]?.rowIndex ?? null;
};
