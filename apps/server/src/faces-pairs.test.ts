import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';
import { ok, type Person } from '@core/domain/index.js';

export const pairTestPerson = (personId: string, similarity = 1, displayName: string | null = null): Person => ({
  personId, displayName, kind: 'face', createdAt: '2026-01-01T00:00:00.000Z', exemplarCount: 1,
  centroid: Array.from({ length: 128 }, (_, i) => i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity * similarity) : 0),
});
export const seedPairPerson = async (deps: ReturnType<typeof createInMemoryDeps>, person: Person, count = 1): Promise<void> => {
  await deps.globalCatalog.upsertPerson(person);
  for (let i = 0; i < count; i += 1) await deps.globalCatalog.upsertFaceObservation({
    obsId: `${person.personId}-${i}`, fingerprint: `${person.personId}-${i}`, personId: person.personId,
    kind: 'face', media: 'video', frameTsS: 0, bbox: { x: 0, y: 0, width: 100, height: 100 },
    embedding: person.centroid, quality: 0.95 - i / 100,
    cropPath: `/old/.ai-video-cataloger/faces/obs/${person.personId}-${i}.jpg`,
  });
};
export const pairTestDeps = async (): Promise<ReturnType<typeof createInMemoryDeps>> => {
  const deps = createInMemoryDeps();
  await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
  return deps;
};
const queueSchema = z.object({ ok: z.literal(true), data: z.object({
  pending: z.number(), truncated: z.boolean(), scope: z.string(),
  candidates: z.array(z.object({ a: z.object({ personId: z.string(), fallbackIndex: z.number(), observationCount: z.number(), cropPaths: z.array(z.string()) }), b: z.object({ personId: z.string(), fallbackIndex: z.number() }) })),
}) });

afterEach(() => vi.restoreAllMocks());

describe('W99 A3 pair queue route', () => {
  it('guards faces-disabled and validates limits', async () => {
    const deps = createInMemoryDeps();
    expect((await buildApp(deps).request('/api/faces/pairs')).status).toBe(409);
    await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
    for (const limit of ['0', '1001', 'invalid']) expect((await buildApp(deps).request(`/api/faces/pairs?limit=${limit}`)).status).toBe(400);
  });
  it('shares grid numbering before visibility filtering, reduced counts and reanchored crops', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('hidden'));
    await seedPairPerson(deps, pairTestPerson('a'), 2);
    await seedPairPerson(deps, pairTestPerson('b'));
    vi.spyOn(deps.globalCatalog, 'listHiddenFingerprints').mockResolvedValue(ok(['hidden-0', 'a-1']));
    const fullRead = vi.spyOn(deps.globalCatalog, 'listFaceObservations');
    const app = buildApp(deps);
    const grid = z.object({ data: z.object({ people: z.array(z.object({ personId: z.string(), fallbackIndex: z.number() })) }) }).parse(await (await app.request('/api/faces/people')).json());
    const queue = queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data;
    expect(queue.pending).toBe(1);
    for (const pair of queue.candidates) for (const side of [pair.a, pair.b]) expect(side.fallbackIndex).toBe(grid.data.people.find((p) => p.personId === side.personId)?.fallbackIndex);
    expect(queue.candidates[0]?.a.observationCount).toBe(1);
    expect(queue.candidates[0]?.a.cropPaths[0]).toBe('.ai-video-cataloger/faces/obs/a-0.jpg');
    expect(fullRead).not.toHaveBeenCalled();
  });
  it('resolves scope, counts the uncapped queue and returns all config shapes', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'));
    await seedPairPerson(deps, pairTestPerson('b', 0.46));
    await seedPairPerson(deps, pairTestPerson('c', 0.38));
    const app = buildApp(deps);
    const counts: number[] = [];
    for (const scope of ['careful', 'standard', 'wide']) {
      await deps.config.set({ kind: 'home' }, 'faces_pair_scope', scope);
      const result = queueSchema.parse(await (await app.request('/api/faces/pairs?limit=1')).json()).data;
      counts.push(result.pending);
      expect(result.candidates).toHaveLength(1);
      expect(result.truncated).toBe(result.pending > 1);
      expect(result.scope).toBe(scope);
    }
    expect(counts).toEqual([1, 2, 3]);
    const config: unknown = await (await app.request('/api/config')).json();
    expect(config).toMatchObject({ ok: true, data: { config: { faces_pair_scope: 'wide' }, effective: { faces_pair_scope: 'wide' }, sources: { faces_pair_scope: 'home' } } });
  });
});

it('W99 A3 records the 3000-person route budget with five exemplars each', async () => {
  const deps = await pairTestDeps();
  const people = Array.from({ length: 3000 }, (_, i) => pairTestPerson(`scale-${i}`));
  const summaries = people.flatMap((p) => Array.from({ length: 5 }, (_, i) => ({
    obsId: `${p.personId}-${i}`, fingerprint: `${p.personId}-${i}`, personId: p.personId,
    quality: 0.9, cropPath: `${p.personId}-${i}.jpg`, media: 'video' as const,
  })));
  vi.spyOn(deps.globalCatalog, 'listPeople').mockResolvedValue(ok(people));
  vi.spyOn(deps.globalCatalog, 'listFaceObservationSummaries').mockResolvedValue(ok(summaries));
  vi.spyOn(deps.globalCatalog, 'listFaceObservationEmbeddings').mockResolvedValue(ok(new Map(summaries.map((o) => [o.obsId, new Float32Array(people[0]?.centroid ?? [])]))));
  const app = buildApp(deps);
  const started = performance.now();
  const response = await app.request('/api/faces/pairs?limit=1');
  const elapsedMs = performance.now() - started;
  const cachedStart = performance.now();
  await app.request('/api/faces/pairs?limit=1');
  process.stdout.write(`W99 synthetic cached pair route: ${(performance.now() - cachedStart).toFixed(1)} ms\n`);
  process.stdout.write(`W99 synthetic pair route: ${elapsedMs.toFixed(1)} ms\n`);
  const result = queueSchema.parse(await response.json()).data;
  expect(result.pending).toBe(3000 * 2999 / 2);
  expect(result.candidates).toHaveLength(1);
}, 60000);

it('W99 A3 caches generation by people revision and invalidates after a visibility change', async () => {
  const domain = await import('@core/domain/index.js');
  const generate = vi.spyOn(domain, 'buildPeoplePairCandidates');
  const deps = await pairTestDeps();
  await seedPairPerson(deps, pairTestPerson('a'));
  await seedPairPerson(deps, pairTestPerson('b'));
  const app = buildApp(deps);
  await app.request('/api/faces/pairs');
  await app.request('/api/faces/pairs');
  expect(generate).toHaveBeenCalledTimes(1);
  vi.spyOn(deps.globalCatalog, 'listHiddenFingerprints').mockResolvedValue(ok(['a-0']));
  expect(queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data.pending).toBe(0);
  expect(generate).toHaveBeenCalledTimes(2);
});
