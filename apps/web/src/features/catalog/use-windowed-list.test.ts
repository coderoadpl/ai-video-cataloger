import { describe, expect, it } from 'vitest';

import { windowedRange } from './use-windowed-list.js';

describe('windowedRange', () => {
  it('includes visible rows plus overscan near the top', () => {
    expect(windowedRange({
      itemCount: 100,
      rowHeight: 20,
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
      itemCount: 100,
      rowHeight: 20,
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

  it('clamps overscan and range bounds at the end', () => {
    expect(windowedRange({
      itemCount: 12,
      rowHeight: 24,
      viewportHeight: 96,
      scrollTop: 260,
      overscan: 4,
    })).toEqual({
      start: 6,
      end: 12,
      offsetTop: 144,
      totalHeight: 288,
    });
  });
});
