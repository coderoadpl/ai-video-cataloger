import { describe, expect, it } from 'vitest';

import { compareUtf8Bytes } from './text-order.js';

describe('compareUtf8Bytes', () => {
  it('orders uppercase before lowercase, the way SQLite BINARY does', () => {
    expect(compareUtf8Bytes('Gamma.jpg', 'alpha.jpg')).toBeLessThan(0);
    expect(['Gamma.jpg', 'alpha.jpg', 'Beta.mp4'].sort(compareUtf8Bytes)).toEqual(['Beta.mp4', 'Gamma.jpg', 'alpha.jpg']);
  });

  it('orders a prefix before its extension and reports equality', () => {
    expect(compareUtf8Bytes('a', 'ab')).toBeLessThan(0);
    expect(compareUtf8Bytes('ab', 'a')).toBeGreaterThan(0);
    expect(compareUtf8Bytes('ab', 'ab')).toBe(0);
  });

  it('orders non-ascii names by their utf-8 bytes, not by locale rules', () => {
    expect(compareUtf8Bytes('zebra.jpg', 'ćma.jpg')).toBeLessThan(0);
    expect(compareUtf8Bytes('a.jpg', 'ą.jpg')).toBeLessThan(0);
  });
});
