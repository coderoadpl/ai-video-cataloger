import { describe, expect, it } from 'vitest';

import { orderObservationPair, orderPersonPair, pairDecisionIsActive, peoplePairDecisionSchema } from './people-pairs.js';

describe('W99 A1 decision domain', () => {
  it('orders unordered ids canonically', () => {
    expect(orderObservationPair('b', 'a')).toEqual(['a', 'b']);
    expect(orderPersonPair('b', 'a')).toEqual(['a', 'b']);
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

import { buildPeoplePairCandidates, selectPairReviewCrops, type PairReviewPerson, type PeoplePairCandidatesInput } from './people-pairs.js';
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
    const people = Array.from({ length: 3000 }, (_, i) => pairPerson(`p-${String(i).padStart(4, '0')}`, 0));
    const input = pairInput(people);
    const visibleObservations = people.flatMap((p) => Array.from({ length: 5 }, (_, i) => pairObs(`${p.personId}-${i}`, p.personId)));
    let visits = 0;
    const result = buildPeoplePairCandidates({ ...input, visibleObservations, limit: 7, onPairVisited: () => { visits += 1; } });
    expect(visits).toBe(3000 * 2999 / 2);
    expect(result.pending).toBe(visits);
    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(7);
  });
});
