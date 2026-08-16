import { describe, expect, it } from 'vitest';

import type { PhotoListItem } from './photo-list-item.js';
import { ownerRootFor, sidebarSections, type PhotoRoot } from './sidebar-sections.js';

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
  analysisError: null,
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
    const sections = sidebarSections(items, 'folder', '/media');

    expect(sections).toEqual([{ root: '/media', items }]);
  });

  it('tree scope never derives global root sections from the flat item list', () => {
    const items = [item('a', '/media/a.jpg'), item('b', '/other/b.jpg'), item('c', '/media/c.jpg')];
    expect(sidebarSections(items, 'tree', '/media')).toEqual([]);
  });

  it('folder scope with a scanned but photo-less root returns no sections, so the sidebar reads as empty rather than as a nameless header', () => {
    expect(sidebarSections([], 'folder', '/media')).toEqual([]);
  });

  it('folder scope with no selected root returns no sections', () => {
    expect(sidebarSections([item('a', '/media/a.jpg')], 'folder', null)).toEqual([]);
  });

  it('folder scope with a scanned but empty selected root returns no sections, not a header with zero items', () => {
    expect(sidebarSections([], 'folder', '/media')).toEqual([]);
  });
});

describe('ownerRootFor', () => {
  it('picks the deepest matching root, not the first one returned', () => {
    const roots = [root({ root: '/Pictures' }), root({ root: '/Pictures/2024' })];

    expect(ownerRootFor('/Pictures/2024/beach.jpg', roots)).toBe('/Pictures/2024');
    expect(ownerRootFor('/Pictures/vacation.jpg', roots)).toBe('/Pictures');
  });

  it('picks the deepest matching root regardless of the roots array order', () => {
    const roots = [root({ root: '/Pictures/2024' }), root({ root: '/Pictures' })];

    expect(ownerRootFor('/Pictures/2024/beach.jpg', roots)).toBe('/Pictures/2024');
  });

  it('returns null when no root matches', () => {
    expect(ownerRootFor('/Elsewhere/photo.jpg', [root({ root: '/Pictures' })])).toBeNull();
  });
});
