import { describe, expect, it, vi } from 'vitest';

import { orderObservationPair, pairReviewScoreCacheLimits, pairDecisionIsActive, peoplePairDecisionSchema } from './people-pairs.js';

describe('W99 A1 decision domain', () => {
  it('orders unordered ids canonically', () => {
    expect(orderObservationPair('b', 'a')).toEqual(['a', 'b']);
  });
  it.each([
    ['skip', 29, true], ['skip', 30, false], ['skip', 31, false],
    ['same', 365, true], ['different', 365, true],
  ])('expires %s at day %s: %s', (decision, days, active) => {
    const row = peoplePairDecisionSchema.parse({
      obsAId: 'a', obsBId: 'b', personAId: null, personBId: 'person-b',
      decision, decidedAt: '2026-01-01T00:00:00.000Z', source: 'user',
    });
    expect(pairDecisionIsActive(row, new Date(Date.parse(row.decidedAt) + Number(days) * 86400000).toISOString())).toBe(active);
  });
  it('rejects invalid kinds, sources and empty person ids', () => {
    expect(peoplePairDecisionSchema.safeParse({ decision: 'other', source: 'other', personAId: '' }).success).toBe(false);
  });
});

import { buildPeoplePairCandidates, buildPeoplePairCandidatesSteps, selectPairReviewCrops, type PairReviewPerson, type PeoplePairCandidatesInput, type PeoplePairScoreCache } from './people-pairs.js';
import { selectExemplars, type FaceObservationSummary } from './faces.js';

const pairPerson = (id: string, angle: number, count = 1): PairReviewPerson => ({
  personId: id, displayName: null, fallbackIndex: 0, centroid: [Math.cos(angle), Math.sin(angle)],
  observationCount: count, fileCounts: { video: count, photo: 0 },
});
const pairObs = (id: string, personId: string, quality = 1, fingerprint = id, cropPath: string | null = `${id}.jpg`): FaceObservationSummary => ({
  obsId: id, personId, quality, fingerprint, cropPath, media: 'video',
});
const pairInput = (people: PairReviewPerson[]): PeoplePairCandidatesInput => ({
  people, visibleObservations: people.map((p) => pairObs(p.personId, p.personId)),
  anchorObservations: people.map((p) => pairObs(p.personId, p.personId)),
  exemplarEmbeddings: new Map(), decisions: [], nowIso: '2026-02-01T00:00:00.000Z',
  askLow: 0.44, cut: 0.56, limit: 200,
});

describe('W99 A2 candidates', () => {
  it('includes the floor, excludes below it and includes above-cut pairs', () => {
    const input = pairInput([pairPerson('a', 0), pairPerson('b', Math.acos(0.44))]);
    expect(buildPeoplePairCandidates(input).pending).toBe(1);
    expect(buildPeoplePairCandidates({ ...input, askLow: 0.441 }).pending).toBe(0);
    expect(buildPeoplePairCandidates(pairInput([pairPerson('a', 0), pairPerson('b', 0)])).candidates[0]?.aboveClusterCut).toBe(true);
  });
  it('ranks hand-computed values deterministically', () => {
    const people = [pairPerson('a', 0, 1), pairPerson('b', 0, 3), pairPerson('c', 0, 7)];
    const result = buildPeoplePairCandidates(pairInput(people));
    expect(result.candidates.map((p) => [p.a.personId, p.b.personId, p.expectedValue])).toEqual([
      ['b', 'c', 6], ['a', 'c', 3], ['a', 'b', 2],
    ]);
    expect(buildPeoplePairCandidates(pairInput([...people].reverse()))).toEqual(result);
  });
  it('excludes full-set anchors, stale-column fallbacks and active skips', () => {
    const input = pairInput([pairPerson('a', 0), pairPerson('b', 0)]);
    const row = peoplePairDecisionSchema.parse({ obsAId: 'hidden-a', obsBId: 'hidden-b', personAId: 'old-a', personBId: 'old-b', decision: 'different', source: 'user', decidedAt: '2026-01-01T00:00:00.000Z' });
    const anchored = { ...input, decisions: [row], anchorObservations: [pairObs('hidden-a', 'a'), pairObs('hidden-b', 'b')] };
    expect(buildPeoplePairCandidates(anchored).pending).toBe(0);
    expect(buildPeoplePairCandidates({ ...anchored, decisions: [{ ...row, decision: 'skip' }], nowIso: '2026-01-30T00:00:00.000Z' }).pending).toBe(0);
    expect(buildPeoplePairCandidates({ ...anchored, decisions: [{ ...row, decision: 'skip' }] }).pending).toBe(1);
    expect(buildPeoplePairCandidates({ ...input, decisions: [{ ...row, personAId: 'a', personBId: 'b' }] }).pending).toBe(0);
  });
  it('uses only prefiltered exemplar vectors for the second channel', () => {
    const input = pairInput([pairPerson('a', 0), pairPerson('b', Math.acos(0.4))]);
    const exemplarEmbeddings = new Map([['a', new Float32Array([1, 0])], ['b', new Float32Array([1, 0])]]);
    expect(buildPeoplePairCandidates({ ...input, exemplarEmbeddings }).pending).toBe(1);
    expect(buildPeoplePairCandidates({ ...input, askLow: 0.51, exemplarEmbeddings }).pending).toBe(0);
  });
  it('selects crop-bearing, distinct-file quality tails with a visible anchor', () => {
    const observations = Array.from({ length: 10 }, (_, i) => pairObs(`obs-${i}`, 'a', 1 - i / 20));
    observations.push(pairObs('no-crop', 'a', 2, 'none', null));
    observations.push(pairObs('duplicate', 'a', 0.99, 'obs-0'));
    const crops = selectPairReviewCrops(observations);
    expect(crops).toHaveLength(6);
    expect(new Set(crops.map((o) => o.fingerprint)).size).toBe(6);
    expect(crops.some((o) => o.obsId === 'obs-9')).toBe(true);
    expect(crops[0]?.obsId).toBe('obs-0');
    expect(selectExemplars(observations)[0]?.obsId).toBe('no-crop');
    expect(selectPairReviewCrops([...observations].reverse())).toEqual(crops);
    expect(crops.every((o) => o.cropPath !== null)).toBe(true);
    expect(crops.map((o) => o.quality)).toEqual(crops.map((o) => o.quality).sort((a, b) => b - a));
  });
  it('visits each unordered pair once at scale and caps the queue', () => {
    const people = Array.from({ length: 600 }, (_, i) => pairPerson(`p-${String(i).padStart(4, '0')}`, 0));
    const input = pairInput(people);
    const visibleObservations = people.flatMap((p) => Array.from({ length: 5 }, (_, i) => pairObs(`${p.personId}-${i}`, p.personId)));
    let visits = 0;
    const result = buildPeoplePairCandidates({ ...input, visibleObservations, limit: 7, onPairVisited: () => { visits += 1; } });
    expect(visits).toBe(600 * 599 / 2);
    expect(result.pending).toBe(visits);
    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(7);
  });
});

it('FPR-007 reuses bounded distinct-vector scores across decisions and undo', () => {
  const people = Array.from({ length: 200 }, (_, i) => ({
    ...pairPerson(`p-${String(i).padStart(4, '0')}`, 0, 5),
    centroid: Array.from({ length: 128 }, (_, axis) => axis === 0 ? 1 : Math.sin(i * 131 + axis) * 0.01),
  }));
  const observations = people.flatMap((p) => Array.from({ length: 5 }, (_, i) => pairObs(`${p.personId}-${i}`, p.personId)));
  const embeddings = new Map(observations.map((o, i) => [o.obsId, Float32Array.from({ length: 128 }, (_, axis) => axis === 0 ? 1 : Math.sin(i * 137 + axis) * 0.02)]));
  expect(new Set([...embeddings.values()].map((vector) => JSON.stringify([...vector]))).size).toBe(people.length * 5);
  const scoreCache = {};
  let scored = 0;
  const input = { ...pairInput(people), visibleObservations: observations, anchorObservations: observations, exemplarEmbeddings: embeddings, scoreCache, onPairScored: () => { scored += 1; } };
  const initial = buildPeoplePairCandidates(input);
  expect(scored).toBe(people.length * (people.length - 1) / 2);
  const decision = peoplePairDecisionSchema.parse({ obsAId: 'p-0000-0', obsBId: 'p-0001-0', personAId: 'p-0000', personBId: 'p-0001', decision: 'different', source: 'user', decidedAt: input.nowIso });
  scored = 0;
  const decided = buildPeoplePairCandidates({ ...input, decisions: [decision] });
  const decidedScored = scored;
  scored = 0;
  const undone = buildPeoplePairCandidates(input);
  expect(decided.pending).toBe(initial.pending - 1);
  expect(undone).toEqual(initial);
  expect(decidedScored).toBeLessThanOrEqual(3 * people.length);
  expect(scored).toBeLessThanOrEqual(3 * people.length);
});

it('FPR-007 invalidates cached scores when an embedding changes', () => {
  let scored = 0;
  const embeddings = new Map([['a', new Float32Array([1, 0])], ['b', new Float32Array([1, 0])]]);
  const input = { ...pairInput([pairPerson('a', 0), pairPerson('b', Math.acos(0.4))]), exemplarEmbeddings: embeddings, scoreCache: {}, onPairScored: () => { scored += 1; } };
  expect(buildPeoplePairCandidates(input).pending).toBe(1);
  expect(buildPeoplePairCandidates(input).pending).toBe(1);
  expect(scored).toBe(1);
  embeddings.set('b', new Float32Array([0, 1]));
  expect(buildPeoplePairCandidates(input).pending).toBe(0);
  expect(scored).toBe(2);
});

it('R5B-06 bounds score buffers and row containers to the 8 MiB budget', () => {
  const lengths: number[] = [];
  const OriginalFloat64Array = Float64Array;
  class MeasuredFloat64Array extends OriginalFloat64Array {
    constructor(length: number) {
      super(length);
      lengths.push(this.length);
    }
  }
  vi.stubGlobal('Float64Array', MeasuredFloat64Array);
  try {
    const peopleCount = 600;
    const { rowCount, rowLimit } = pairReviewScoreCacheLimits(peopleCount, 200);
    const people = Array.from({ length: peopleCount }, (_, i) => pairPerson(`bounded-${i}`, 0));
    const scoreCache: PeoplePairScoreCache = {};
    const result = buildPeoplePairCandidates({ ...pairInput(people), scoreCache });
    expect(result.pending).toBe(peopleCount * (peopleCount - 1) / 2);
    expect(result.candidates).toHaveLength(200);
    const allocatedBytes = lengths.reduce((sum, length) => sum + length * 8, 0);
    const retainedBytes = [...scoreCache.rows?.values() ?? []].reduce((sum, row) => sum + row.length * 8, 0);
    expect(lengths.every((length) => length <= rowLimit * 4)).toBe(true);
    expect(scoreCache.rows?.size ?? 0).toBeLessThanOrEqual(rowCount);
    expect(allocatedBytes + Math.max(scoreCache.rows?.size ?? 0, scoreCache.pending?.size ?? 0) * 256).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(retainedBytes).toBe(allocatedBytes);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('R5-REG-002 matches eager scoring and sorting on a small fixture', () => {
  const people = Array.from({ length: 12 }, (_, i) => pairPerson(`fixture-${i}`, i * 0.31, 1 + i % 4));
  const input = pairInput(people);
  const eager = people.flatMap((a, i) => people.slice(i + 1).flatMap((b) =>
    buildPeoplePairCandidates({ ...input, people: [a, b] }).candidates,
  )).sort((a, b) => b.expectedValue - a.expectedValue || b.similarity - a.similarity
    || a.a.personId.localeCompare(b.a.personId) || a.b.personId.localeCompare(b.b.personId));
  const result = buildPeoplePairCandidates({ ...input, limit: 3, scoreCache: {} });
  expect(result).toEqual({ candidates: eager.slice(0, 3), pending: eager.length, truncated: eager.length > 3 });
});

it('keeps interleaved generations with different people versions isolated', () => {
  const scoreCache: PeoplePairScoreCache = {};
  const people = [pairPerson('a', 0), pairPerson('b', 0), pairPerson('c', 0)];
  const first = { ...pairInput(people), scoreCache };
  const second = { ...first, people: [pairPerson('a', 0), pairPerson('b', 0), pairPerson('c', Math.PI)] };
  const steps = buildPeoplePairCandidatesSteps(first);
  steps.next();
  const expected = buildPeoplePairCandidates(second);
  let step = steps.next();
  while (!step.done) step = steps.next();
  expect(step.value).toEqual(buildPeoplePairCandidates({ ...first, scoreCache: {} }));
  expect(buildPeoplePairCandidates(second)).toEqual(expected);
});

it.each([
  { displayName: 'Renamed' }, { observationCount: 2 }, { fallbackIndex: 2 },
  { fileCounts: { video: 0, photo: 1 } }, { centroid: [0.8, 0.6] },
])('invalidates cached scores after a person changes: %j', (mutation) => {
  const a = pairPerson('a', 0);
  const b = pairPerson('b', 0);
  let scored = 0;
  const input = { ...pairInput([a, b]), scoreCache: {}, onPairScored: () => { scored += 1; } };
  buildPeoplePairCandidates(input);
  buildPeoplePairCandidates(input);
  expect(scored).toBe(1);
  const changed = { ...input, people: [a, { ...b, ...mutation }] };
  expect(buildPeoplePairCandidates(changed)).toEqual(buildPeoplePairCandidates({ ...pairInput(changed.people) }));
  expect(scored).toBe(2);
});

it('retains only top scores per person and lazily skips excluded and prefiltered pairs', () => {
  const people = [pairPerson('a', 0), pairPerson('b', 0.1), pairPerson('c', 0.2), pairPerson('d', Math.PI)];
  const input = pairInput(people);
  const decision = peoplePairDecisionSchema.parse({
    obsAId: 'a', obsBId: 'b', personAId: 'a', personBId: 'b', decision: 'different',
    decidedAt: input.nowIso, source: 'user',
  });
  const scoreCache: PeoplePairScoreCache = {};
  let scored = 0;
  buildPeoplePairCandidates({ ...input, decisions: [decision], limit: 1, scoreCache, onPairScored: () => { scored += 1; } });
  expect(scored).toBe(2);
  expect([...scoreCache.rows?.values() ?? []].every((row) => row.length <= 4)).toBe(true);
  expect(scoreCache.rows?.get(0)?.[0]).toBe(2);
});

it('R5B-07 preserves similarities when the output limit changes', () => {
  const people = [pairPerson('a', 0), pairPerson('b', 0.1), pairPerson('c', 0.2)];
  const scoreCache: PeoplePairScoreCache = {};
  let scored = 0;
  const input = { ...pairInput(people), scoreCache, onPairScored: () => { scored += 1; } };
  buildPeoplePairCandidates({ ...input, limit: 3 });
  const revision = scoreCache.revision;
  scored = 0;
  const narrowed = buildPeoplePairCandidates({ ...input, limit: 1 });
  expect(scoreCache.revision).toBe(revision);
  expect(scored).toBe(0);
  expect(narrowed).toEqual(buildPeoplePairCandidates({ ...input, scoreCache: {}, limit: 1 }));
  expect([...scoreCache.rows?.values() ?? []].every((row) => row.length <= 4)).toBe(true);
});

it('FPR-007 yields during preprocessing and pair rows and reuses warm scores', () => {
  const people = Array.from({ length: 200 }, (_, i) => ({
    ...pairPerson(`chunk-${String(i).padStart(4, '0')}`, 0, 5),
    centroid: Array.from({ length: 128 }, (_, axis) => axis === 0 ? 1 : Math.sin(i * 131 + axis) * 0.01),
  }));
  const observations = people.flatMap((p) => Array.from({ length: 5 }, (_, i) => pairObs(`${p.personId}-${i}`, p.personId)));
  const exemplarEmbeddings = new Map(observations.map((o, i) => [o.obsId, Float32Array.from({ length: 128 }, (_, axis) => axis === 0 ? 1 : Math.sin(i * 137 + axis) * 0.02)]));
  let scored = 0;
  let visited = 0;
  const input = { ...pairInput(people), visibleObservations: observations, exemplarEmbeddings, scoreCache: {}, onPairScored: () => { scored += 1; }, onPairVisited: () => { visited += 1; } };
  const steps = buildPeoplePairCandidatesSteps(input);
  let step = steps.next();
  expect(visited).toBe(0);
  expect(scored).toBe(0);
  let yields = 1;
  let maxVisited = 0;
  while (!step.done) {
    const before = visited;
    step = steps.next();
    yields += 1;
    maxVisited = Math.max(maxVisited, visited - before);
  }
  const pairs = people.length * (people.length - 1) / 2;
  expect(maxVisited).toBeLessThanOrEqual(64);
  expect(visited).toBe(pairs);
  expect(yields).toBeGreaterThanOrEqual(Math.ceil(pairs / 64));
  scored = 0;
  expect(buildPeoplePairCandidates(input)).toEqual(step.value);
  expect(scored).toBeLessThanOrEqual(3 * people.length);
});

it('keeps warm ranking and pending counts exact across limits and exclusions', () => {
  const people = Array.from({ length: 24 }, (_, i) => pairPerson(`exact-${String(i).padStart(2, '0')}`, i * 0.07, 1 + i % 7));
  const scoreCache: PeoplePairScoreCache = {};
  const base = pairInput(people);
  const decision = peoplePairDecisionSchema.parse({ obsAId: 'exact-03', obsBId: 'exact-05', personAId: 'exact-03', personBId: 'exact-05', decision: 'different', source: 'user', decidedAt: base.nowIso });
  for (const limit of [1, 7, 2, 20, 1]) {
    for (const decisions of [[], [decision], []]) {
      const input = { ...base, limit, decisions };
      expect(buildPeoplePairCandidates({ ...input, scoreCache })).toEqual(buildPeoplePairCandidates(input));
    }
  }
});

it('isolates interleaved warm generations with different limits', () => {
  const people = Array.from({ length: 80 }, (_, i) => pairPerson(`overlap-${String(i).padStart(2, '0')}`, i * 0.007, 1 + i % 7));
  const scoreCache: PeoplePairScoreCache = {};
  const base = { ...pairInput(people), scoreCache, peopleVersion: 'unchanged' };
  buildPeoplePairCandidates({ ...base, limit: 2 });
  const first = buildPeoplePairCandidatesSteps({ ...base, limit: 1 });
  const second = buildPeoplePairCandidatesSteps({ ...base, limit: 20 });
  let a = first.next();
  let b = second.next();
  while (!a.done || !b.done) {
    if (!a.done) a = first.next();
    if (!b.done) b = second.next();
  }
  expect(a.value).toEqual(buildPeoplePairCandidates({ ...pairInput(people), limit: 1 }));
  expect(b.value).toEqual(buildPeoplePairCandidates({ ...pairInput(people), limit: 20 }));
});

it.each([3000, 30000, 100000, 300000])('bounds retained row storage without disabling the cache for %i people', (peopleCount) => {
  const { rowCount, rowLimit } = pairReviewScoreCacheLimits(peopleCount, 200);
  expect(rowLimit).toBeGreaterThan(0);
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(peopleCount);
  expect(rowCount * (rowLimit * 4 * Float64Array.BYTES_PER_ELEMENT + 256)).toBeLessThanOrEqual(8 * 1024 * 1024);
});
