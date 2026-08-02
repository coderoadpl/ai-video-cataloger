import { describe, expect, it } from 'vitest';

import type { LibraryItem } from './day-groups.js';
import { groupByFolder, sortItems } from './folder-groups.js';

const item = (fingerprint: string, overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  fingerprint,
  variantCount: 1,
  fileName: `${fingerprint}.mp4`,
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: null,
  tags: [],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: null,
  place: null,
  ...overrides,
});

describe('groupByFolder', () => {
  it('keys sections by folderId and orders sections by display name', () => {
    const items = [
      item('a', { folder: { folderId: 'f2', currentPath: '/b', displayName: 'Beta', online: true, offlineReason: null } }),
      item('b', { folder: { folderId: 'f1', currentPath: '/a', displayName: 'Alpha', online: true, offlineReason: null } }),
    ];

    const sections = groupByFolder(items, 'captured_desc');

    expect(sections.map((section) => section.folderId)).toEqual(['f1', 'f2']);
    expect(sections.map((section) => section.displayName)).toEqual(['Alpha', 'Beta']);
  });

  it('propagates the offline flag from the folder to the whole section', () => {
    const items = [item('a', { folder: { folderId: 'f1', currentPath: '/a', displayName: 'Alpha', online: false, offlineReason: 'drive-disconnected' } })];

    const sections = groupByFolder(items, 'captured_desc');

    expect(sections[0]?.offline).toBe(true);
  });

  it('propagates offlineReason from the folder to the whole section', () => {
    const items = [item('a', { folder: { folderId: 'f1', currentPath: '/a', displayName: 'Alpha', online: false, offlineReason: 'file-missing' } })];

    const sections = groupByFolder(items, 'captured_desc');

    expect(sections[0]?.offlineReason).toBe('file-missing');
  });

  it('sorts items within a section by the active sort', () => {
    const items = [
      item('a', { capturedAt: '2026-01-01T00:00:00.000Z' }),
      item('b', { capturedAt: '2026-03-01T00:00:00.000Z' }),
    ];

    const sections = groupByFolder(items, 'captured_asc');

    expect(sections[0]?.items.map((entry) => entry.fingerprint)).toEqual(['a', 'b']);
  });
});

describe('sortItems', () => {
  it('sorts by name when a text query is not active', () => {
    const items = [item('b', { finalName: 'zebra.mp4' }), item('a', { finalName: 'apple.mp4' })];
    expect(sortItems(items, 'name_asc').map((entry) => entry.fingerprint)).toEqual(['a', 'b']);
  });

  it('keeps insertion order for relevance (already scored upstream)', () => {
    const items = [item('b'), item('a')];
    expect(sortItems(items, 'relevance').map((entry) => entry.fingerprint)).toEqual(['b', 'a']);
  });
});
