import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { catalogLocationSchema } from '@core/contract/index.js';

import { previewFromLocation } from './preview-media.js';

type CatalogLocation = z.output<typeof catalogLocationSchema>;

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
