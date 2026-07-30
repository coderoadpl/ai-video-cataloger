import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

const seedPhoto = async (deps: ReturnType<typeof createInMemoryDeps>): Promise<string> => {
  const folder = {
    folderId: 'path-aaaaaaaa',
    currentPath: '/media/photos',
    displayName: 'photos',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    defaultConfigId: null,
  };
  const fingerprint = 'ph_0000000000000001';
  await deps.photos.upsertFolder(folder);
  await deps.photos.upsertPhoto({
    fingerprint,
    folderId: folder.folderId,
    fileName: 'vacation.jpg',
    currentPath: '/media/photos/vacation.jpg',
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
  return fingerprint;
};

describe('photos routes', () => {
  it('accepts a valid photos scan request and completes the job', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);

    const response = await app.request('/api/photos/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.cwd() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.jobId).toBe('string');
  });

  it('rejects a photos scan request missing the root', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request('/api/photos/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  it('reports not_a_directory when the scan root is a file', async () => {
    const deps = createInMemoryDeps({ files: ['a.jpg'] });
    const app = buildApp(deps);

    const response = await app.request('/api/photos/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.resolve('a.jpg') }),
    });

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_a_directory');
  });

  it('returns a photos status envelope for an empty catalog', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request('/api/photos/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        media: 'photo',
        root: null,
        counts: { photos: 0, paths: 0, exifRead: 0, exifFailed: 0, missing: 0, duplicates: 0, proxied: 0, proxyFailed: 0, analysed: 0, facesIndexed: 0 },
      },
    });
  });

  it('forgets a photo root and returns the summary', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);

    const response = await app.request('/api/photos/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.cwd() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: { media: 'photo', root: deps.fs.cwd(), pathsRemoved: 0, photosDeleted: 0, photosRepointed: 0, artifactPaths: [] },
    });
  });

  it('accepts a valid photos proxies request and completes the job', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);

    const response = await app.request('/api/photos/proxies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.cwd() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.jobId).toBe('string');
  });

  it('reports not_a_directory when the proxies root is a file', async () => {
    const deps = createInMemoryDeps({ files: ['a.jpg'] });
    const app = buildApp(deps);

    const response = await app.request('/api/photos/proxies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.resolve('a.jpg') }),
    });

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_a_directory');
  });

  it('accepts a valid photos process request and completes the job', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);

    const response = await app.request('/api/photos/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.cwd() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.jobId).toBe('string');
  });

  it('reports not_a_directory when the process root is a file', async () => {
    const deps = createInMemoryDeps({ files: ['a.jpg'] });
    const app = buildApp(deps);

    const response = await app.request('/api/photos/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.resolve('a.jpg') }),
    });

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_a_directory');
  });

  it('rejects a photos process batchSize above the closed 1-12 range', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);

    const response = await app.request('/api/photos/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: deps.fs.cwd(), batchSize: 13 }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  it('returns an empty photos tree for a fresh catalog', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request('/api/photos/tree');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { media: 'photo', roots: [] } });
  });

  it('returns an empty paged photos list for a fresh catalog', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request('/api/photos/list');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { media: 'photo', root: null, total: 0, offset: 0, items: [] },
    });
  });

  it('returns not_found for a detail lookup on an unknown fingerprint', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request(`/api/photos/detail?fingerprint=${'ph_0123456789abcdef'}`);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
  });

  it('rejects a malformed fingerprint on detail', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request('/api/photos/detail?fingerprint=not-a-fingerprint');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  it('finds a photo by file name via search before any analysis has run, and rejects an empty query', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);
    await seedPhoto(deps);

    const found = await app.request('/api/photos/search?query=vacation');
    expect(found.status).toBe(200);
    const foundBody = await found.json();
    expect(foundBody.ok).toBe(true);
    expect(foundBody.data.count).toBe(1);

    const empty = await app.request('/api/photos/search?query=');
    expect(empty.status).toBe(400);
    const emptyBody = await empty.json();
    expect(emptyBody.ok).toBe(false);
  });

  it('lists an empty variants set for an un-analysed photo and 404s an unknown variant on select', async () => {
    const deps = createInMemoryDeps();
    const app = buildApp(deps);
    const fingerprint = await seedPhoto(deps);

    const listed = await app.request(`/api/photos/variants?fingerprint=${fingerprint}`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data).toEqual({ media: 'photo', fingerprint, selectedConfigId: null, variants: [] });

    const selected = await app.request('/api/photos/variants/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fingerprint, configId: 'cfg_000000000000' }),
    });
    expect(selected.status).toBe(404);
    const selectedBody = await selected.json();
    expect(selectedBody.error.code).toBe('variant_not_found');
  });

  it('404s a variants list on an unknown fingerprint', async () => {
    const app = buildApp(createInMemoryDeps());

    const response = await app.request(`/api/photos/variants?fingerprint=${'ph_0123456789abcdef'}`);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('file_not_found');
  });
});
