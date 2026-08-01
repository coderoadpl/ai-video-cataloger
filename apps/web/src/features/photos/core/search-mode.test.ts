import { describe, expect, it } from 'vitest';

import { searchResultsToItems, searchSections, type PhotosSearchResult } from './search-mode.js';

const result = (overrides: Partial<PhotosSearchResult> = {}): PhotosSearchResult => ({
  fingerprint: 'ph_0000000000000001',
  fileName: 'a.jpg',
  currentPath: '/photos/a.jpg',
  ext: 'jpg',
  capturedAt: '2026-01-01T00:00:00.000Z',
  description: 'a red bicycle',
  snippet: 'a red <mark>bicycle</mark>',
  tags: ['bicycle'],
  variantCount: 1,
  thumbState: 'done',
  proxyState: 'done',
  missingAt: null,
  thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
  gridThumbPath: '/artifacts/thumbs/ph_0000000000000001.grid.jpg',
  proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
  ...overrides,
});

describe('searchResultsToItems', () => {
  it('maps every rendered field, passing thumbPath/gridThumbPath/proxyPath through and forcing sightings to 1', () => {
    const items = searchResultsToItems([result()]);
    expect(items).toEqual([{
      fingerprint: 'ph_0000000000000001',
      fileName: 'a.jpg',
      currentPath: '/photos/a.jpg',
      ext: 'jpg',
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedAtSource: null,
      width: null,
      height: null,
      proxyState: 'done',
      thumbState: 'done',
      missingAt: null,
      sightings: 1,
      thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
      gridThumbPath: '/artifacts/thumbs/ph_0000000000000001.grid.jpg',
      proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
    }]);
  });

  it('maps a missing/pending result with null artifact paths', () => {
    const items = searchResultsToItems([result({
      thumbState: 'pending',
      proxyState: 'pending',
      thumbPath: null,
      proxyPath: null,
      missingAt: 1700000000,
    })]);
    expect(items[0]).toMatchObject({ thumbState: 'pending', proxyState: 'pending', thumbPath: null, proxyPath: null, missingAt: 1700000000 });
  });

  it('returns an empty array for empty results', () => {
    expect(searchResultsToItems([])).toEqual([]);
  });
});

describe('searchSections', () => {
  it('produces one flat section carrying the given label, day null', () => {
    const items = searchResultsToItems([result()]);
    const sections = searchSections(items, '1 result');
    expect(sections).toEqual([{ day: null, label: '1 result', items }]);
  });

  it('produces one flat empty section for no results', () => {
    expect(searchSections([], '0 results')).toEqual([{ day: null, label: '0 results', items: [] }]);
  });
});
