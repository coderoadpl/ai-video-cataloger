import { describe, expect, it } from 'vitest';

import {
  FACE_CLUSTERING,
  FACE_EMBEDDING_DIM,
  FACE_ENGINE_VERSION,
  FACE_QUALITY,
  classifyFace,
  cosineSimilarity,
  faceObservationSchema,
  findNewClusterSeed,
  normalizeEmbedding,
  passesFaceQuality,
  personSchema,
  shouldMergePeople,
  updateCentroid,
} from './faces.js';

const unitAtCosine = (cosine: number): number[] => [cosine, Math.sqrt(Math.max(0, 1 - cosine * cosine))];

const embedding = (fill: number): number[] => Array.from({ length: FACE_EMBEDDING_DIM }, () => fill);

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 when a vector has zero magnitude', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('classifyFace', () => {
  const anchor = [1, 0];

  it('auto-assigns when similarity clears the threshold with margin', () => {
    const result = classifyFace(anchor, [
      { personId: 'a', centroid: unitAtCosine(0.6) },
      { personId: 'b', centroid: unitAtCosine(0.3) },
    ]);
    expect(result.decision).toBe('assign');
    expect(result.decision === 'assign' && result.personId).toBe('a');
  });

  it('sends to review when similarity is high but the margin is too small', () => {
    const result = classifyFace(anchor, [
      { personId: 'a', centroid: unitAtCosine(0.5) },
      { personId: 'b', centroid: unitAtCosine(0.48) },
    ]);
    expect(result.decision).toBe('review');
  });

  it('sends to review inside the review band', () => {
    const result = classifyFace(anchor, [{ personId: 'a', centroid: unitAtCosine(0.4) }]);
    expect(result.decision).toBe('review');
  });

  it('leaves unassigned below the review band', () => {
    const result = classifyFace(anchor, [{ personId: 'a', centroid: unitAtCosine(0.2) }]);
    expect(result.decision).toBe('unassigned');
  });

  it('is unassigned with no people', () => {
    expect(classifyFace(anchor, []).decision).toBe('unassigned');
  });
});

describe('updateCentroid', () => {
  it('normalizes the raw embedding for the first exemplar', () => {
    expect(updateCentroid([0, 0], 0, [3, 4])).toEqual([0.6, 0.8]);
  });

  it('moves the centroid toward the new exemplar as a running mean', () => {
    const updated = updateCentroid([1, 0], 1, [0, 1]);
    expect(updated[0]).toBeCloseTo(Math.SQRT1_2);
    expect(updated[1]).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('findNewClusterSeed', () => {
  it('groups three mutually-similar unassigned observations', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.02), unitAtCosine(0.04)]);
    expect(members).toEqual([0, 1, 2]);
  });

  it('does not seed a cluster from two close observations and an outlier', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.02), unitAtCosine(0.99)]);
    expect(members).toEqual([]);
  });

  it('does not seed a cluster from a similarity chain that is not pairwise similar', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.62), unitAtCosine(0.95)]);
    expect(members).toEqual([]);
  });
});

describe('shouldMergePeople', () => {
  it('merges when centroids and enough exemplar pairs agree', () => {
    const near = [unitAtCosine(0), unitAtCosine(0.02)];
    expect(
      shouldMergePeople(
        { centroid: unitAtCosine(0), exemplars: near },
        { centroid: unitAtCosine(0.01), exemplars: near },
      ),
    ).toBe(true);
  });

  it('does not merge when centroids are far apart', () => {
    expect(
      shouldMergePeople(
        { centroid: [1, 0], exemplars: [[1, 0]] },
        { centroid: [0, 1], exemplars: [[0, 1]] },
      ),
    ).toBe(false);
  });

  it('does not merge without enough supporting exemplar pairs', () => {
    expect(
      shouldMergePeople(
        { centroid: unitAtCosine(0), exemplars: [unitAtCosine(0)] },
        { centroid: unitAtCosine(0.01), exemplars: [unitAtCosine(0.01)] },
      ),
    ).toBe(false);
  });
});

describe('passesFaceQuality', () => {
  it('drops low-score or small-box detections', () => {
    expect(passesFaceQuality({ score: FACE_QUALITY.minScore, boxPx: FACE_QUALITY.minBoxPx })).toBe(true);
    expect(passesFaceQuality({ score: 0.5, boxPx: 100 })).toBe(false);
    expect(passesFaceQuality({ score: 0.9, boxPx: 20 })).toBe(false);
  });
});

describe('face schemas', () => {
  it('rejects an embedding of the wrong dimensionality', () => {
    const parsed = faceObservationSchema.safeParse({
      obsId: 'o1',
      fingerprint: 'fp1',
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 50, height: 50 },
      embedding: [1, 2, 3],
      quality: 0.9,
      personId: null,
      cropPath: null,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a well-formed person', () => {
    const parsed = personSchema.safeParse({
      personId: 'p1',
      displayName: null,
      kind: 'face',
      createdAt: '2026-01-01T00:00:00.000Z',
      centroid: normalizeEmbedding(embedding(1)),
      exemplarCount: 0,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('research thresholds are pinned', () => {
  it('matches the P5 clustering decisions', () => {
    expect(FACE_CLUSTERING).toEqual({
      autoAssignSimilarity: 0.45,
      autoAssignMargin: 0.05,
      reviewBandMin: 0.36,
      newClusterSimilarity: 0.5,
      newClusterMinObservations: 3,
      autoMergeSimilarity: 0.55,
      autoMergeMinPairs: 2,
    });
    expect(FACE_EMBEDDING_DIM).toBe(128);
  });

  it('pins the corrected embedding-space engine version', () => {
    expect(FACE_ENGINE_VERSION).toBe(2);
  });
});
