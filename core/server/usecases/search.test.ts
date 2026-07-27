import { describe, expect, it } from 'vitest';

import type { CatalogAnalysis, CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';
import { sanitizeSearchQuery, search } from './search.js';

const folderA: CatalogFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/media/online',
  displayName: 'online',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const folderB: CatalogFolder = {
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/media/offline',
  displayName: 'offline',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const file = (fingerprint: string, folderId: string, fileName: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName,
  size: 100,
  durationS: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: null,
  model: null,
  missingAt: null,
});

const analysis = (
  fingerprint: string,
  input: { finalName?: string; description?: string; transcript?: string; tags?: string[] },
): CatalogAnalysis => ({
  fingerprint,
  finalName: input.finalName ?? null,
  description: input.description ?? null,
  transcript: input.transcript ?? null,
  language: null,
  tags: input.tags ?? [],
});

describe('sanitizeSearchQuery', () => {
  it('ANDs terms, prefix-matches plain terms, and preserves sanitized phrases', () => {
    const sanitized = sanitizeSearchQuery(' drone (bay*) -test "golden gate" Łódź ');

    expect(sanitized.ok && sanitized.value).toEqual({
      match: 'drone* AND bay* AND test* AND "golden gate" AND łódź*',
      rankingTerms: ['drone', 'bay', 'test', 'golden', 'gate', 'łódź'],
    });
  });

  it('rejects syntax-only input before it reaches MATCH', () => {
    expect(sanitizeSearchQuery('*** -- () " "')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});

describe('search', () => {
  it('returns ordered hits with online state, tags and gps presence', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFolder(folderB);
    await store.upsertFile({
      ...file('fp-name', folderA.folderId, 'drone-sunset.mp4'),
      gpsLat: 51.1,
      gpsLon: 17.2,
    });
    await store.upsertAnalysis(analysis('fp-name', { transcript: 'quiet audio', tags: ['aerial'] }));
    await store.upsertFile(file('fp-transcript', folderB.folderId, 'clip.mp4'));
    await store.upsertAnalysis(analysis('fp-transcript', { transcript: 'a long drone transcript', tags: ['field'] }));

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'dron', limit: 10, offset: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.map((row) => row.fingerprint)).toEqual(['fp-name', 'fp-transcript']);
    expect(result.value.results[0]?.folder.online).toBe(true);
    expect(result.value.results[0]?.gps).toEqual({ lat: 51.1, lon: 17.2 });
    expect(result.value.results[1]?.folder.online).toBe(false);
    expect(result.value.results[1]?.tags).toEqual(['field']);
  });

  it('resolves an existing thumbnail path for an online result and null when absent', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    fs.addFile('/media/online/.ai-video-cataloger/thumbnails/renamed.jpg');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFolder(folderB);
    await store.upsertFile(file('fp-thumb', folderA.folderId, 'drone-a.mp4'));
    await store.upsertAnalysis(analysis('fp-thumb', { finalName: 'renamed.mp4', transcript: 'drone', tags: [] }));
    await store.upsertFile(file('fp-nothumb', folderB.folderId, 'drone-b.mp4'));
    await store.upsertAnalysis(analysis('fp-nothumb', { transcript: 'drone', tags: [] }));

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'drone', limit: 10, offset: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const online = result.value.results.find((row) => row.fingerprint === 'fp-thumb');
    const offline = result.value.results.find((row) => row.fingerprint === 'fp-nothumb');
    expect(online?.thumbnailPath).toBe('/media/online/.ai-video-cataloger/thumbnails/renamed.jpg');
    expect(offline?.thumbnailPath).toBeNull();
  });

  it('generates a missing thumbnail for an online hit with completed analysis', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-lazy-thumb', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-lazy-thumb', { description: 'drone flight' }));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.thumbnailPath)
      .toBe('/media/online/.ai-video-cataloger/thumbnails/drone.jpg');
    expect(media.thumbnailInputs).toEqual([{
      videoPath: '/media/online/drone.mp4',
      thumbnailPath: '/media/online/.ai-video-cataloger/thumbnails/drone.jpg',
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: false,
    }]);
  });

  it('does not generate a thumbnail for a hit without completed analysis', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-pending', folderA.folderId, 'drone.mp4'));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.thumbnailPath).toBeNull();
    expect(media.thumbnailInputs).toEqual([]);
  });
});
