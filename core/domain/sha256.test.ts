import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256.js';

const nodeSha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto across lengths, block boundaries and multibyte input', () => {
    const samples = [
      'a',
      'zażółć gęślą jaźń — Hurtigrutemuseet 🚢',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(63),
      'x'.repeat(64),
      'x'.repeat(65),
      JSON.stringify({ nested: { keys: [1, 2, 3], value: 'cfg' } }).repeat(20),
    ];
    for (const sample of samples) expect(sha256Hex(sample)).toBe(nodeSha256(sample));
  });
});
