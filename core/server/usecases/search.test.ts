import { describe, expect, it } from 'vitest';

import type { CatalogAnalysis, CatalogFile, CatalogFolder, FaceObservation, Person } from '@core/domain/index.js';

import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';
import { buildSearchMatch, libraryPreviewDetail, sanitizeSearchQuery, search, type SearchFiltersInput } from './search.js';

const EMPTY_FILTERS: SearchFiltersInput = {
  tags: [],
  people: [],
  place: null,
  from: null,
  to: null,
  hasGps: null,
  folderId: null,
};

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
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
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

    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(sanitized.value.rankingTerms).toEqual(['drone', 'bay', 'test', 'golden', 'gate', 'łódź']);
    expect(buildSearchMatch(sanitized.value.parts, new Map())).toBe(
      'drone* AND bay* AND test* AND "golden gate" AND łódź*',
    );
  });

  it('rejects syntax-only input before it reaches MATCH', () => {
    expect(sanitizeSearchQuery('*** -- () " "')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});

describe('buildSearchMatch', () => {
  it('expands a term into an alternation when it has an alias equivalent (alias -> canonical)', () => {
    const sanitized = sanitizeSearchQuery('dogs');
    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(buildSearchMatch(sanitized.value.parts, new Map([['dogs', ['psy']]]))).toBe('(dogs* OR psy)');
  });

  it('expands the canonical term back to its aliases (canonical -> alias)', () => {
    const sanitized = sanitizeSearchQuery('psy');
    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(buildSearchMatch(sanitized.value.parts, new Map([['psy', ['dogs']]]))).toBe('(psy* OR dogs)');
  });

  it('renders a multi-word equivalent as a phrase', () => {
    const sanitized = sanitizeSearchQuery('campervan');
    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(buildSearchMatch(sanitized.value.parts, new Map([['campervan', ['camper van']]]))).toBe(
      '(campervan* OR "camper van")',
    );
  });

  it('never expands a quoted phrase even when it has a matching alias', () => {
    const sanitized = sanitizeSearchQuery('"dogs"');
    expect(sanitized.ok).toBe(true);
    if (!sanitized.ok) return;
    expect(buildSearchMatch(sanitized.value.parts, new Map([['dogs', ['psy']]]))).toBe('"dogs"');
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

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'dron', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.map((row) => row.fingerprint)).toEqual(['fp-name', 'fp-transcript']);
    expect(result.value.results[0]?.folder.online).toBe(true);
    expect(result.value.results[0]?.variantCount).toBe(1);
    expect(result.value.results[0]?.gps).toEqual({ lat: 51.1, lon: 17.2 });
    expect(result.value.results[1]?.folder.online).toBe(false);
    expect(result.value.results[1]?.tags).toEqual(['field']);
  });

  it('matches on fileName and finalName alone, with no tag/description/transcript overlap', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-original-name', folderA.folderId, 'amber-jellyfish.mp4'));
    await store.upsertAnalysis(analysis('fp-original-name', {}));
    await store.upsertFile(file('fp-final-name', folderA.folderId, 'raw.mp4'));
    await store.upsertAnalysis(analysis('fp-final-name', { finalName: 'crimson-octopus.mp4' }));
    await store.upsertFile(file('fp-unrelated', folderA.folderId, 'other.mp4'));
    await store.upsertAnalysis(analysis('fp-unrelated', { description: 'unrelated clip' }));

    const byFileName = await search(
      { globalCatalog: store, fs, media: new InMemoryMedia() },
      { query: 'jellyfish', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'existing' as const, limit: 10, offset: 0 },
    );
    expect(byFileName.ok && byFileName.value.results.map((row) => row.fingerprint)).toEqual(['fp-original-name']);

    const byFinalName = await search(
      { globalCatalog: store, fs, media: new InMemoryMedia() },
      { query: 'octopus', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'existing' as const, limit: 10, offset: 0 },
    );
    expect(byFinalName.ok && byFinalName.value.results.map((row) => row.fingerprint)).toEqual(['fp-final-name']);
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

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

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

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.thumbnailPath)
      .toBe('/media/online/.ai-video-cataloger/thumbnails/drone.jpg');
    expect(media.thumbnailInputs).toEqual([{
      videoPath: '/media/online/drone.mp4',
      thumbnailPath: '/media/online/.ai-video-cataloger/thumbnails/drone.jpg',
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: false,
      priority: 'foreground',
    }]);
  });

  it('does not generate a thumbnail for a hit without completed analysis', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-pending', folderA.folderId, 'drone.mp4'));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.thumbnailPath).toBeNull();
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('resolves an existing grid thumbnail path and null when absent', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    fs.addFile('/media/online/.ai-video-cataloger/thumbnails/renamed.grid.jpg');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFolder(folderB);
    await store.upsertFile(file('fp-grid', folderA.folderId, 'drone-a.mp4'));
    await store.upsertAnalysis(analysis('fp-grid', { finalName: 'renamed.mp4', transcript: 'drone', tags: [] }));
    await store.upsertFile(file('fp-nogrid', folderB.folderId, 'drone-b.mp4'));
    await store.upsertAnalysis(analysis('fp-nogrid', { transcript: 'drone', tags: [] }));

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withGrid = result.value.results.find((row) => row.fingerprint === 'fp-grid');
    const withoutGrid = result.value.results.find((row) => row.fingerprint === 'fp-nogrid');
    expect(withGrid?.gridThumbnailPath).toBe('/media/online/.ai-video-cataloger/thumbnails/renamed.grid.jpg');
    expect(withoutGrid?.gridThumbnailPath).toBeNull();
  });

  it('generates a missing grid thumbnail only when a stored analysis frame exists, in ensure mode', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    fs.addFile('/media/online/frames/drone/frame-001.jpg');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-lazy-grid', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-lazy-grid', { description: 'drone flight' }));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.gridThumbnailPath)
      .toBe('/media/online/.ai-video-cataloger/thumbnails/drone.grid.jpg');
    expect(media.thumbnailFromFrameInputs).toContainEqual(expect.objectContaining({
      framePath: '/media/online/frames/drone/frame-001.jpg',
      thumbnailPath: '/media/online/.ai-video-cataloger/thumbnails/drone.grid.jpg',
      width: 512,
      height: 512,
      fit: 'cover',
    }));
  });

  it('never generates a grid thumbnail in existing mode', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    fs.addFile('/media/online/frames/drone/frame-001.jpg');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-existing-mode', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-existing-mode', { description: 'drone flight' }));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'existing' as const, limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.gridThumbnailPath).toBeNull();
    expect(media.thumbnailFromFrameInputs).toEqual([]);
  });

  it('does not invent a grid thumbnail from source when no frame is stored', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-no-frame', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-no-frame', { description: 'drone flight' }));

    const result = await search({ globalCatalog: store, fs, media }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result.ok && result.value.results[0]?.gridThumbnailPath).toBeNull();
    expect(media.thumbnailFromFrameInputs).toEqual([]);
  });

  it('expands the match handed to the store through a tag alias in both directions', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.aliasTag({ from: 'dogs', to: 'psy' });

    await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'dogs', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });
    expect(store.lastSearchInput?.match).toBe('(dogs* OR psy)');

    await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'psy', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });
    expect(store.lastSearchInput?.match).toBe('(psy* OR dogs)');
  });

  it('propagates an expandTagTerms failure as a failed Result', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    store.expandTagTerms = () => Promise.resolve({ ok: false, error: { code: 'read_error', message: 'boom' } });

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, { query: 'drone', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'ensure' as const, limit: 10, offset: 0 });

    expect(result).toEqual({ ok: false, error: { code: 'read_error', message: 'boom' } });
  });

  it('passes structured filters through to the store, expanding tags with their aliases', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.aliasTag({ from: 'psy', to: 'dogs' });

    await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, {
      query: null,
      filters: { ...EMPTY_FILTERS, tags: ['dogs'], people: ['person-1'], place: 'wroc', from: '2026-01-01', to: '2026-01-31', hasGps: true, folderId: folderA.folderId },
      sort: 'captured_desc',
      thumbnails: 'ensure',
      limit: 10,
      offset: 0,
    });

    expect(store.lastSearchInput?.filters).toEqual({
      tagTermSets: [['dogs', 'psy']],
      personIds: ['person-1'],
      place: 'wroc',
      capturedFrom: '2026-01-01',
      capturedTo: '2026-01-31',
      hasGps: true,
      folderId: folderA.folderId,
    });
    expect(store.lastSearchInput?.sort).toBe('captured_desc');
    expect(store.lastSearchInput?.match).toBeNull();
  });

  it('rejects a request with neither a query nor any filter', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, {
      query: null,
      filters: EMPTY_FILTERS,
      sort: undefined,
      thumbnails: 'ensure',
      limit: 10,
      offset: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects an explicit relevance sort without a query', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, {
      query: null,
      filters: { ...EMPTY_FILTERS, tags: ['dogs'] },
      sort: 'relevance',
      thumbnails: 'ensure',
      limit: 10,
      offset: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('allows a Library-style browse-everything request when a sort is stated explicitly', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-browse', folderA.folderId, 'clip.mp4'));

    const result = await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, {
      query: null,
      filters: EMPTY_FILTERS,
      sort: 'captured_desc',
      thumbnails: 'existing',
      limit: 10,
      offset: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.results.map((row) => row.fingerprint)).toEqual(['fp-browse']);
  });

  it('defaults to captured_desc when no query and no explicit sort are given', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);

    await search({ globalCatalog: store, fs, media: new InMemoryMedia() }, {
      query: null,
      filters: { ...EMPTY_FILTERS, tags: ['dogs'] },
      sort: undefined,
      thumbnails: 'ensure',
      limit: 10,
      offset: 0,
    });

    expect(store.lastSearchInput?.sort).toBe('captured_desc');
  });

  it('an "existing" thumbnails mode never falls through to generation, even with completed analysis', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-existing-only', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-existing-only', { description: 'drone flight' }));

    const result = await search({ globalCatalog: store, fs, media }, {
      query: 'drone',
      filters: EMPTY_FILTERS,
      sort: undefined,
      thumbnails: 'existing',
      limit: 10,
      offset: 0,
    });

    expect(result.ok && result.value.results[0]?.thumbnailPath).toBeNull();
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('an "existing" thumbnails mode still returns an on-disk thumbnail without regenerating it', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    fs.addFile('/media/online/.ai-video-cataloger/thumbnails/renamed.jpg');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-existing-hit', folderA.folderId, 'drone-a.mp4'));
    await store.upsertAnalysis(analysis('fp-existing-hit', { finalName: 'renamed.mp4', transcript: 'drone' }));

    const result = await search({ globalCatalog: store, fs, media }, {
      query: 'drone',
      filters: EMPTY_FILTERS,
      sort: undefined,
      thumbnails: 'existing',
      limit: 10,
      offset: 0,
    });

    expect(result.ok && result.value.results[0]?.thumbnailPath).toBe('/media/online/.ai-video-cataloger/thumbnails/renamed.jpg');
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('reports no grid thumbnail when every candidate source is below the grid floor', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addFile('/media/online/drone.mp4');
    fs.addFile('/media/online/frames/drone/frame-001.jpg');
    const media = new InMemoryMedia();
    media.dimensions.set('/media/online/frames/drone/frame-001.jpg', { width: 320, height: 180 });
    media.dimensions.set('/media/online/drone.mp4', { width: 320, height: 180 });
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-tiny-source', folderA.folderId, 'drone.mp4'));
    await store.upsertAnalysis(analysis('fp-tiny-source', { transcript: 'drone' }));

    const result = await search({ globalCatalog: store, fs, media }, {
      query: 'drone',
      filters: EMPTY_FILTERS,
      sort: undefined,
      thumbnails: 'ensure',
      limit: 10,
      offset: 0,
    });

    expect(result.ok && result.value.results[0]?.gridThumbnailPath).toBeNull();
  });
});

const personFor = (personId: string, displayName: string | null): Person => ({
  personId,
  displayName,
  kind: 'face',
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid: Array.from({ length: 128 }, () => 0.1),
  exemplarCount: 1,
});

const observationFor = (obsId: string, fingerprint: string, personId: string | null): FaceObservation => ({
  obsId,
  fingerprint,
  kind: 'face',
  media: 'video',
  frameTsS: 1,
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  embedding: Array.from({ length: 128 }, () => 0.2),
  quality: 0.9,
  personId,
  cropPath: null,
});

describe('libraryPreviewDetail', () => {
  it('combines file size/duration, the selected transcript and the observed people for a preview', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile({
      ...file('fp-preview', folderA.folderId, 'drone-sunset.mp4'),
      size: 12_582_912,
      durationS: 90,
    });
    await store.upsertAnalysis(analysis('fp-preview', { transcript: 'quiet audio over the bay' }));
    await store.upsertPerson(personFor('person-a', 'Ada'));
    await store.upsertFaceObservation(observationFor('obs-1', 'fp-preview', 'person-a'));

    const result = await libraryPreviewDetail({ globalCatalog: store, fs, media: new InMemoryMedia() }, { fingerprint: 'fp-preview' });

    expect(result).toEqual({
      ok: true,
      value: {
        fingerprint: 'fp-preview',
        path: '/media/online/drone-sunset.mp4',
        fileName: 'drone-sunset.mp4',
        size: 12_582_912,
        sizeFormatted: '12.0 MB',
        durationS: 90,
        durationFormatted: '1:30',
        transcript: 'quiet audio over the bay',
        transcriptSegments: null,
        width: null,
        height: null,
        rotation: null,
        people: [{ personId: 'person-a', displayName: 'Ada' }],
      },
    });
  });

  it('reports not_found for an unknown fingerprint', async () => {
    const fs = new InMemoryFileSystem('/media');
    const store = new InMemoryGlobalCatalogStore();

    const result = await libraryPreviewDetail({ globalCatalog: store, fs, media: new InMemoryMedia() }, { fingerprint: 'missing' });

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('adds timestamped transcript segments and the source dimensions for an online tile, mirroring the details player', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    fs.addFile('/media/online/transcripts/drone-sunset.txt', { content: 'Hello there.' });
    fs.addFile(
      '/media/online/transcripts/drone-sunset.json',
      { content: JSON.stringify([{ start: 0, end: 2, text: 'Hello there.' }]) },
    );
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-preview', folderA.folderId, 'drone-sunset.mp4'));
    await store.upsertAnalysis(analysis('fp-preview', { transcript: 'Hello there.' }));
    const media = new InMemoryMedia();
    media.dimensions.set('/media/online/drone-sunset.mp4', { width: 720, height: 1280 });

    const result = await libraryPreviewDetail({ globalCatalog: store, fs, media }, { fingerprint: 'fp-preview' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        transcriptSegments: [{ start: 0, end: 2, text: 'Hello there.' }],
        width: 720,
        height: 1280,
        rotation: null,
      },
    });
  });

  it('leaves player fields null for an online tile with no transcript artifacts on disk', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/online');
    const store = new InMemoryGlobalCatalogStore();
    await store.upsertFolder(folderA);
    await store.upsertFile(file('fp-preview', folderA.folderId, 'drone-sunset.mp4'));
    await store.upsertAnalysis(analysis('fp-preview', {}));

    const result = await libraryPreviewDetail({ globalCatalog: store, fs, media: new InMemoryMedia() }, { fingerprint: 'fp-preview' });

    expect(result).toMatchObject({
      ok: true,
      value: { transcriptSegments: null, width: null, height: null, rotation: null },
    });
  });
});
