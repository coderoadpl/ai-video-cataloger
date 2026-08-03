import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('GET /api/library/preview', () => {
  it('returns size, duration, transcript and people for a known fingerprint', async () => {
    const deps = createInMemoryDeps({ version: '4.5.6' });
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-4111-8111-111111111111',
      currentPath: '/media/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-preview',
      folderId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      size: 2048,
      durationS: 65,
      width: null,
      height: null,
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
    await deps.globalCatalog.upsertAnalysis({
      fingerprint: 'fp-preview',
      finalName: null,
      description: 'a clip',
      transcript: 'hello there',
      language: 'en',
      tags: ['drone'],
    });
    await deps.globalCatalog.upsertPerson({
      personId: 'person-a',
      displayName: 'Ada',
      kind: 'face',
      createdAt: '2026-01-01T00:00:00.000Z',
      centroid: Array.from({ length: 128 }, () => 0.1),
      exemplarCount: 1,
    });
    await deps.globalCatalog.upsertFaceObservation({
      obsId: 'obs-1',
      fingerprint: 'fp-preview',
      kind: 'face',
      media: 'video',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      embedding: Array.from({ length: 128 }, () => 0.2),
      quality: 0.9,
      personId: 'person-a',
      cropPath: null,
    });
    const app = buildApp(deps);

    const response = await app.request('/api/library/preview?fingerprint=fp-preview');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        fingerprint: 'fp-preview',
        path: '/media/videos/clip.mp4',
        fileName: 'clip.mp4',
        size: 2048,
        sizeFormatted: '2.0 KB',
        durationS: 65,
        durationFormatted: '1:05',
        transcript: 'hello there',
        transcriptSegments: null,
        width: null,
        height: null,
        rotation: null,
        people: [{ personId: 'person-a', displayName: 'Ada' }],
      },
    });
  });

  it('returns not_found for an unknown fingerprint', async () => {
    const app = buildApp(createInMemoryDeps({ version: '4.5.6' }));

    const response = await app.request('/api/library/preview?fingerprint=missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
