import { afterEach, expect, it, vi } from 'vitest';
import { appError } from '@core/domain/index.js';
import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

afterEach(() => vi.restoreAllMocks());

it('PE06 identifies an applied face mutation when the route cleanup flush fails', async () => {
  const deps = createInMemoryDeps();
  await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
  await deps.globalCatalog.upsertPerson({ personId: 'person-a', displayName: null, kind: 'face', createdAt: '2026-01-01T00:00:00.000Z', centroid: [], exemplarCount: 0 });
  vi.spyOn(deps.photos, 'flush').mockResolvedValue({ ok: false, error: appError('internal', 'Persistence failed') });
  const response = await buildApp(deps).request('/api/faces/name', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: 'person-a', displayName: 'Named' }),
  });
  expect(await response.json()).toMatchObject({ ok: false, error: { details: { applied: true, phase: 'durability' } } });
});
