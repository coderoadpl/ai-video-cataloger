import { describe, expect, it } from 'vitest';

import type { PhotoListItem } from './photo-list-item.js';
import type { SidebarSection } from './sidebar-sections.js';
import { adjacentFingerprint, flattenOrder, type OrderSection } from './viewer-nav.js';

const stubItem = (fingerprint: string): PhotoListItem => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath: `/photos/${fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: 100,
  height: 100,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  analysisError: null,
  exifReadAt: null,
});

const sections: OrderSection[] = [
  { items: [stubItem('a'), stubItem('b')] },
  { items: [stubItem('c')] },
];

describe('flattenOrder', () => {
  it('flattens sections into fingerprints in display order', () => {
    expect(flattenOrder(sections)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for no sections', () => {
    expect(flattenOrder([])).toEqual([]);
  });

  it('also flattens sidebar sections, which share the items shape but not the day/label fields', () => {
    const sidebarOrder: SidebarSection[] = [
      { root: '/a', items: [stubItem('x'), stubItem('y')] },
      { root: '/b', items: [stubItem('z')] },
    ];
    expect(flattenOrder(sidebarOrder)).toEqual(['x', 'y', 'z']);
  });
});

describe('adjacentFingerprint', () => {
  const order = flattenOrder(sections);

  it('moves forward and backward across section boundaries', () => {
    expect(adjacentFingerprint(order, 'b', 1)).toBe('c');
    expect(adjacentFingerprint(order, 'c', -1)).toBe('b');
  });

  it('returns null at either edge of the order', () => {
    expect(adjacentFingerprint(order, 'a', -1)).toBeNull();
    expect(adjacentFingerprint(order, 'c', 1)).toBeNull();
  });

  it('returns null when the current fingerprint is not in the order', () => {
    expect(adjacentFingerprint(order, 'missing', 1)).toBeNull();
  });
});
