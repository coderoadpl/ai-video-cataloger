import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('GET /api/library/collection', () => {
  it('returns an empty envelope for an empty catalog', async () => {
    const app = buildApp(createInMemoryDeps({ version: '4.5.6' }));

    const response = await app.request('/api/library/collection');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        query: null,
        media: 'all',
        limit: 50,
        total: 0,
        videoTotal: 0,
        photoTotal: 0,
        count: 0,
        items: [],
        nextCursor: null,
      },
    });
  });

  it('merges a video and a photo into one feed, discriminated by media', async () => {
    const deps = createInMemoryDeps({ version: '4.5.6' });
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-4111-8111-111111111111',
      currentPath: '/media/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'v1',
      folderId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      size: 100,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-02T00:00:00.000Z',
      analyzer: null,
      model: null,
      missingAt: null,
      capturedAt: '2026-01-02T00:00:00.000Z',
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await deps.photos.upsertFolder({
      folderId: 'path-aaaaaaaa',
      currentPath: '/media/photos',
      displayName: 'photos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      defaultConfigId: null,
    });
    await deps.photos.upsertPhoto({
      fingerprint: 'ph_0000000000000001',
      folderId: 'path-aaaaaaaa',
      fileName: 'a.jpg',
      currentPath: '/media/photos/a.jpg',
      ext: 'jpg',
      size: 1024,
      width: 100,
      height: 100,
      orientation: 1,
      cameraMake: null,
      cameraModel: null,
      lens: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      exifRating: null,
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedAtSource: 'file_mtime',
      gpsLat: null,
      gpsLon: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      placeName: null,
      placeRegion: null,
      placeCountry: null,
      placeCountryCode: null,
      placeDistanceM: null,
      placeDataset: null,
      discoveredAt: '2026-01-01T00:00:00.000Z',
      exifReadAt: null,
      proxyState: 'pending',
      proxyWidth: null,
      proxyHeight: null,
      thumbState: 'pending',
      missingAt: null,
      selectedConfigId: null,
    });
    const app = buildApp(deps);

    const response = await app.request('/api/library/collection');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.videoTotal).toBe(1);
    expect(body.data.photoTotal).toBe(1);
    expect(body.data.total).toBe(2);
    expect(body.data.items.map((item: { media: string; fingerprint: string }) => item.media).sort()).toEqual(['photo', 'video']);
  });

  it('rejects a malformed cursor as a validation error', async () => {
    const app = buildApp(createInMemoryDeps({ version: '4.5.6' }));

    const response = await app.request('/api/library/collection?cursor=not-a-valid-cursor');
    const body = await response.json();

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('validation');
  });
});
