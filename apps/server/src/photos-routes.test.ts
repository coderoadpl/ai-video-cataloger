import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

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
        counts: { photos: 0, paths: 0, exifRead: 0, exifFailed: 0, missing: 0, duplicates: 0, proxied: 0, proxyFailed: 0, analysed: 0 },
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
});
