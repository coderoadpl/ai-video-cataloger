import { z } from 'zod';

import { sha256Hex } from './sha256.js';
import { selectExemplars, type ExemplarCandidate, type FaceObservationSummary } from './faces.js';

export const peoplePairDecisionKindSchema = z.enum(['same', 'different', 'skip']);
export type PeoplePairDecisionKind = z.output<typeof peoplePairDecisionKindSchema>;
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
  scoreCache?: PeoplePairScoreCache;
  peopleVersion?: string;
  onPairScored?: () => void;
  onPairVisited?: () => void;
}

export interface PeoplePairScoreCache {
  revision?: string;
  rows?: Map<number, Float64Array>;
  pending?: Map<number, number>;
}

export const PAIR_REVIEW_ASK_LOW_BY_SCOPE = { careful: 0.5, standard: 0.44, wide: 0.34 } as const;
export const PAIR_REVIEW_PREFILTER_MARGIN = 0.1;
export const PAIR_REVIEW_DEFAULT_LIMIT = 200;
export const PAIR_REVIEW_MAX_LIMIT = 1000;
export const PAIR_REVIEW_CROPS_PER_PERSON = 6;
export const PAIR_REVIEW_SCORE_CACHE_BYTES = 8 * 1024 * 1024;
const SCORE_ROW_STRIDE = 4;
const SCORE_ROW_OVERHEAD_BYTES = 256;

export const pairReviewScoreCacheLimits = (peopleCount: number, limit: number): { rowCount: number; rowLimit: number } => {
  const rowBytes = SCORE_ROW_STRIDE * Float64Array.BYTES_PER_ELEMENT;
  const rowCount = Math.min(Math.max(1, peopleCount), Math.floor(PAIR_REVIEW_SCORE_CACHE_BYTES / (SCORE_ROW_OVERHEAD_BYTES + rowBytes)));
  const rowLimit = Math.min(limit, Math.floor((PAIR_REVIEW_SCORE_CACHE_BYTES / rowCount - SCORE_ROW_OVERHEAD_BYTES) / rowBytes));
  return { rowCount, rowLimit };
};

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

export interface PeoplePairCandidatesOutput {
  candidates: PeoplePairCandidate[];
  pending: number;
  truncated: boolean;
}

interface CachedPairScore {
  index: number;
  centroid: number;
  exemplar: number;
  expectedValue: number;
}

const retainScore = (scores: CachedPairScore[], score: CachedPairScore, limit: number): void => {
  if (limit === 0) return;
  const compare = (other: CachedPairScore): number => other.expectedValue - score.expectedValue
    || Math.max(other.centroid, other.exemplar) - Math.max(score.centroid, score.exemplar)
    || score.index - other.index;
  const last = scores[scores.length - 1];
  if (scores.length === limit && last !== undefined && compare(last) >= 0) return;
  let low = 0;
  let high = scores.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const other = scores[middle];
    if (other !== undefined && compare(other) < 0) high = middle;
    else low = middle + 1;
  }
  scores.splice(low, 0, score);
  if (scores.length > limit) scores.pop();
};

export const buildPeoplePairCandidates = (input: PeoplePairCandidatesInput): PeoplePairCandidatesOutput => {
  const steps = buildPeoplePairCandidatesSteps(input);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

interface PreparedPairPerson {
  person: PairReviewPerson;
  centroid: number[];
  weight: number;
  exemplars: number[][];
  side: PeoplePairCandidate['a'];
}

function* pairScoreRevision(input: PeoplePairCandidatesInput): Generator<void, string> {
  let revision = '';
  for (const values of [input.people, input.visibleObservations, input.anchorObservations]) {
    revision = sha256Hex(`${revision}:${values.length}`);
    for (let offset = 0; offset < values.length; offset += 32) {
      revision = sha256Hex(revision + JSON.stringify(values.slice(offset, offset + 32)));
      yield;
    }
  }
  for (const [id, vector] of input.exemplarEmbeddings) {
    revision = sha256Hex(revision + JSON.stringify([id, [...vector]]));
    yield;
  }
  return revision;
}

const cachedScores = (row: Float64Array | undefined): CachedPairScore[] => {
  const scores: CachedPairScore[] = [];
  if (row === undefined) return scores;
  for (let offset = 0; offset < row.length; offset += SCORE_ROW_STRIDE) {
    const index = row[offset];
    const centroid = row[offset + 1];
    const exemplar = row[offset + 2];
    const expectedValue = row[offset + 3];
    if (index !== undefined && centroid !== undefined && exemplar !== undefined && expectedValue !== undefined) scores.push({ index, centroid, exemplar, expectedValue });
  }
  return scores;
};

const scorePair = (input: PeoplePairCandidatesInput, a: PreparedPairPerson, b: PreparedPairPerson, index: number): CachedPairScore | null => {
  const centroid = dot(a.centroid, b.centroid);
  if (centroid < input.askLow - PAIR_REVIEW_PREFILTER_MARGIN) return null;
  input.onPairScored?.();
  let exemplar = -1;
  for (const left of a.exemplars) for (const right of b.exemplars) exemplar = Math.max(exemplar, dot(left, right));
  if (centroid < input.askLow && exemplar < input.cut) return null;
  const weight = Math.min(1, Math.max(0, (Math.max(centroid, exemplar) - input.askLow) / (input.cut - input.askLow)));
  return { index, centroid, exemplar, expectedValue: weight * a.weight * b.weight };
};

const scoredCandidate = (a: PreparedPairPerson, b: PreparedPairPerson, score: CachedPairScore, cut: number): PeoplePairCandidate => ({
  a: a.side, b: b.side, similarity: Math.max(score.centroid, score.exemplar),
  centroidSimilarity: score.centroid, bestObservationSimilarity: score.exemplar, expectedValue: score.expectedValue,
  aboveClusterCut: Math.max(score.centroid, score.exemplar) >= cut, survivorIfSame: pairReviewSurvivor(a.person, b.person),
});

const retainCandidate = (candidates: PeoplePairCandidate[], candidate: PeoplePairCandidate, limit: number): void => {
  const last = candidates[candidates.length - 1];
  if (candidates.length === limit && last !== undefined && compareCandidate(candidate, last) >= 0) return;
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
};

export function* buildPeoplePairCandidatesSteps(input: PeoplePairCandidatesInput): Generator<void, PeoplePairCandidatesOutput> {
  let work = 0;
  const observations = new Map<string, FaceObservationSummary[]>();
  for (const observation of input.visibleObservations) {
    if (++work % 256 === 0) yield;
    if (observation.personId === null) continue;
    const group = observations.get(observation.personId) ?? [];
    group.push(observation);
    observations.set(observation.personId, group);
  }
  const anchors = new Map<string, string | null>();
  for (const observation of input.anchorObservations) {
    if (++work % 256 === 0) yield;
    anchors.set(observation.obsId, observation.personId);
  }
  const excluded = new Map<string, Set<string>>();
  for (const decision of input.decisions) {
    if (++work % 256 === 0) yield;
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
  const people: PreparedPairPerson[] = [];
  for (const p of input.people) {
    if (++work % 16 === 0) yield;
    if (p.observationCount <= 0) continue;
    const obs = observations.get(p.personId) ?? [];
    people.push({
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
    });
  }
  people.sort((a, b) => compareId(a.person.personId, b.person.personId));
  const personIndices = new Map(people.map((p, i) => [p.person.personId, i]));
  const scoreCache = input.scoreCache;
  const limit = Math.min(PAIR_REVIEW_MAX_LIMIT, Math.max(1, input.limit));
  const { rowCount: cachedRowCount, rowLimit } = pairReviewScoreCacheLimits(people.length, limit);
  if (scoreCache !== undefined) {
    const peopleVersion = input.peopleVersion ?? (yield* pairScoreRevision(input));
    const revision = JSON.stringify([peopleVersion, input.askLow, input.cut]);
    if (scoreCache.revision !== revision) {
      scoreCache.revision = revision;
      scoreCache.rows = new Map();
      scoreCache.pending = new Map();
    }
  }
  if (scoreCache !== undefined) {
    scoreCache.rows = new Map(scoreCache.rows);
    scoreCache.pending = new Map(scoreCache.pending);
  }
  const scoreRows = scoreCache?.rows;
  const rowPending = scoreCache?.pending;
  const candidates: PeoplePairCandidate[] = [];
  for (const [i, row] of scoreRows ?? []) {
    const a = people[i];
    if (a === undefined) continue;
    for (const score of cachedScores(row)) {
      if (++work % 64 === 0) yield;
      const b = people[score.index];
      if (b === undefined || excluded.get(a.person.personId)?.has(b.person.personId)) continue;
      retainCandidate(candidates, scoredCandidate(a, b, score, input.cut), limit);
    }
  }
  let pending = 0;
  for (let i = 0; i < people.length; i += 1) {
    const a = people[i];
    if (a === undefined) continue;
    const excludedPartners = excluded.get(a.person.personId);
    const row = scoreRows?.get(i);
    const scores = cachedScores(row);
    const cached = new Map(scores.map((score) => [score.index, score]));
    const rowScores: CachedPairScore[] = [];
    for (const score of scores) retainScore(rowScores, score, rowLimit);
    const baseline = rowPending?.get(i);
    const frontier = scores[scores.length - 1];
    const frontierPerson = frontier === undefined ? undefined : people[frontier.index];
    const last = candidates[candidates.length - 1];
    const reusable = baseline !== undefined && (scores.length === baseline || (
      frontier !== undefined && frontierPerson !== undefined && last !== undefined && candidates.length === limit
      && compareCandidate(scoredCandidate(a, frontierPerson, frontier, input.cut), last) >= 0
    ));
    let eligible = 0;
    if (reusable) {
      eligible = baseline;
      for (const partner of excludedPartners ?? []) {
        if (++work % 64 === 0) yield;
        const index = personIndices.get(partner);
        const b = index === undefined ? undefined : people[index];
        if (index === undefined || index <= i || b === undefined) continue;
        if (cached.get(index) ?? scorePair(input, a, b, index)) eligible -= 1;
      }
    } else {
      for (let j = i + 1; j < people.length; j += 1) {
        if (++work % 64 === 0) yield;
        const b = people[j];
        if (b === undefined) continue;
        input.onPairVisited?.();
        if (a.person.personId === b.person.personId || excludedPartners?.has(b.person.personId)) continue;
        const cachedScore = cached.get(j);
        const score = cachedScore ?? scorePair(input, a, b, j);
        if (score === null) continue;
        eligible += 1;
        if (cachedScore !== undefined) continue;
        if (scoreRows !== undefined && i < cachedRowCount) retainScore(rowScores, score, rowLimit);
        retainCandidate(candidates, scoredCandidate(a, b, score, input.cut), limit);
      }
      if (i < cachedRowCount && excludedPartners === undefined) rowPending?.set(i, eligible);
    }
    pending += eligible;
    if (scoreRows !== undefined && i < cachedRowCount && rowScores.length > 0) {
      const buffer = new Float64Array(rowScores.length * SCORE_ROW_STRIDE);
      for (const [index, score] of rowScores.entries()) buffer.set([score.index, score.centroid, score.exemplar, score.expectedValue], index * SCORE_ROW_STRIDE);
      scoreRows.set(i, buffer);
    }
    yield;
  }
  return { candidates, pending, truncated: pending > limit };
}
