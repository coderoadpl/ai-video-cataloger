import { z } from 'zod';

export const SUBJECT_KINDS = ['face'] as const;
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export type SubjectKind = z.output<typeof subjectKindSchema>;

export const FACE_EMBEDDING_DIM = 128;

export const FACE_ENGINE_VERSION = 2;

export const DEFAULT_FACE_CLUSTER_CUT_SIMILARITY = 0.56;

export const FACE_CLUSTER_MIN_EDGE_DENSITY = 0.3;

export const FACE_IDENTITY_MIN_SCORE = 0.75;

export const FACE_CLUSTERING = {
  autoAssignSimilarity: 0.5,
  autoAssignMargin: 0.05,
  reviewBandMin: 0.36,
  clusterCutSimilarity: DEFAULT_FACE_CLUSTER_CUT_SIMILARITY,
  edgeBlockSize: 256,
  newClusterSimilarity: 0.5,
  newClusterMinObservations: 2,
  autoMergeSimilarity: 0.55,
  autoMergeMinPairs: 2,
} as const;

export const FACE_QUALITY = {
  minScore: 0.7,
  minBoxPx: 48,
} as const;

export const FACE_LIMITS = {
  maxFramesPerVideo: 6,
  maxExemplarsPerPerson: 5,
  maxExemplarsPerFile: 1,
  exemplarCropMaxPx: 160,
} as const;

export const EXEMPLAR_BBOX_MIN_IOU = 0.5;

export interface ExemplarCandidate {
  obsId: string;
  fingerprint: string;
  quality: number;
  cropPath: string | null;
}

export const selectExemplars = <T extends ExemplarCandidate>(observations: readonly T[]): T[] => {
  const ordered = [...observations].sort(
    (left, right) => right.quality - left.quality || left.obsId.localeCompare(right.obsId),
  );
  const takenFingerprints = new Set<string>();
  const selected: T[] = [];
  for (const candidate of ordered) {
    if (selected.length >= FACE_LIMITS.maxExemplarsPerPerson) break;
    if (takenFingerprints.has(candidate.fingerprint)) continue;
    takenFingerprints.add(candidate.fingerprint);
    selected.push(candidate);
  }
  return selected;
};

export interface FaceObsIdParts {
  fingerprint: string;
  frameIndex: number;
  detectionIndex: number;
}

export const parseFaceObsId = (obsId: string): FaceObsIdParts | null => {
  const marker = ':face:';
  const markerIndex = obsId.indexOf(marker);
  if (markerIndex <= 0) return null;
  const fingerprint = obsId.slice(0, markerIndex);
  const rest = obsId.slice(markerIndex + marker.length).split(':');
  if (rest.length !== 2) return null;
  const [frameRaw, detectionRaw] = rest;
  if (frameRaw === undefined || detectionRaw === undefined) return null;
  if (!/^[1-9][0-9]*$/.test(frameRaw) || !/^[1-9][0-9]*$/.test(detectionRaw)) return null;
  return { fingerprint, frameIndex: Number(frameRaw), detectionIndex: Number(detectionRaw) };
};

export const faceCropFileName = (parts: FaceObsIdParts): string => `${parts.frameIndex}-${parts.detectionIndex}.jpg`;

export const boxIoU = (left: FaceBox, right: FaceBox): number => {
  if (left.width <= 0 || left.height <= 0 || right.width <= 0 || right.height <= 0) return 0;
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union <= 0 ? 0 : intersection / union;
};

export interface ExemplarPlanObservation extends ExemplarCandidate {
  personId: string;
  frameTsS: number | null;
  media: FaceObservation['media'];
  bbox: FaceBox;
}

export interface ExemplarBackfillItem {
  obsId: string;
  fingerprint: string;
  personId: string;
  frameIndex: number;
  detectionIndex: number;
  frameTsS: number | null;
  media: FaceObservation['media'];
  bbox: FaceBox;
}

export interface ExemplarBackfillPlan {
  items: ExemplarBackfillItem[];
  personsWithoutExemplar: number;
  observationsUnaddressable: number;
}

export const planExemplarBackfill = (
  observations: readonly ExemplarPlanObservation[],
): ExemplarBackfillPlan => {
  const byPerson = new Map<string, ExemplarPlanObservation[]>();
  for (const observation of observations) {
    const bucket = byPerson.get(observation.personId);
    if (bucket === undefined) byPerson.set(observation.personId, [observation]);
    else bucket.push(observation);
  }

  const items: ExemplarBackfillItem[] = [];
  let personsWithoutExemplar = 0;
  let observationsUnaddressable = 0;

  for (const members of byPerson.values()) {
    const selected = selectExemplars(members);
    if (!selected.some((observation) => observation.cropPath !== null)) personsWithoutExemplar += 1;
    for (const observation of selected) {
      if (observation.cropPath !== null) continue;
      const parsed = parseFaceObsId(observation.obsId);
      if (parsed === null || (observation.media === 'video' && observation.frameTsS === null)) {
        observationsUnaddressable += 1;
        continue;
      }
      items.push({
        obsId: observation.obsId,
        fingerprint: observation.fingerprint,
        personId: observation.personId,
        frameIndex: parsed.frameIndex,
        detectionIndex: parsed.detectionIndex,
        frameTsS: observation.frameTsS,
        media: observation.media,
        bbox: observation.bbox,
      });
    }
  }

  items.sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint)
    || left.frameIndex - right.frameIndex
    || left.detectionIndex - right.detectionIndex);

  return { items, personsWithoutExemplar, observationsUnaddressable };
};

export const faceBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  sourceWidth: z.number().int().positive().optional(),
  sourceHeight: z.number().int().positive().optional(),
});
export type FaceBox = z.output<typeof faceBoxSchema>;

export const facePointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type FacePoint = z.output<typeof facePointSchema>;

export const faceLandmarksSchema = z.object({
  leftEye: facePointSchema,
  rightEye: facePointSchema,
  nose: facePointSchema,
  leftMouth: facePointSchema,
  rightMouth: facePointSchema,
});
export type FaceLandmarks = z.output<typeof faceLandmarksSchema>;

export const faceEmbeddingSchema = z.array(z.number()).length(FACE_EMBEDDING_DIM);
export type FaceEmbedding = z.output<typeof faceEmbeddingSchema>;

export const personSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  kind: subjectKindSchema,
  createdAt: z.iso.datetime(),
  centroid: faceEmbeddingSchema,
  exemplarCount: z.number().int().nonnegative(),
});
export type Person = z.output<typeof personSchema>;

export const faceObservationSchema = z.object({
  obsId: z.string().min(1),
  fingerprint: z.string().min(1),
  kind: subjectKindSchema,
  frameTsS: z.number().nonnegative().nullable(),
  bbox: faceBoxSchema,
  embedding: faceEmbeddingSchema,
  quality: z.number(),
  personId: z.string().min(1).nullable(),
  cropPath: z.string().min(1).nullable(),
  media: z.enum(['video', 'photo']).default('video'),
});
export type FaceObservation = z.output<typeof faceObservationSchema>;

export interface SimilarityTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const passesFaceQuality = (candidate: { score: number; boxPx: number }): boolean =>
  candidate.score >= FACE_QUALITY.minScore && candidate.boxPx >= FACE_QUALITY.minBoxPx;

export const dotProduct = (left: readonly number[], right: readonly number[]): number => {
  let sum = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) sum += (left[index] ?? 0) * (right[index] ?? 0);
  return sum;
};

export const magnitude = (vector: readonly number[]): number => Math.sqrt(dotProduct(vector, vector));

export const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  const denominator = magnitude(left) * magnitude(right);
  if (denominator === 0) return 0;
  return dotProduct(left, right) / denominator;
};

export const normalizeEmbedding = (vector: readonly number[]): number[] => {
  const norm = magnitude(vector);
  if (norm === 0) return vector.map(() => 0);
  return vector.map((value) => value / norm);
};

export const updateCentroid = (
  centroid: readonly number[],
  exemplarCount: number,
  embedding: readonly number[],
): number[] => {
  if (exemplarCount <= 0) return normalizeEmbedding(embedding);
  const mean = centroid.map((value, index) => (value * exemplarCount + (embedding[index] ?? 0)) / (exemplarCount + 1));
  return normalizeEmbedding(mean);
};

export interface PersonCentroid {
  personId: string;
  centroid: readonly number[];
}

export type FaceAssignment =
  | { decision: 'assign'; personId: string; similarity: number; margin: number }
  | { decision: 'review'; personId: string; similarity: number; margin: number }
  | { decision: 'unassigned'; similarity: number; margin: number };

export const classifyFace = (
  embedding: readonly number[],
  people: readonly PersonCentroid[],
): FaceAssignment => {
  const ranked = people
    .map((person) => ({ personId: person.personId, similarity: cosineSimilarity(embedding, person.centroid) }))
    .sort((left, right) => right.similarity - left.similarity);

  const best = ranked[0];
  if (best === undefined) return { decision: 'unassigned', similarity: 0, margin: 0 };

  const runnerUp = ranked[1]?.similarity ?? 0;
  const margin = best.similarity - runnerUp;

  if (best.similarity >= FACE_CLUSTERING.autoAssignSimilarity && margin >= FACE_CLUSTERING.autoAssignMargin) {
    return { decision: 'assign', personId: best.personId, similarity: best.similarity, margin };
  }
  if (best.similarity >= FACE_CLUSTERING.reviewBandMin) {
    return { decision: 'review', personId: best.personId, similarity: best.similarity, margin };
  }
  return { decision: 'unassigned', similarity: best.similarity, margin };
};

export const findNewClusterSeed = (embeddings: readonly (readonly number[])[]): number[] => {
  const ranked = embeddings
    .map((candidate, index) => ({
      index,
      supporters: embeddings
        .flatMap((other, otherIndex) =>
          otherIndex === index ? [] : [{ otherIndex, similarity: cosineSimilarity(candidate, other) }])
        .filter((supporter) => supporter.similarity >= FACE_CLUSTERING.newClusterSimilarity)
        .sort((left, right) => right.similarity - left.similarity || left.otherIndex - right.otherIndex),
    }))
    .sort((left, right) => right.supporters.length - left.supporters.length || left.index - right.index);

  for (const candidate of ranked) {
    if (candidate.supporters.length + 1 < FACE_CLUSTERING.newClusterMinObservations) break;
    const group = [candidate.index];
    for (const supporter of candidate.supporters) {
      const coherent = group.every((member) =>
        cosineSimilarity(embeddings[member] ?? [], embeddings[supporter.otherIndex] ?? [])
          >= FACE_CLUSTERING.newClusterSimilarity);
      if (coherent) group.push(supporter.otherIndex);
    }
    if (group.length >= FACE_CLUSTERING.newClusterMinObservations) return [...group].sort((l, r) => l - r);
  }
  return [];
};

export interface FaceClusterInput {
  obsId: string;
  embedding: readonly number[];
  quality: number;
  boxPx?: number | undefined;
}

export interface FaceCluster {
  personId: string;
  centroid: number[];
  memberObsIds: string[];
}

export interface FaceClusteringOutcome {
  clusters: FaceCluster[];
  unassignedObsIds: string[];
}

export interface FaceClusteringOptions {
  clusterCutSimilarity?: number | undefined;
  minEdgeDensity?: number | undefined;
  onSimilarityBlock?: ((candidatePairs: number) => void) | undefined;
}

const personIdFromSeed = (seedObsId: string, taken: ReadonlySet<string>): string => {
  const base = `person-${seedObsId.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().slice(0, 32)}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

interface AgglomerativeCluster {
  id: number;
  members: number[];
  minObsId: string;
  totals: number[];
}

interface MergeCandidate {
  leftId: number;
  rightId: number;
  score: number;
  density: number;
  mergedSize: number;
  minRank: number;
}

type NumericArray = Float64Array | Uint32Array | Uint8Array | readonly number[];

const at = (array: NumericArray, index: number): number => array[index] ?? 0;

class MergeHeap {
  private scores: Float64Array;
  private densities: Float64Array;
  private mergedSizes: Uint32Array;
  private minRanks: Uint32Array;
  private leftIds: Uint32Array;
  private rightIds: Uint32Array;
  private length = 0;

  constructor(capacity: number) {
    const initialCapacity = Math.max(16, capacity);
    this.scores = new Float64Array(initialCapacity);
    this.densities = new Float64Array(initialCapacity);
    this.mergedSizes = new Uint32Array(initialCapacity);
    this.minRanks = new Uint32Array(initialCapacity);
    this.leftIds = new Uint32Array(initialCapacity);
    this.rightIds = new Uint32Array(initialCapacity);
  }

  push(candidate: MergeCandidate): void {
    if (this.length === this.scores.length) this.grow();
    const index = this.length;
    this.scores[index] = candidate.score;
    this.densities[index] = candidate.density;
    this.mergedSizes[index] = candidate.mergedSize;
    this.minRanks[index] = candidate.minRank;
    this.leftIds[index] = candidate.leftId;
    this.rightIds[index] = candidate.rightId;
    this.length += 1;
    this.bubbleUp(index);
  }

  pop(): MergeCandidate | undefined {
    if (this.length === 0) return undefined;
    const first = this.candidateAt(0);
    this.length -= 1;
    if (this.length > 0) {
      this.copy(this.length, 0);
      this.bubbleDown(0);
    }
    return first;
  }

  private grow(): void {
    const capacity = this.scores.length * 2;
    const scores = new Float64Array(capacity);
    scores.set(this.scores);
    this.scores = scores;
    const densities = new Float64Array(capacity);
    densities.set(this.densities);
    this.densities = densities;
    const mergedSizes = new Uint32Array(capacity);
    mergedSizes.set(this.mergedSizes);
    this.mergedSizes = mergedSizes;
    const minRanks = new Uint32Array(capacity);
    minRanks.set(this.minRanks);
    this.minRanks = minRanks;
    const leftIds = new Uint32Array(capacity);
    leftIds.set(this.leftIds);
    this.leftIds = leftIds;
    const rightIds = new Uint32Array(capacity);
    rightIds.set(this.rightIds);
    this.rightIds = rightIds;
  }

  private candidateAt(index: number): MergeCandidate {
    return {
      score: at(this.scores, index),
      density: at(this.densities, index),
      mergedSize: at(this.mergedSizes, index),
      minRank: at(this.minRanks, index),
      leftId: at(this.leftIds, index),
      rightId: at(this.rightIds, index),
    };
  }

  private bubbleUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.compare(child, parent) >= 0) return;
      this.swap(child, parent);
      child = parent;
    }
  }

  private bubbleDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < this.length && this.compare(left, best) < 0) best = left;
      if (right < this.length && this.compare(right, best) < 0) best = right;
      if (best === parent) return;
      this.swap(parent, best);
      parent = best;
    }
  }

  private copy(from: number, to: number): void {
    this.scores[to] = at(this.scores, from);
    this.densities[to] = at(this.densities, from);
    this.mergedSizes[to] = at(this.mergedSizes, from);
    this.minRanks[to] = at(this.minRanks, from);
    this.leftIds[to] = at(this.leftIds, from);
    this.rightIds[to] = at(this.rightIds, from);
  }

  private swapField(field: Float64Array | Uint32Array, left: number, right: number): void {
    const leftValue = at(field, left);
    field[left] = at(field, right);
    field[right] = leftValue;
  }

  private swap(left: number, right: number): void {
    this.swapField(this.scores, left, right);
    this.swapField(this.densities, left, right);
    this.swapField(this.mergedSizes, left, right);
    this.swapField(this.minRanks, left, right);
    this.swapField(this.leftIds, left, right);
    this.swapField(this.rightIds, left, right);
  }

  private compare(left: number, right: number): number {
    return (at(this.scores, right) - at(this.scores, left))
      || (at(this.mergedSizes, right) - at(this.mergedSizes, left))
      || (at(this.minRanks, left) - at(this.minRanks, right))
      || (at(this.leftIds, left) - at(this.leftIds, right))
      || (at(this.rightIds, left) - at(this.rightIds, right));
  }
}

const pairIds = (leftId: number, rightId: number): { leftId: number; rightId: number } =>
  leftId < rightId ? { leftId, rightId } : { leftId: rightId, rightId: leftId };

const isClusterableFaceInput = (observation: FaceClusterInput): boolean =>
  observation.quality >= FACE_IDENTITY_MIN_SCORE
  && (observation.boxPx === undefined || observation.boxPx >= FACE_QUALITY.minBoxPx);

interface FacePairSum {
  sum: number;
  count: number;
}

class FacePairSumStore {
  private keyLeft: Uint32Array;
  private keyRight: Uint32Array;
  private sums: Float64Array;
  private counts: Uint32Array;
  private entries = 0;

  constructor(expectedEntries: number) {
    const capacity = tableCapacityFor(expectedEntries);
    this.keyLeft = new Uint32Array(capacity);
    this.keyRight = new Uint32Array(capacity);
    this.sums = new Float64Array(capacity);
    this.counts = new Uint32Array(capacity);
  }

  add(leftId: number, rightId: number, sum: number, count: number): void {
    const slot = this.slotFor(leftId, rightId);
    if (at(this.keyLeft, slot) !== 0) {
      this.sums[slot] = at(this.sums, slot) + sum;
      this.counts[slot] = at(this.counts, slot) + count;
      return;
    }
    this.write(slot, leftId, rightId, sum, count);
    if (this.entries * 10 > this.keyLeft.length * 7) this.grow();
  }

  set(leftId: number, rightId: number, sum: number, count: number): void {
    const slot = this.slotFor(leftId, rightId);
    if (at(this.keyLeft, slot) === 0) {
      this.write(slot, leftId, rightId, sum, count);
      if (this.entries * 10 > this.keyLeft.length * 7) this.grow();
      return;
    }
    this.sums[slot] = sum;
    this.counts[slot] = count;
  }

  get(leftId: number, rightId: number): FacePairSum {
    const slot = this.slotFor(leftId, rightId);
    return at(this.keyLeft, slot) === 0
      ? { sum: 0, count: 0 }
      : { sum: at(this.sums, slot), count: at(this.counts, slot) };
  }

  private write(slot: number, leftId: number, rightId: number, sum: number, count: number): void {
    const ids = pairIds(leftId, rightId);
    this.keyLeft[slot] = ids.leftId + 1;
    this.keyRight[slot] = ids.rightId + 1;
    this.sums[slot] = sum;
    this.counts[slot] = count;
    this.entries += 1;
  }

  private slotFor(leftId: number, rightId: number): number {
    const ids = pairIds(leftId, rightId);
    let slot = hashPair(ids.leftId, ids.rightId) & (this.keyLeft.length - 1);
    while (true) {
      const left = at(this.keyLeft, slot);
      if (left === 0) return slot;
      if (left === ids.leftId + 1 && at(this.keyRight, slot) === ids.rightId + 1) return slot;
      slot = (slot + 1) & (this.keyLeft.length - 1);
    }
  }

  private grow(): void {
    const oldLeft = this.keyLeft;
    const oldRight = this.keyRight;
    const oldSums = this.sums;
    const oldCounts = this.counts;
    this.keyLeft = new Uint32Array(oldLeft.length * 2);
    this.keyRight = new Uint32Array(oldRight.length * 2);
    this.sums = new Float64Array(oldSums.length * 2);
    this.counts = new Uint32Array(oldCounts.length * 2);
    this.entries = 0;
    for (let index = 0; index < oldLeft.length; index += 1) {
      const left = at(oldLeft, index);
      if (left === 0) continue;
      this.set(left - 1, at(oldRight, index) - 1, at(oldSums, index), at(oldCounts, index));
    }
  }
}

const tableCapacityFor = (expectedEntries: number): number => {
  let capacity = 16;
  const target = Math.max(16, Math.ceil(expectedEntries / 0.7));
  while (capacity < target) capacity *= 2;
  return capacity;
};

const hashPair = (leftId: number, rightId: number): number =>
  (Math.imul(leftId + 1, 0x9e3779b1) ^ Math.imul(rightId + 1, 0x85ebca77)) >>> 0;

export const buildFacePairSumStoreForTest = (expectedEntries: number): {
  add: (leftId: number, rightId: number, sum: number, count: number) => void;
  get: (leftId: number, rightId: number) => FacePairSum;
} => new FacePairSumStore(expectedEntries);

export interface FaceSimilarityEdges {
  leftIds: Uint32Array;
  rightIds: Uint32Array;
  similarities: Float64Array;
  count: number;
}

class FaceSimilarityEdgeBuilder {
  private leftIds: Uint32Array;
  private rightIds: Uint32Array;
  private similarities: Float64Array;
  private length = 0;

  constructor(capacity: number) {
    const initialCapacity = Math.max(16, capacity);
    this.leftIds = new Uint32Array(initialCapacity);
    this.rightIds = new Uint32Array(initialCapacity);
    this.similarities = new Float64Array(initialCapacity);
  }

  append(leftId: number, rightId: number, similarity: number): void {
    if (this.length === this.leftIds.length) this.grow();
    this.leftIds[this.length] = leftId;
    this.rightIds[this.length] = rightId;
    this.similarities[this.length] = similarity;
    this.length += 1;
  }

  build(): FaceSimilarityEdges {
    return {
      leftIds: this.leftIds.slice(0, this.length),
      rightIds: this.rightIds.slice(0, this.length),
      similarities: this.similarities.slice(0, this.length),
      count: this.length,
    };
  }

  private grow(): void {
    const capacity = this.leftIds.length * 2;
    const leftIds = new Uint32Array(capacity);
    leftIds.set(this.leftIds);
    this.leftIds = leftIds;
    const rightIds = new Uint32Array(capacity);
    rightIds.set(this.rightIds);
    this.rightIds = rightIds;
    const similarities = new Float64Array(capacity);
    similarities.set(this.similarities);
    this.similarities = similarities;
  }
}

export interface PreparedFaceClustering {
  ordered: FaceClusterInput[];
  unassignedObsIds: string[];
  edges: FaceSimilarityEdges;
}

export const prepareFaceClustering = (
  observations: readonly FaceClusterInput[],
  options: Pick<FaceClusteringOptions, 'onSimilarityBlock'> = {},
): PreparedFaceClustering => {
  const allOrdered = [...observations].sort((left, right) => left.obsId.localeCompare(right.obsId));
  const ordered = allOrdered.filter(isClusterableFaceInput);
  const unassignedObsIds = allOrdered
    .filter((observation) => !isClusterableFaceInput(observation))
    .map((observation) => observation.obsId);
  const edges = buildFaceSimilarityEdges(ordered, options.onSimilarityBlock);
  return { ordered, unassignedObsIds, edges };
};

export const buildFaceSimilarityEdges = (
  ordered: readonly FaceClusterInput[],
  onSimilarityBlock?: ((candidatePairs: number) => void) | undefined,
): FaceSimilarityEdges => {
  const builder = new FaceSimilarityEdgeBuilder(ordered.length);
  for (let leftBlockStart = 0; leftBlockStart < ordered.length; leftBlockStart += FACE_CLUSTERING.edgeBlockSize) {
    const leftBlockEnd = Math.min(leftBlockStart + FACE_CLUSTERING.edgeBlockSize, ordered.length);
    for (let rightBlockStart = leftBlockStart; rightBlockStart < ordered.length; rightBlockStart += FACE_CLUSTERING.edgeBlockSize) {
      const rightBlockEnd = Math.min(rightBlockStart + FACE_CLUSTERING.edgeBlockSize, ordered.length);
      onSimilarityBlock?.((leftBlockEnd - leftBlockStart) * (rightBlockEnd - rightBlockStart));
      for (let leftIndex = leftBlockStart; leftIndex < leftBlockEnd; leftIndex += 1) {
        const left = ordered[leftIndex];
        if (left === undefined) continue;
        const firstRight = rightBlockStart === leftBlockStart ? leftIndex + 1 : rightBlockStart;
        for (let rightIndex = firstRight; rightIndex < rightBlockEnd; rightIndex += 1) {
          const right = ordered[rightIndex];
          if (right === undefined) continue;
          const similarity = cosineSimilarity(left.embedding, right.embedding);
          if (similarity < FACE_CLUSTERING.reviewBandMin) continue;
          builder.append(leftIndex, rightIndex, similarity);
        }
      }
    }
  }
  return builder.build();
};

const pushMergeCandidate = (
  heap: MergeHeap,
  clusters: ReadonlyMap<number, AgglomerativeCluster>,
  pairSums: FacePairSumStore,
  leftId: number,
  rightId: number,
): void => {
  const left = clusters.get(leftId);
  const right = clusters.get(rightId);
  if (left === undefined || right === undefined) return;
  const pairSum = pairSums.get(leftId, rightId);
  if (pairSum.count === 0) return;
  const denominator = left.members.length * right.members.length;
  const score = pairSum.sum / denominator;
  const ids = pairIds(leftId, rightId);
  heap.push({
    ...ids,
    score,
    density: pairSum.count / denominator,
    mergedSize: left.members.length + right.members.length,
    minRank: Math.min(at(left.members, 0), at(right.members, 0)),
  });
};

const centroidFromMemberTotals = (totals: readonly number[], size: number): number[] =>
  normalizeEmbedding(totals.map((value) => value / size));

export const clusterFaceObservations = (
  observations: readonly FaceClusterInput[],
  options: FaceClusteringOptions = {},
): FaceClusteringOutcome => {
  const prepared = prepareFaceClustering(observations, options);
  return clusterPreparedFaceObservations(prepared, options);
};

export const clusterPreparedFaceObservations = (
  prepared: PreparedFaceClustering,
  options: Omit<FaceClusteringOptions, 'onSimilarityBlock'> = {},
): FaceClusteringOutcome => {
  const clusterCutSimilarity = options.clusterCutSimilarity ?? FACE_CLUSTERING.clusterCutSimilarity;
  const minEdgeDensity = options.minEdgeDensity ?? FACE_CLUSTER_MIN_EDGE_DENSITY;
  const ordered = prepared.ordered;
  const unassignedObsIds = [...prepared.unassignedObsIds];

  const clusters = new Map<number, AgglomerativeCluster>();
  for (let index = 0; index < ordered.length; index += 1) {
    const observation = ordered[index];
    if (observation === undefined) continue;
    clusters.set(index, {
      id: index,
      members: [index],
      minObsId: observation.obsId,
      totals: [...observation.embedding],
    });
  }

  const maxClusterCount = Math.max(1, ordered.length * 2);
  const alive = new Uint8Array(maxClusterCount);
  const neighbours: number[][] = Array.from({ length: maxClusterCount }, () => []);
  for (let index = 0; index < ordered.length; index += 1) alive[index] = 1;
  const pairSums = new FacePairSumStore(prepared.edges.count + ordered.length);
  const heap = new MergeHeap(prepared.edges.count + ordered.length);
  for (let edgeIndex = 0; edgeIndex < prepared.edges.count; edgeIndex += 1) {
    const leftId = at(prepared.edges.leftIds, edgeIndex);
    const rightId = at(prepared.edges.rightIds, edgeIndex);
    const similarity = at(prepared.edges.similarities, edgeIndex);
    pairSums.set(leftId, rightId, similarity, 1);
    neighbours[leftId]?.push(rightId);
    neighbours[rightId]?.push(leftId);
  }
  for (let edgeIndex = 0; edgeIndex < prepared.edges.count; edgeIndex += 1) {
    pushMergeCandidate(heap, clusters, pairSums, at(prepared.edges.leftIds, edgeIndex), at(prepared.edges.rightIds, edgeIndex));
  }

  let nextClusterId = ordered.length;
  let markerToken = 1;
  const markers = new Uint32Array(maxClusterCount);
  while (true) {
    const candidate = heap.pop();
    if (candidate === undefined || candidate.score < clusterCutSimilarity) break;
    if (at(alive, candidate.leftId) === 0 || at(alive, candidate.rightId) === 0) continue;
    const left = clusters.get(candidate.leftId);
    const right = clusters.get(candidate.rightId);
    if (left === undefined || right === undefined) continue;
    const currentPairSum = pairSums.get(left.id, right.id);
    const currentDenominator = left.members.length * right.members.length;
    const currentScore = currentPairSum.sum / currentDenominator;
    const currentDensity = currentPairSum.count / currentDenominator;
    if (Math.abs(currentScore - candidate.score) > Number.EPSILON) continue;
    if (Math.abs(currentDensity - candidate.density) > Number.EPSILON) continue;
    if (left.members.length >= 3 && right.members.length >= 3 && currentDensity < minEdgeDensity) continue;

    const members = [...left.members, ...right.members].sort((leftMember, rightMember) =>
      (ordered[leftMember]?.obsId ?? '').localeCompare(ordered[rightMember]?.obsId ?? ''));
    const merged: AgglomerativeCluster = {
      id: nextClusterId,
      members,
      minObsId: left.minObsId.localeCompare(right.minObsId) <= 0 ? left.minObsId : right.minObsId,
      totals: left.totals.map((value, index) => value + at(right.totals, index)),
    };
    nextClusterId += 1;

    const neighbourIds: number[] = [];
    markerToken += 1;
    for (const id of [...(neighbours[left.id] ?? []), ...(neighbours[right.id] ?? [])]) {
      if (id === left.id || id === right.id || at(alive, id) === 0 || at(markers, id) === markerToken) continue;
      markers[id] = markerToken;
      neighbourIds.push(id);
    }
    clusters.delete(left.id);
    clusters.delete(right.id);
    alive[left.id] = 0;
    alive[right.id] = 0;
    neighbours[left.id] = [];
    neighbours[right.id] = [];
    clusters.set(merged.id, merged);
    alive[merged.id] = 1;

    for (const neighbourId of neighbourIds) {
      const neighbourCluster = clusters.get(neighbourId);
      if (neighbourCluster === undefined) continue;
      const leftPair = pairSums.get(left.id, neighbourId);
      const rightPair = pairSums.get(right.id, neighbourId);
      const mergedSum = leftPair.sum + rightPair.sum;
      const mergedCount = leftPair.count + rightPair.count;
      if (mergedCount === 0) continue;
      pairSums.set(merged.id, neighbourId, mergedSum, mergedCount);
      neighbours[neighbourId]?.push(merged.id);
      neighbours[merged.id]?.push(neighbourId);
      pushMergeCandidate(heap, clusters, pairSums, merged.id, neighbourId);
    }
  }

  const taken = new Set<string>();
  const finalClusters: FaceCluster[] = [];
  for (const cluster of [...clusters.values()].sort((left, right) => left.minObsId.localeCompare(right.minObsId))) {
    const memberObsIds = cluster.members
      .map((index) => ordered[index]?.obsId)
      .filter((obsId): obsId is string => obsId !== undefined)
      .sort();
    if (memberObsIds.length < FACE_CLUSTERING.newClusterMinObservations) {
      unassignedObsIds.push(...memberObsIds);
      continue;
    }
    const personId = personIdFromSeed(memberObsIds[0] ?? cluster.minObsId, taken);
    taken.add(personId);
    finalClusters.push({
      personId,
      centroid: centroidFromMemberTotals(cluster.totals, cluster.members.length),
      memberObsIds,
    });
  }

  return { clusters: finalClusters, unassignedObsIds: unassignedObsIds.sort() };
};

export const shouldMergePeople = (
  left: { centroid: readonly number[]; exemplars: readonly (readonly number[])[] },
  right: { centroid: readonly number[]; exemplars: readonly (readonly number[])[] },
): boolean => {
  if (cosineSimilarity(left.centroid, right.centroid) < FACE_CLUSTERING.autoMergeSimilarity) return false;
  let supportingPairs = 0;
  for (const leftExemplar of left.exemplars) {
    for (const rightExemplar of right.exemplars) {
      if (cosineSimilarity(leftExemplar, rightExemplar) >= FACE_CLUSTERING.autoMergeSimilarity) supportingPairs += 1;
    }
  }
  return supportingPairs >= FACE_CLUSTERING.autoMergeMinPairs;
};

export const estimateSimilarityTransform = (
  source: readonly FacePoint[],
  target: readonly FacePoint[],
): SimilarityTransform => {
  if (source.length !== target.length || source.length === 0) return { a: 1, b: 0, tx: 0, ty: 0 };
  const sourceMean = meanPoint(source);
  const targetMean = meanPoint(target);
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (let index = 0; index < source.length; index += 1) {
    const sourcePoint = source[index];
    const targetPoint = target[index];
    if (sourcePoint === undefined || targetPoint === undefined) continue;
    const sx = sourcePoint.x - sourceMean.x;
    const sy = sourcePoint.y - sourceMean.y;
    const tx = targetPoint.x - targetMean.x;
    const ty = targetPoint.y - targetMean.y;
    numeratorA += sx * tx + sy * ty;
    numeratorB += sx * ty - sy * tx;
    denominator += sx * sx + sy * sy;
  }
  if (denominator === 0) return { a: 1, b: 0, tx: targetMean.x - sourceMean.x, ty: targetMean.y - sourceMean.y };
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  return {
    a,
    b,
    tx: targetMean.x - a * sourceMean.x + b * sourceMean.y,
    ty: targetMean.y - b * sourceMean.x - a * sourceMean.y,
  };
};

export const applySimilarityTransform = (transform: SimilarityTransform, point: FacePoint): FacePoint => ({
  x: transform.a * point.x - transform.b * point.y + transform.tx,
  y: transform.b * point.x + transform.a * point.y + transform.ty,
});

const meanPoint = (points: readonly FacePoint[]): FacePoint => {
  const sum = points.reduce((accumulator, point) => ({
    x: accumulator.x + point.x,
    y: accumulator.y + point.y,
  }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
};
