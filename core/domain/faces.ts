import { z } from 'zod';

export const SUBJECT_KINDS = ['face'] as const;
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export type SubjectKind = z.output<typeof subjectKindSchema>;

export const FACE_EMBEDDING_DIM = 128;

export const FACE_CLUSTERING = {
  autoAssignSimilarity: 0.45,
  autoAssignMargin: 0.05,
  reviewBandMin: 0.36,
  newClusterSimilarity: 0.5,
  newClusterMinObservations: 3,
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
  exemplarCropMaxPx: 160,
} as const;

export const faceBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type FaceBox = z.output<typeof faceBoxSchema>;

export const faceEmbeddingSchema = z.array(z.number()).length(FACE_EMBEDDING_DIM);
export type FaceEmbedding = z.output<typeof faceEmbeddingSchema>;

export const personSchema = z.object({
  personId: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  kind: subjectKindSchema,
  createdAt: z.string().datetime(),
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

const isPairwiseSimilar = (embeddings: readonly (readonly number[])[], indices: readonly number[]): boolean =>
  indices.every((left, position) =>
    indices
      .slice(position + 1)
      .every(
        (right) =>
          cosineSimilarity(embeddings[left] ?? [], embeddings[right] ?? []) >= FACE_CLUSTERING.newClusterSimilarity,
      ),
  );

export const findNewClusterSeed = (embeddings: readonly (readonly number[])[]): number[] => {
  const members: number[] = [];
  embeddings.forEach((candidate, index) => {
    const supporters = embeddings.filter(
      (other, otherIndex) =>
        otherIndex !== index && cosineSimilarity(candidate, other) >= FACE_CLUSTERING.newClusterSimilarity,
    );
    if (supporters.length + 1 >= FACE_CLUSTERING.newClusterMinObservations) members.push(index);
  });
  if (members.length < FACE_CLUSTERING.newClusterMinObservations) return [];
  if (!isPairwiseSimilar(embeddings, members)) return [];
  return members;
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
