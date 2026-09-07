import { z } from 'zod';

import { selectExemplars, type ExemplarCandidate, type FaceObservationSummary } from './faces.js';

export const peoplePairDecisionKindSchema = z.enum(['same', 'different', 'skip']);
export const peoplePairDecisionSourceSchema = z.enum(['user', 'import']);
export const peoplePairDecisionSchema = z.object({
  obsAId: z.string().min(1),
  obsBId: z.string().min(1),
  personAId: z.string().min(1).nullable(),
  personBId: z.string().min(1).nullable(),
  decision: peoplePairDecisionKindSchema,
  decidedAt: z.iso.datetime(),
  source: peoplePairDecisionSourceSchema,
}).strict();
export type PeoplePairDecision = z.output<typeof peoplePairDecisionSchema>;

export const orderObservationPair = (a: string, b: string): [string, string] => a <= b ? [a, b] : [b, a];
export const PAIR_REVIEW_SKIP_DAYS = 30;

export const pairDecisionIsActive = (decision: PeoplePairDecision, nowIso: string): boolean =>
  decision.decision !== 'skip' || Date.parse(nowIso) < Date.parse(decision.decidedAt) + PAIR_REVIEW_SKIP_DAYS * 86400000;

export const normalizePeoplePairDecision = (input: PeoplePairDecision): PeoplePairDecision => {
  const row = peoplePairDecisionSchema.parse(input);
  return row.obsAId <= row.obsBId ? row : {
    ...row, obsAId: row.obsBId, obsBId: row.obsAId, personAId: row.personBId, personBId: row.personAId,
  };
};

export interface PairReviewPerson {
  personId: string;
  displayName: string | null;
  fallbackIndex: number;
  centroid: readonly number[];
  observationCount: number;
  fileCounts: { video: number; photo: number };
}

export interface PeoplePairCandidate {
  a: Omit<PairReviewPerson, 'centroid'> & { cropPaths: string[] };
  b: Omit<PairReviewPerson, 'centroid'> & { cropPaths: string[] };
  similarity: number;
  centroidSimilarity: number;
  bestObservationSimilarity: number;
  expectedValue: number;
  aboveClusterCut: boolean;
  survivorIfSame: string;
}

export interface PeoplePairCandidatesInput {
  people: readonly PairReviewPerson[];
  visibleObservations: readonly FaceObservationSummary[];
  anchorObservations: readonly FaceObservationSummary[];
  exemplarEmbeddings: ReadonlyMap<string, Float32Array>;
  decisions: readonly PeoplePairDecision[];
  nowIso: string;
  askLow: number;
  cut: number;
  limit: number;
  onPairVisited?: () => void;
}

export const PAIR_REVIEW_ASK_LOW_BY_SCOPE = { careful: 0.5, standard: 0.44, wide: 0.34 } as const;
export const PAIR_REVIEW_PREFILTER_MARGIN = 0.1;
export const PAIR_REVIEW_DEFAULT_LIMIT = 200;
export const PAIR_REVIEW_MAX_LIMIT = 1000;
export const PAIR_REVIEW_CROPS_PER_PERSON = 6;

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const compareQuality = (a: ExemplarCandidate, b: ExemplarCandidate): number => b.quality - a.quality || compareId(a.obsId, b.obsId);

export const selectPairReviewCrops = <T extends ExemplarCandidate>(observations: readonly T[]): T[] => {
  const ordered = observations.filter((o) => o.cropPath !== null).sort(compareQuality);
  const ranks = new Map(ordered.map((o, i) => [o, i]));
  const selected = new Set<T>();
  const fingerprints = new Set<string>();
  const targets = [0, 1, 2, Math.floor(ordered.length / 2), ordered.length - 2, ordered.length - 1];
  for (const target of targets) {
    const remaining = ordered.filter((o) => !selected.has(o));
    const distinct = remaining.filter((o) => !fingerprints.has(o.fingerprint));
    const candidates = distinct.length > 0 ? distinct : remaining;
    const choice = candidates.sort((a, b) => Math.abs((ranks.get(a) ?? 0) - target) - Math.abs((ranks.get(b) ?? 0) - target) || compareQuality(a, b))[0];
    if (choice === undefined) break;
    selected.add(choice);
    fingerprints.add(choice.fingerprint);
  }
  return [...selected].sort(compareQuality);
};

export const pairReviewSurvivor = (a: Pick<PairReviewPerson, 'personId' | 'displayName' | 'observationCount'>, b: Pick<PairReviewPerson, 'personId' | 'displayName' | 'observationCount'>): string => {
  if ((a.displayName !== null) !== (b.displayName !== null)) return a.displayName !== null ? a.personId : b.personId;
  if (a.observationCount !== b.observationCount) return a.observationCount > b.observationCount ? a.personId : b.personId;
  return orderObservationPair(a.personId, b.personId)[0];
};

const unitVector = (values: ArrayLike<number>): number[] => {
  const vector = Array.from(values);
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
};
const dot = (a: readonly number[], b: readonly number[]): number => {
  if (a === b) return a.some((value) => value !== 0) ? 1 : 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return Math.max(-1, Math.min(1, sum));
};
const compareCandidate = (a: PeoplePairCandidate, b: PeoplePairCandidate): number =>
  b.expectedValue - a.expectedValue || b.similarity - a.similarity || compareId(a.a.personId, b.a.personId) || compareId(a.b.personId, b.b.personId);

export const buildPeoplePairCandidates = (input: PeoplePairCandidatesInput): {
  candidates: PeoplePairCandidate[]; pending: number; truncated: boolean;
} => {
  const observations = new Map<string, FaceObservationSummary[]>();
  for (const observation of input.visibleObservations) {
    if (observation.personId === null) continue;
    const group = observations.get(observation.personId) ?? [];
    group.push(observation);
    observations.set(observation.personId, group);
  }
  const anchors = new Map(input.anchorObservations.map((o) => [o.obsId, o.personId]));
  const excluded = new Map<string, Set<string>>();
  for (const decision of input.decisions) {
    if (!pairDecisionIsActive(decision, input.nowIso)) continue;
    const a = anchors.has(decision.obsAId) ? anchors.get(decision.obsAId) : decision.personAId;
    const b = anchors.has(decision.obsBId) ? anchors.get(decision.obsBId) : decision.personBId;
    if (a == null || b == null) continue;
    const [left, right] = orderObservationPair(a, b);
    const partners = excluded.get(left) ?? new Set<string>();
    partners.add(right);
    excluded.set(left, partners);
  }
  const vectors = new Map<string, number[]>();
  const internVector = (values: ArrayLike<number>): number[] => {
    const vector = unitVector(values);
    const key = JSON.stringify(vector);
    const existing = vectors.get(key);
    if (existing !== undefined) return existing;
    vectors.set(key, vector);
    return vector;
  };
  const people = input.people.filter((p) => p.observationCount > 0).sort((a, b) => compareId(a.personId, b.personId)).map((p) => {
    const obs = observations.get(p.personId) ?? [];
    return {
      person: p, centroid: internVector(p.centroid), weight: Math.log2(1 + p.observationCount),
      exemplars: [...new Set(selectExemplars(obs).flatMap((o) => {
        const vector = input.exemplarEmbeddings.get(o.obsId);
        return vector === undefined ? [] : [internVector(vector)];
      }))],
      side: {
        personId: p.personId, displayName: p.displayName, fallbackIndex: p.fallbackIndex,
        observationCount: p.observationCount, fileCounts: p.fileCounts,
        cropPaths: selectPairReviewCrops(obs).flatMap((o) => o.cropPath === null ? [] : [o.cropPath]),
      },
    };
  });
  const candidates: PeoplePairCandidate[] = [];
  const limit = Math.min(PAIR_REVIEW_MAX_LIMIT, Math.max(1, input.limit));
  let pending = 0;
  for (let i = 0; i < people.length; i += 1) {
    const a = people[i];
    if (a === undefined) continue;
    const excludedPartners = excluded.get(a.person.personId);
    for (let j = i + 1; j < people.length; j += 1) {
      const b = people[j];
      if (b === undefined) continue;
      input.onPairVisited?.();
      if (a.person.personId === b.person.personId || excludedPartners?.has(b.person.personId)) continue;
      const centroidSimilarity = dot(a.centroid, b.centroid);
      if (centroidSimilarity < input.askLow - PAIR_REVIEW_PREFILTER_MARGIN) continue;
      let bestObservationSimilarity = -1;
      for (const left of a.exemplars) for (const right of b.exemplars) bestObservationSimilarity = Math.max(bestObservationSimilarity, dot(left, right));
      if (centroidSimilarity < input.askLow && bestObservationSimilarity < input.cut) continue;
      pending += 1;
      const similarity = Math.max(centroidSimilarity, bestObservationSimilarity);
      const weight = Math.min(1, Math.max(0, (similarity - input.askLow) / (input.cut - input.askLow)));
      const expectedValue = weight * a.weight * b.weight;
      const last = candidates[candidates.length - 1];
      if (candidates.length === limit && last !== undefined && (expectedValue < last.expectedValue || (expectedValue === last.expectedValue && similarity <= last.similarity))) continue;
      const candidate: PeoplePairCandidate = {
        a: a.side, b: b.side, similarity, centroidSimilarity, bestObservationSimilarity, expectedValue,
        aboveClusterCut: similarity >= input.cut, survivorIfSame: pairReviewSurvivor(a.person, b.person),
      };
      let low = 0;
      let high = candidates.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const other = candidates[middle];
        if (other !== undefined && compareCandidate(candidate, other) < 0) high = middle;
        else low = middle + 1;
      }
      candidates.splice(low, 0, candidate);
      if (candidates.length > limit) candidates.pop();
    }
  }
  return { candidates, pending, truncated: pending > limit };
};
