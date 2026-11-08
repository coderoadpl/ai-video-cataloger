import { describe, expect, it } from 'vitest';

import { derivedFolderId, type AppError, type Result } from '@core/domain/index.js';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

const now = '2026-11-01T10:00:00.000Z';

const value = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const seed = async (deps: ReturnType<typeof createInMemoryDeps>, folderPath: string): Promise<string> => {
  const folderId = derivedFolderId(folderPath);
  value(await deps.globalCatalog.upsertFolder({ folderId, currentPath: folderPath, displayName: 'trip', firstSeenAt: now, lastSeenAt: now }));
  return folderId;
};

const post = (app: ReturnType<typeof buildApp>, body: unknown): Promise<Response> =>
  Promise.resolve(app.request('/api/index/relocate-root', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('POST /api/index/relocate-root', () => {
  it('returns the dry-run plan without changing the catalog', async () => {
    const deps = createInMemoryDeps();
    const folderId = await seed(deps, '/Volumes/media/trip');
    const app = buildApp(deps);

    const response = await post(app, { from: '/Volumes/media', to: '/Volumes/library', media: 'video' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        apply: false,
        applied: false,
        databases: [{ media: 'video', folders: 1, idChanges: 1, examples: [{ fromPath: '/Volumes/media/trip', toPath: '/Volumes/library/trip' }] }],
        collisions: [],
      },
    });
    expect(value(await deps.globalCatalog.getFolder(folderId))?.currentPath).toBe('/Volumes/media/trip');
  });

  it('applies the rewrite and reports nothing left under the old root', async () => {
    const deps = createInMemoryDeps();
    await seed(deps, '/Volumes/media/trip');
    const app = buildApp(deps);

    const response = await post(app, { from: '/Volumes/media', to: '/Volumes/library', apply: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        applied: true,
        remaining: [{ media: 'video', folders: 0, paths: 0, runs: 0 }, { media: 'photo', folders: 0, paths: 0, runs: 0 }],
      },
    });
    expect(value(await deps.globalCatalog.getFolder(derivedFolderId('/Volumes/library/trip')))?.currentPath).toBe('/Volumes/library/trip');
  });

  it('maps a collision to the conflict envelope', async () => {
    const deps = createInMemoryDeps();
    await seed(deps, '/Volumes/media/trip');
    await seed(deps, '/Volumes/library/trip');
    const app = buildApp(deps);

    const response = await post(app, { from: '/Volumes/media', to: '/Volumes/library', apply: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
