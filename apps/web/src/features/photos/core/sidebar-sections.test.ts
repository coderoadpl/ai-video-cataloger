import { describe, expect, it } from 'vitest';

import type { PhotoListItem } from './day-groups.js';
import { sidebarSections, type PhotoRoot } from './sidebar-sections.js';

const item = (fingerprint: string, currentPath: string): PhotoListItem => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath,
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: null,
  height: null,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  exifReadAt: null,
});

const root = (overrides: Partial<PhotoRoot> & { root: string }): PhotoRoot => ({
  photos: 1,
  missing: 0,
  lastScanAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('sidebarSections', () => {
  it('folder scope returns exactly one section for the selected root', () => {
    const items = [item('a', '/media/a.jpg'), item('b', '/media/b.jpg')];
    const roots = [root({ root: '/media' }), root({ root: '/other' })];

    const sections = sidebarSections(items, roots, 'folder', '/media');

    expect(sections).toEqual([{ root: '/media', items }]);
  });

  it('all scope returns one section per root in photosTree order, routing each item by path prefix', () => {
    const items = [item('a', '/media/a.jpg'), item('b', '/other/b.jpg'), item('c', '/media/c.jpg')];
    const roots = [root({ root: '/media' }), root({ root: '/other' })];

    const sections = sidebarSections(items, roots, 'all', null);

    expect(sections).toEqual([
      { root: '/media', items: [items[0], items[2]] },
      { root: '/other', items: [items[1]] },
    ]);
  });

  it('all scope omits a root with no items in the current page', () => {
    const items = [item('a', '/media/a.jpg')];
    const roots = [root({ root: '/media' }), root({ root: '/other' })];

    const sections = sidebarSections(items, roots, 'all', null);

    expect(sections).toEqual([{ root: '/media', items: [items[0]] }]);
  });

  it('folder scope with no selected root returns no sections', () => {
    expect(sidebarSections([item('a', '/media/a.jpg')], [root({ root: '/media' })], 'folder', null)).toEqual([]);
  });
});
