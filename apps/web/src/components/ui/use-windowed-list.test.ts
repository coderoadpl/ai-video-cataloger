import { describe, expect, it } from 'vitest';

import { windowedRange } from './use-windowed-list.js';

const uniform = (count: number, rowHeight: number): number[] => Array.from({ length: count }, () => rowHeight);

describe('windowedRange', () => {
  it('includes visible rows plus overscan near the top', () => {
    expect(windowedRange({
      rowHeights: uniform(100, 20),
      viewportHeight: 100,
      scrollTop: 0,
      overscan: 2,
    })).toEqual({
      start: 0,
      end: 7,
      offsetTop: 0,
      totalHeight: 2_000,
    });
  });

  it('calculates middle slices and offset from scroll position', () => {
    expect(windowedRange({
      rowHeights: uniform(100, 20),
      viewportHeight: 100,
      scrollTop: 240,
      overscan: 3,
    })).toEqual({
      start: 9,
      end: 20,
      offsetTop: 180,
      totalHeight: 2_000,
    });
  });

  it('clamps scroll beyond content to the last valid window', () => {
    expect(windowedRange({
      rowHeights: uniform(12, 24),
      viewportHeight: 96,
      scrollTop: 260,
      overscan: 4,
    })).toEqual({
      start: 4,
      end: 12,
      offsetTop: 96,
      totalHeight: 288,
    });
  });

  it('renders the remaining rows when itemCount shrinks below the scroll position', () => {
    expect(windowedRange({
      rowHeights: uniform(5, 20),
      viewportHeight: 100,
      scrollTop: 1_000,
      overscan: 2,
    })).toEqual({
      start: 0,
      end: 5,
      offsetTop: 0,
      totalHeight: 100,
    });
  });

  it('accounts for taller error rows in offsets and total height', () => {
    expect(windowedRange({
      rowHeights: [96, 120, 96, 96],
      viewportHeight: 100,
      scrollTop: 0,
      overscan: 0,
    })).toEqual({
      start: 0,
      end: 2,
      offsetTop: 0,
      totalHeight: 408,
    });
  });
});
