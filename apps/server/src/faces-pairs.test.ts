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
  const generate = vi.spyOn(domain, 'buildPeoplePairCandidatesSteps');
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

const postPair = (app: ReturnType<typeof buildApp>, route: string, body: unknown = {}) => app.request(`/api/faces/pairs/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const decidePair = (app: ReturnType<typeof buildApp>, decision: string, survivorPersonId?: string) => postPair(app, 'decide', { personAId: 'a', personBId: 'b', decision, survivorPersonId });

describe('W99 A4 decide and undo', () => {
  it.each(['decide', 'undo'])('guards disabled %s', async (route) => {
    const response = await postPair(buildApp(createInMemoryDeps()), route, { personAId: 'a', personBId: 'b', decision: 'same' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'faces_disabled' } });
  });
  it.each([
    [null, 'Named', 3, 9, undefined, 'b'],
    ['Named', null, 9, 3, 'b', 'b'],
    [null, null, 2, 3, undefined, 'b'],
    [null, null, 2, 2, undefined, 'a'],
    ['First', 'Second', 2, 3, 'a', 'a'],
  ])('merges with derived or overridden survivor (%s, %s, %s, %s, %s)', async (nameA, nameB, countA, countB, override, survivor) => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a', 1, nameA), countA);
    await seedPairPerson(deps, pairTestPerson('b', 1, nameB), countB);
    const app = buildApp(deps);
    const before: unknown = await (await app.request('/api/faces/pairs')).json();
    const response = await decidePair(app, 'same', override);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { survivingPersonId: survivor, merge: { toPersonId: survivor } } });
    if (override === undefined) expect(before).toMatchObject({ data: { candidates: [{ survivorIfSame: survivor }] } });
    const observations = await deps.globalCatalog.listFaceObservations({ personId: survivor });
    expect(observations.ok && observations.value.length).toBe(countA + countB);
    expect(await deps.globalCatalog.getPerson(survivor === 'a' ? 'b' : 'a')).toEqual(ok(null));
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toMatchObject({ value: [{ obsAId: 'a-0', obsBId: 'b-0', personAId: survivor, personBId: survivor, decision: 'same' }] });
  });
  it('rejects self-pairs, unknown people, invalid survivors and empty people without writes', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'));
    await seedPairPerson(deps, pairTestPerson('b'));
    await deps.globalCatalog.upsertPerson(pairTestPerson('empty'));
    const app = buildApp(deps);
    for (const [a, b, survivor, status] of [['a', 'a', 'a', 400], ['a', 'missing', 'a', 404], ['a', 'b', 'outside', 400], ['a', 'empty', 'a', 400]]) {
      expect((await postPair(app, 'decide', { personAId: a, personBId: b, decision: 'same', survivorPersonId: survivor })).status).toBe(status);
    }
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toEqual(ok([]));
  });
  it.each(['visible-crop', 'hidden-only', 'no-crops'])('anchors %s using the sheet fallback chain', async (mode) => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'), 2);
    await seedPairPerson(deps, pairTestPerson('b'));
    const summaries = await deps.globalCatalog.listFaceObservations({ personId: 'a' });
    if (!summaries.ok) throw new Error('Fixture failed');
    for (const observation of summaries.value) await deps.globalCatalog.upsertFaceObservation({ ...observation, cropPath: mode === 'no-crops' || observation.obsId === 'a-0' ? null : observation.cropPath });
    if (mode === 'hidden-only') vi.spyOn(deps.globalCatalog, 'listHiddenFingerprints').mockResolvedValue(ok(['a-0', 'a-1']));
    const app = buildApp(deps);
    expect((await decidePair(app, 'different')).status).toBe(200);
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toMatchObject({ value: [{ obsAId: mode === 'no-crops' ? 'a-0' : 'a-1' }] });
  });
  it('upserts answers, suppresses the queue, and undoes only user decisions', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'));
    await seedPairPerson(deps, pairTestPerson('b'));
    const app = buildApp(deps);
    expect(await (await postPair(app, 'undo')).json()).toMatchObject({ data: { undone: false, reason: 'none_to_undo' } });
    await deps.globalCatalog.recordPeoplePairDecision({ obsAId: 'import-a', obsBId: 'import-b', personAId: null, personBId: null, source: 'import', decision: 'different', decidedAt: '2099-01-01T00:00:00.000Z' });
    expect(await (await postPair(app, 'undo')).json()).toMatchObject({ data: { reason: 'none_to_undo' } });
    await decidePair(app, 'different');
    expect(queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data.pending).toBe(0);
    await decidePair(app, 'skip');
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toMatchObject({ value: [expect.objectContaining({ source: 'import' }), expect.objectContaining({ decision: 'skip' })] });
    expect(await (await postPair(app, 'undo')).json()).toMatchObject({ data: { undone: true, pending: 1 } });
    await decidePair(app, 'different');
    await decidePair(app, 'same');
    expect(await (await postPair(app, 'undo')).json()).toMatchObject({ data: { undone: false, reason: 'merge_not_undoable' } });
  });
  it('preserves the merge error and writes no decision after an injected failure', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'));
    await seedPairPerson(deps, pairTestPerson('b'));
    const domain = await import('@core/domain/index.js');
    const error = domain.appError('internal', 'Injected merge failure');
    vi.spyOn(deps.globalCatalog, 'mergePeople').mockResolvedValue({ ok: false, error });
    const app = buildApp(deps);
    expect(await (await decidePair(app, 'same')).json()).toMatchObject({ ok: false, error });
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toEqual(ok([]));
    expect(queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data.pending).toBe(1);
  });
  it('merges inside one batch and never flushes inside it', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'));
    await seedPairPerson(deps, pairTestPerson('b'));
    const batch = vi.spyOn(deps.globalCatalog, 'withBatch');
    const mergeStore = deps.globalCatalog.mergePeople.bind(deps.globalCatalog);
    const merge = vi.spyOn(deps.globalCatalog, 'mergePeople').mockImplementation((input) => {
      expect(deps.globalCatalog.batchDepth).toBe(1);
      return mergeStore(input);
    });
    const response = await decidePair(buildApp(deps), 'same');
    expect(response.status).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
  });
});

describe('W99 A7 import', () => {
  it('guards disabled imports and rejects filesystem paths at the server boundary', async () => {
    expect((await postPair(buildApp(createInMemoryDeps()), 'import', { pairs: [{ left: 'a', right: 'b', verdict: 'same' }] })).status).toBe(409);
    expect((await postPair(buildApp(await pairTestDeps()), 'import', { path: '/fixture/pairs.json' })).status).toBe(400);
  });
  it.each([true, false])('reports native, skipped, unresolved, together, conflicting and unassigned rows (dry run %s)', async (dryRun) => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'), 3);
    await seedPairPerson(deps, pairTestPerson('b'), 2);
    await deps.globalCatalog.assignFaceObservation('b-1', null);
    const pairs = [
      { left: 'a-0', right: 'b-0', verdict: 'same' },
      { left: 'a-1', right: 'b-1', verdict: 'different' },
      { left: 'a-0', right: 'a-1', verdict: 'same' },
      { left: 'a-1', right: 'a-2', verdict: 'different' },
      { left: 'a-0', right: 'b-0', verdict: 'unsure' },
      { left: 'reference-a', right: 'reference-b', verdict: 'same' },
    ];
    const response = await postPair(buildApp(deps), 'import', { pairs, dryRun });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { dryRun, imported: 4, skipped: 1, unresolved: 1, alreadyTogether: 1, conflicting: 1, merges: 0, decisionsInvalidated: 0 } });
    const rows = await deps.globalCatalog.listPeoplePairDecisions();
    expect(rows.ok && rows.value.length).toBe(dryRun ? 0 : 4);
    if (!dryRun) {
      expect(rows).toMatchObject({ value: expect.arrayContaining([expect.objectContaining({ personBId: null }), expect.objectContaining({ decision: 'different', personAId: 'a', personBId: 'a' })]) });
      const { runFacesReclusterPass } = await import('@core/server/index.js');
      expect(await runFacesReclusterPass(deps, { dryRun: true })).toMatchObject({ value: { constraintsApplied: { mustLink: 2, cannotLink: 2 } } });
    }
  });
  it('keeps a conflicting cannot-link and splits its anchors on the next rebuild', async () => {
    const deps = await pairTestDeps();
    await seedPairPerson(deps, pairTestPerson('a'), 4);
    await postPair(buildApp(deps), 'import', { pairs: [{ left: 'a-0', right: 'a-3', verdict: 'different' }] });
    const { runFacesReclusterPass } = await import('@core/server/index.js');
    expect(await runFacesReclusterPass(deps, { dryRun: false })).toMatchObject({ value: { constraintsApplied: { cannotLink: 1 } } });
    const summaries = await deps.globalCatalog.listFaceObservationSummaries();
    if (!summaries.ok) throw new Error('Fixture failed');
    expect(summaries.value.find((o) => o.obsId === 'a-0')?.personId).not.toBe(summaries.value.find((o) => o.obsId === 'a-3')?.personId);
  });
  it('applies merges inside the batch, re-resolves later rows and reports invalidation', async () => {
    const deps = await pairTestDeps();
    for (const id of ['a', 'b', 'c']) await seedPairPerson(deps, pairTestPerson(id), 2);
    await deps.globalCatalog.recordPeoplePairDecision({ obsAId: 'a-0', obsBId: 'b-0', personAId: 'a', personBId: 'b', decision: 'different', source: 'user', decidedAt: '2026-01-01T00:00:00.000Z' });
    const mergeStore = deps.globalCatalog.mergePeople.bind(deps.globalCatalog);
    vi.spyOn(deps.globalCatalog, 'mergePeople').mockImplementation((input) => {
      expect(deps.globalCatalog.batchDepth).toBe(1);
      return mergeStore(input);
    });
    const response = await postPair(buildApp(deps), 'import', { applyMerges: true, pairs: [
      { left: 'a-1', right: 'b-1', verdict: 'same' }, { left: 'b-1', right: 'c-1', verdict: 'same' },
    ] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { imported: 2, merges: 2, decisionsInvalidated: 1 } });
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toMatchObject({ value: [expect.objectContaining({ personAId: 'a', personBId: 'a' }), expect.objectContaining({ personAId: 'a', personBId: 'a' })] });
  });
  it('rolls back earlier imported rows if an opted-in merge fails', async () => {
    const deps = await pairTestDeps();
    for (const id of ['a', 'b']) await seedPairPerson(deps, pairTestPerson(id), 2);
    const { appError } = await import('@core/domain/index.js');
    const error = appError('internal', 'Injected merge failure');
    vi.spyOn(deps.globalCatalog, 'mergePeople').mockResolvedValue({ ok: false, error });
    const response = await postPair(buildApp(deps), 'import', { applyMerges: true, pairs: [
      { left: 'a-0', right: 'b-0', verdict: 'different' }, { left: 'a-1', right: 'b-1', verdict: 'same' },
    ] });
    expect(await response.json()).toMatchObject({ ok: false, error });
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toEqual(ok([]));
  });
  it('reports only unresolved rows for reference ids', async () => {
    const deps = await pairTestDeps();
    expect(await (await postPair(buildApp(deps), 'import', { pairs: [{ left: 'reference-a', right: 'reference-b', verdict: 'different' }] })).json()).toMatchObject({ data: { imported: 0, unresolved: 1 } });
    expect(await deps.globalCatalog.listPeoplePairDecisions()).toEqual(ok([]));
  });
});

it('FPR-006 catalog forget waits without deleting an anchor while faces-write is held', async () => {
  const deps = await pairTestDeps();
  await seedPairPerson(deps, pairTestPerson('a'));
  const held = await deps.jobs.acquireResource('faces-write');
  expect(held.ok).toBe(true);
  const forget = vi.spyOn(deps.globalCatalog, 'forgetEntry');
  const acquire = deps.jobs.acquireResource.bind(deps.jobs);
  let entered = () => {};
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(deps.jobs, 'acquireResource').mockImplementation((key, signal) => {
    const result = acquire(key, signal);
    entered();
    return result;
  });
  const { forgetCatalogEntry } = await import('@core/server/index.js');
  const operation = forgetCatalogEntry(deps, { fingerprint: 'a-0' });
  try {
    await waiting;
    expect(forget).not.toHaveBeenCalled();
    expect(await deps.globalCatalog.listFaceObservationSummaries()).toMatchObject({ value: [{ obsId: 'a-0' }] });
  } finally { if (held.ok) held.value(); }
  expect(await operation).toMatchObject({ ok: true });
  expect(forget).toHaveBeenCalledOnce();
});

it('FPR-007 reuses scores through decide, undo and their following GET requests', async () => {
  const domain = await import('@core/domain/index.js');
  const build = domain.buildPeoplePairCandidatesSteps;
  let scored = 0;
  vi.spyOn(domain, 'buildPeoplePairCandidatesSteps').mockImplementation((input) => build({ ...input, onPairScored: () => { scored += 1; } }));
  const deps = await pairTestDeps();
  for (const [id, similarity] of [['a', 1], ['b', 0.99], ['c', 0.98]] as const) await seedPairPerson(deps, pairTestPerson(id, similarity), 5);
  const app = buildApp(deps);
  await app.request('/api/faces/pairs');
  expect(scored).toBe(3);
  await decidePair(app, 'different');
  expect(queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data.pending).toBe(2);
  await postPair(app, 'undo');
  expect(queueSchema.parse(await (await app.request('/api/faces/pairs')).json()).data.pending).toBe(3);
  expect(scored).toBe(3);
});

it('FPR-007 lets event-loop callbacks run during cold pair generation', async () => {
  const deps = await pairTestDeps();
  for (let i = 0; i < 40; i += 1) await seedPairPerson(deps, pairTestPerson(`responsive-${i}`));
  let ticks = 0;
  let active = true;
  const tick = () => { ticks += 1; if (active) setImmediate(tick); };
  setImmediate(tick);
  try {
    const response = await buildApp(deps).request('/api/faces/pairs');
    expect(response.status).toBe(200);
    expect(ticks).toBeGreaterThan(1);
  } finally {
    active = false;
  }
});

it('returns a Result when pair generation fails', async () => {
  const domain = await import('@core/domain/index.js');
  vi.spyOn(domain, 'buildPeoplePairCandidatesSteps').mockImplementation(() => { throw new Error('Synthetic generation failure'); });
  const { facesPairs } = await import('@core/server/usecases/faces-pairs.js');
  await expect(facesPairs(await pairTestDeps(), { limit: 200 })).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
});

it('validates the pair generation limit at the use-case boundary', async () => {
  const { facesPairs } = await import('@core/server/usecases/faces-pairs.js');
  await expect(facesPairs(await pairTestDeps(), { limit: 0 })).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
});
