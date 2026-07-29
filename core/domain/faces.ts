import { z } from 'zod';

export const SUBJECT_KINDS = ['face'] as const;
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export type SubjectKind = z.output<typeof subjectKindSchema>;

export const FACE_EMBEDDING_DIM = 128;

export const FACE_ENGINE_VERSION = 2;

// SFace cosine: same person ~0.4-0.6, different ~0.1-0.3 (OpenCV's reference verification
// threshold is 0.363). A false merge is unrecoverable without a full rebuild and poisons
// the centroid; a false split is one `faces merge` away — so the floor sits high, and
// founding an identity never needs a higher similarity than joining one (ADR-0012).
export const FACE_CLUSTERING = {
  autoAssignSimilarity: 0.5,
  autoAssignMargin: 0.05,
  reviewBandMin: 0.36,
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

export const shouldStoreExemplar = (input: {
  existing: readonly { fingerprint: string; cropPath: string | null }[];
  fingerprint: string;
}): boolean => {
  const withCrops = input.existing.filter((observation) => observation.cropPath !== null);
  if (withCrops.length >= FACE_LIMITS.maxExemplarsPerPerson) return false;
  return withCrops.filter((observation) => observation.fingerprint === input.fingerprint).length
    < FACE_LIMITS.maxExemplarsPerFile;
};

export const faceBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
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
  frameTsS: z.number().nonnegative(),
  bbox: faceBoxSchema,
  embedding: faceEmbeddingSchema,
  quality: z.number(),
  personId: z.string().min(1).nullable(),
  cropPath: z.string().min(1).nullable(),
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

const personIdFromSeed = (seedObsId: string, taken: ReadonlySet<string>): string => {
  const base = `person-${seedObsId.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().slice(0, 32)}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

export const clusterFaceObservations = (observations: readonly FaceClusterInput[]): FaceClusteringOutcome => {
  const ordered = [...observations].sort(
    (left, right) => right.quality - left.quality || left.obsId.localeCompare(right.obsId),
  );

  interface ProvisionalCluster {
    seedObsId: string;
    centroid: number[];
    memberObsIds: string[];
  }

  const provisional: ProvisionalCluster[] = [];
  for (const observation of ordered) {
    const assignment = classifyFace(
      observation.embedding,
      provisional.map((cluster) => ({ personId: cluster.seedObsId, centroid: cluster.centroid })),
    );
    const target = assignment.decision === 'assign'
      ? provisional.find((cluster) => cluster.seedObsId === assignment.personId)
      : undefined;
    if (target !== undefined) {
      target.centroid = updateCentroid(target.centroid, target.memberObsIds.length, observation.embedding);
      target.memberObsIds.push(observation.obsId);
      continue;
    }
    provisional.push({
      seedObsId: observation.obsId,
      centroid: normalizeEmbedding(observation.embedding),
      memberObsIds: [observation.obsId],
    });
  }

  const taken = new Set<string>();
  const clusters: FaceCluster[] = [];
  const unassignedObsIds: string[] = [];
  for (const cluster of provisional) {
    if (cluster.memberObsIds.length < FACE_CLUSTERING.newClusterMinObservations) {
      unassignedObsIds.push(...cluster.memberObsIds);
      continue;
    }
    const personId = personIdFromSeed(cluster.seedObsId, taken);
    taken.add(personId);
    clusters.push({ personId, centroid: cluster.centroid, memberObsIds: [...cluster.memberObsIds].sort() });
  }
  unassignedObsIds.sort();
  return { clusters, unassignedObsIds };
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
