import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { catalogLocationSchema, searchResultSchema } from '@core/contract/index.js';

import { previewFromLocation, previewFromSearchResult } from './preview-media.js';

type SearchResult = z.output<typeof searchResultSchema>;
type CatalogLocation = z.output<typeof catalogLocationSchema>;

const searchResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  fingerprint: 'fp-1',
  variantCount: 1,
  fileName: 'clip.mp4',
  finalName: null,
  description: 'a description',
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: null,
  tags: ['beach'],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: '2026-01-02T10:00:00.000Z',
  place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 10, dataset: 'test' },
  width: null,
  height: null,
  ...overrides,
});

const location = (overrides: Partial<CatalogLocation> = {}): CatalogLocation => ({
  fingerprint: 'fp-2',
  media: 'video',
  fileName: 'clip.mp4',
  finalName: null,
  thumbPath: null,
  lat: 1,
  lon: 2,
  missing: false,
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
  },
  source: null,
  accuracyM: null,
  intervalKind: null,
  place: null,
  ...overrides,
});

describe('previewFromSearchResult', () => {
  it('maps finalName over fileName when present', () => {
    expect(previewFromSearchResult(searchResult({ finalName: 'Renamed.mp4' })).title).toBe('Renamed.mp4');
  });

  it('falls back to fileName when finalName is null', () => {
    expect(previewFromSearchResult(searchResult({ finalName: null, fileName: 'clip.mp4' })).title).toBe('clip.mp4');
  });

  it('joins folder path and file name into the full path', () => {
    expect(previewFromSearchResult(searchResult()).path).toBe('/videos/clip.mp4');
  });

  it('keeps tags, place and capturedAt', () => {
    const preview = previewFromSearchResult(searchResult());
    expect(preview.tags).toEqual(['beach']);
    expect(preview.placeName).toBe('Fjordvik');
    expect(preview.capturedAt).toBe('2026-01-02T10:00:00.000Z');
  });

  it('keeps the gps coordinates, or null when absent', () => {
    expect(previewFromSearchResult(searchResult({ gps: { lat: 51.1, lon: 17.2 } })).gps).toEqual({ lat: 51.1, lon: 17.2 });
    expect(previewFromSearchResult(searchResult({ gps: null })).gps).toBeNull();
  });

  it('keeps the folder offlineReason', () => {
    expect(previewFromSearchResult(searchResult({
      folder: { folderId: '11111111-1111-4111-8111-111111111111', currentPath: '/videos', displayName: 'videos', online: false, offlineReason: 'file-missing' },
    })).offlineReason).toBe('file-missing');
    expect(previewFromSearchResult(searchResult()).offlineReason).toBeNull();
  });

  it('prefers the grid thumbnail for the poster, falling back to the small thumbnail', () => {
    expect(previewFromSearchResult(searchResult({ gridThumbnailPath: '/thumbs/clip.grid.jpg', thumbnailPath: '/thumbs/clip.jpg' })).posterPath)
      .toBe('/thumbs/clip.grid.jpg');
    expect(previewFromSearchResult(searchResult({ gridThumbnailPath: null, thumbnailPath: '/thumbs/clip.jpg' })).posterPath)
      .toBe('/thumbs/clip.jpg');
    expect(previewFromSearchResult(searchResult({ gridThumbnailPath: null, thumbnailPath: null })).posterPath).toBeNull();
  });
});

describe('previewFromLocation', () => {
  it('returns null for a photo location', () => {
    expect(previewFromLocation(location({ media: 'photo', fileName: 'a.jpg' }))).toBeNull();
  });

  it('maps a row-sparse item for a video location', () => {
    const preview = previewFromLocation(location());
    expect(preview).not.toBeNull();
    expect(preview?.description).toBeNull();
    expect(preview?.tags).toEqual([]);
    expect(preview?.capturedAt).toBeNull();
    expect(preview?.path).toBe('/videos/clip.mp4');
  });

  it('uses the location thumbPath as the poster', () => {
    expect(previewFromLocation(location({ thumbPath: '/thumbs/clip.jpg' }))?.posterPath).toBe('/thumbs/clip.jpg');
  });

  it('maps the location lat/lon into gps', () => {
    expect(previewFromLocation(location({ lat: 51.1, lon: 17.2 }))?.gps).toEqual({ lat: 51.1, lon: 17.2 });
  });

  it('reports drive-disconnected for an offline location, which carries no finer offlineReason', () => {
    const preview = previewFromLocation(location({
      folder: { folderId: '11111111-1111-4111-8111-111111111111', currentPath: '/videos', displayName: 'videos', online: false },
    }));
    expect(preview?.offlineReason).toBe('drive-disconnected');
  });

  it('reports no offlineReason for an online location', () => {
    expect(previewFromLocation(location())?.offlineReason).toBeNull();
  });
});
