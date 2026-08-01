import { describe, expect, it } from 'vitest';

import { gradientIndexFor, middleEllipsis } from './placeholder-gradient.js';

describe('gradientIndexFor', () => {
  it('is deterministic for the same name', () => {
    expect(gradientIndexFor('clip.mp4')).toBe(gradientIndexFor('clip.mp4'));
  });

  it('spans indices 0-5 across a sample of names', () => {
    const names = ['a.mp4', 'bb.mp4', 'ccc.mp4', 'dddd.mp4', 'eeeee.mp4', 'ffffff.mp4', 'gggggg.mp4', 'zzzzzzzz.mp4'];
    const indices = new Set(names.map((name) => gradientIndexFor(name)));
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(5);
    }
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe('middleEllipsis', () => {
  it('keeps head and tail with an ellipsis in the middle for long names', () => {
    const result = middleEllipsis('averyveryverylongclipname.mp4', 28);
    expect(result.length).toBeLessThanOrEqual(28);
    expect(result).toContain('…');
    expect(result.startsWith('avery')).toBe(true);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('passes short names through unchanged', () => {
    expect(middleEllipsis('clip.mp4', 28)).toBe('clip.mp4');
  });
});
