import { describe, expect, it } from 'vitest';

import { buildRows } from './grid-rows.js';
import { gridTileRows, moveGridFocus, tileRowIndexOf } from './grid-navigation.js';

const section = (fingerprints: string[]) => ({
  items: fingerprints.map((fingerprint) => ({ fingerprint })),
});

const modelFor = (sections: { items: { fingerprint: string }[] }[], columns: number) =>
  gridTileRows(buildRows(sections, columns), sections);

describe('gridTileRows', () => {
  it('lays every section out in visual rows and keeps the row index of the source row list', () => {
    const sections = [section(['a', 'b', 'c']), section(['d'])];
    const tileRows = modelFor(sections, 2);

    expect(tileRows).toEqual([
      { rowIndex: 1, fingerprints: ['a', 'b'] },
      { rowIndex: 2, fingerprints: ['c'] },
      { rowIndex: 4, fingerprints: ['d'] },
    ]);
    expect(tileRowIndexOf(tileRows, 'd')).toBe(4);
    expect(tileRowIndexOf(tileRows, null)).toBeNull();
    expect(tileRowIndexOf(tileRows, 'missing')).toBeNull();
  });
});

describe('moveGridFocus', () => {
  const tileRows = modelFor([section(['a', 'b', 'c', 'd', 'e'])], 2);

  it('walks left and right through the flattened order across row boundaries', () => {
    expect(moveGridFocus(tileRows, 'b', 'right')).toBe('c');
    expect(moveGridFocus(tileRows, 'c', 'left')).toBe('b');
  });

  it('stops at both ends instead of wrapping', () => {
    expect(moveGridFocus(tileRows, 'a', 'left')).toBe('a');
    expect(moveGridFocus(tileRows, 'e', 'right')).toBe('e');
  });

  it('moves by column between rows and clamps onto a shorter last row', () => {
    expect(moveGridFocus(tileRows, 'b', 'down')).toBe('d');
    expect(moveGridFocus(tileRows, 'd', 'up')).toBe('b');
    expect(moveGridFocus(tileRows, 'd', 'down')).toBe('e');
    expect(moveGridFocus(tileRows, 'e', 'up')).toBe('c');
    expect(moveGridFocus(tileRows, 'e', 'down')).toBe('e');
  });

  it('jumps to the first and last tile', () => {
    expect(moveGridFocus(tileRows, 'c', 'home')).toBe('a');
    expect(moveGridFocus(tileRows, 'c', 'end')).toBe('e');
  });

  it('starts at the first tile when nothing is focused yet or the focus went stale', () => {
    expect(moveGridFocus(tileRows, null, 'down')).toBe('a');
    expect(moveGridFocus(tileRows, 'gone', 'right')).toBe('a');
  });

  it('has nothing to focus in an empty grid', () => {
    expect(moveGridFocus([], null, 'home')).toBeNull();
    expect(moveGridFocus([], 'a', 'right')).toBeNull();
  });
});
