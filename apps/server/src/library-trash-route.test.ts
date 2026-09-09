import { describe, expect, it, vi } from 'vitest';

import { API_ROUTES, libraryTrashSummarySchema, looseEnvelopeSchema } from '@core/contract/index.js';

import { type AppDeps } from './composition.js';
import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

const now = '2026-01-01T00:00:00.000Z';

const responsePayload = async (response: Response): Promise<unknown> => {
  const envelope = looseEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
};

const waitForCompletedJob = async (
  deps: AppDeps,
  jobId: string,
): Promise<ReturnType<typeof API_ROUTES.jobStatus.output.parse>> => {
  for (let poll = 0; poll < 100; poll += 1) {
    const response = await deps.jobs.get(jobId);
    if (!response.ok) throw new Error(response.error.message);
    if (response.value !== null && response.value.status === 'completed') {
      return API_ROUTES.jobStatus.output.parse(response.value);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Job did not complete');
};

describe('POST /api/library/trash', () => {
  it.each([
    { path: API_ROUTES.indexForget.path, input: { fingerprint: 'missing' } },
    { path: API_ROUTES.facesPurge.path, input: { force: true } },
    { path: API_ROUTES.facesForget.path, input: { personId: 'missing', force: true } },
    { path: API_ROUTES.photosForget.path, input: { root: '/media/videos' } },
  ])('CAT-05 synchronous mutation $path participates in backup catalog-write exclusion', async ({ path, input }) => {
    const deps = createInMemoryDeps({ version: '4.5.6', workingDirectory: '/media/videos', files: [] });
    const acquire = vi.spyOn(deps.jobs, 'acquireResource');
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: '/media/videos', homeDirectory: '/media/home', processName: 'gui' },
      () => deps,
    );
    try {
      const response = await app.honoApp.request(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(response.status).not.toBe(500);
      expect(acquire).toHaveBeenCalledWith('catalog-write', expect.any(AbortSignal));
    } finally {
      await app.dispose();
    }
  });

  it.each([API_ROUTES.indexForget.path, API_ROUTES.facesPurge.path])('cancels a queued catalog mutation at %s without waiting for the holder', async (route) => {
    const deps = createInMemoryDeps({ version: '4.5.6', workingDirectory: '/media/videos', files: [] });
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: '/media/videos', homeDirectory: '/media/home', processName: 'gui' },
      () => deps,
    );
    const held = await deps.jobs.acquireResource('catalog-write');
    if (!held.ok) throw new Error(held.error.message);
    const controller = new AbortController();
    let entered = () => {};
    const queued = new Promise<void>((resolve) => { entered = resolve; });
    const acquire = deps.jobs.acquireResource.bind(deps.jobs);
    vi.spyOn(deps.jobs, 'acquireResource').mockImplementation((key, signal) => {
      const result = acquire(key, signal);
      entered();
      return result;
    });
    const mutate = vi.spyOn(deps.globalCatalog, 'flush');
    const request = app.honoApp.request(route, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fingerprint: 'missing', force: true }), signal: controller.signal,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await queued;
      controller.abort();
      const response = await Promise.race([
        request,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), scaledTimeout(250)); }),
      ]);
      expect(response).not.toBeNull();
      if (response === null) return;
      expect(looseEnvelopeSchema.parse(await response.json())).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      held.value();
      await request;
      await app.dispose();
    }
  });

  it('returns a trash plan for dry-run requests through the app contract', async () => {
    const deps = createInMemoryDeps({
      version: '4.5.6',
      workingDirectory: '/media/videos',
      files: ['clip.mp4'],
    });
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: '/media/videos', homeDirectory: '/media/home', processName: 'gui' },
      () => deps,
    );
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-4111-8111-111111111111',
      currentPath: '/media/videos',
      displayName: 'videos',
      firstSeenAt: now,
      lastSeenAt: now,
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-trash-dry-run',
      folderId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      size: 1024,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: now,
      analyzer: null,
      model: null,
      missingAt: null,
      hiddenAt: null,
      capturedAt: now,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });

    try {
      const trashResponse = await app.honoApp.request(API_ROUTES.libraryTrash.path, {
        method: API_ROUTES.libraryTrash.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: { kind: 'fingerprints', fingerprints: ['fp-trash-dry-run'] },
          confirm: true,
          dryRun: true,
        }),
      });
      expect(trashResponse.status).toBe(200);
      const plan = API_ROUTES.libraryTrash.output.parse(await responsePayload(trashResponse));
      expect(plan).toMatchObject({
        kind: 'plan',
        total: 1,
        hiddenCount: 0,
        visibleCount: 1,
        sharedWithOtherPeople: 0,
        artifactPaths: expect.any(Array),
      });
    } finally {
      await app.dispose();
    }
  }, scaledTimeout(30_000));

  it('moves selected files through the configured TrashPort and removes them from search and collection', async () => {
    const trashedPaths: string[] = [];
    const deps = createInMemoryDeps({
      version: '4.5.6',
      workingDirectory: '/media/videos',
      files: ['clip.mp4'],
      moveToTrash: (targetPath) => {
        trashedPaths.push(targetPath);
        return Promise.resolve({ ok: true, value: undefined });
      },
    });
    const app = createApp(
      { dbDriver: 'memory', workingDirectory: '/media/videos', homeDirectory: '/media/home', processName: 'gui' },
      () => deps,
    );
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-4111-8111-111111111111',
      currentPath: '/media/videos',
      displayName: 'videos',
      firstSeenAt: now,
      lastSeenAt: now,
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-trash-route',
      folderId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      size: 1024,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: now,
      analyzer: null,
      model: null,
      missingAt: null,
      hiddenAt: null,
      capturedAt: now,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });

    try {
      const trashResponse = await app.honoApp.request(API_ROUTES.libraryTrash.path, {
        method: API_ROUTES.libraryTrash.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: { kind: 'fingerprints', fingerprints: ['fp-trash-route'] },
          confirm: true,
          dryRun: false,
        }),
      });
      const accepted = API_ROUTES.libraryTrash.output.parse(await responsePayload(trashResponse));
      expect(accepted.kind).toBe('job');
      if (accepted.kind !== 'job') throw new Error('Expected trash job');

      const completed = await waitForCompletedJob(deps, accepted.jobId);
      const summary = libraryTrashSummarySchema.parse(completed.result);
      expect(summary).toMatchObject({
        kind: 'library_trash',
        filesTrashed: 1,
        videosTrashed: 1,
        photosTrashed: 0,
      });
      expect(trashedPaths).toEqual(['/media/videos/clip.mp4']);

      const search = API_ROUTES.searchQuery.output.parse(await responsePayload(
        await app.honoApp.request(`${API_ROUTES.searchQuery.path}?query=clip`),
      ));
      expect(search.results.map((row) => row.fingerprint)).not.toContain('fp-trash-route');

      const collection = API_ROUTES.libraryCollection.output.parse(await responsePayload(
        await app.honoApp.request(API_ROUTES.libraryCollection.path),
      ));
      expect(collection.items.map((row) => row.fingerprint)).not.toContain('fp-trash-route');
    } finally {
      await app.dispose();
    }
  }, scaledTimeout(30_000));
});
