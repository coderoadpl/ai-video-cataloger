import { describe, expect, it } from 'vitest';

import { adjacentFingerprint, ownerPhotoRootFor, type LibraryPhotoRoot } from './photo-nav.js';

const root = (overrides: Partial<LibraryPhotoRoot> & { root: string }): LibraryPhotoRoot => ({
  photos: 1,
  missing: 0,
  lastScanAt: '2024-03-02T10:00:00.000Z',
  ...overrides,
});

describe('ownerPhotoRootFor', () => {
  it('picks the deepest matching root when roots are nested', () => {
    const roots = [root({ root: '/Pictures' }), root({ root: '/Pictures/2024' })];
    expect(ownerPhotoRootFor('/Pictures/2024/beach.jpg', roots)).toBe('/Pictures/2024');
    expect(ownerPhotoRootFor('/Pictures/vacation.jpg', roots)).toBe('/Pictures');
  });

  it('returns null when the path is outside every known root', () => {
    expect(ownerPhotoRootFor('/Elsewhere/photo.jpg', [root({ root: '/Pictures' })])).toBeNull();
  });
});

describe('adjacentFingerprint', () => {
  it('returns the previous and next fingerprint in the order', () => {
    const order = ['a', 'b', 'c'];
    expect(adjacentFingerprint(order, 'b', -1)).toBe('a');
    expect(adjacentFingerprint(order, 'b', 1)).toBe('c');
  });

  it('returns null past either end of the order', () => {
    const order = ['a', 'b'];
    expect(adjacentFingerprint(order, 'a', -1)).toBeNull();
    expect(adjacentFingerprint(order, 'b', 1)).toBeNull();
  });

  it('returns null for a fingerprint not present in the order', () => {
    expect(adjacentFingerprint(['a'], 'missing', 1)).toBeNull();
  });
});
