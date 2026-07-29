import { describe, expect, it } from 'vitest';

import {
  FACE_CLUSTERING,
  FACE_EMBEDDING_DIM,
  FACE_ENGINE_VERSION,
  FACE_QUALITY,
  boxIoU,
  classifyFace,
  clusterFaceObservations,
  cosineSimilarity,
  faceObservationSchema,
  findNewClusterSeed,
  normalizeEmbedding,
  parseFaceObsId,
  passesFaceQuality,
  personSchema,
  planExemplarBackfill,
  selectExemplars,
  shouldMergePeople,
  updateCentroid,
  type ExemplarCandidate,
  type ExemplarPlanObservation,
} from './faces.js';

const unitAtCosine = (cosine: number): number[] => [cosine, Math.sqrt(Math.max(0, 1 - cosine * cosine))];

const unitAtAngleDeg = (deg: number): number[] => {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
};

const embedding = (fill: number): number[] => Array.from({ length: FACE_EMBEDDING_DIM }, () => fill);

const twoDistinctIdentityPool = (): number[][] => [
  unitAtAngleDeg(0),
  unitAtAngleDeg(2),
  unitAtAngleDeg(-2),
  unitAtAngleDeg(90),
  unitAtAngleDeg(92),
  unitAtAngleDeg(88),
];

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

  it('does not absorb an observation that is too weak to found an identity', () => {
    const result = classifyFace(anchor, [{ personId: 'a', centroid: unitAtCosine(0.46) }]);
    expect(result.decision).not.toBe('assign');
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
  it('groups two mutually-similar unassigned observations', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.02), unitAtCosine(0.04)]);
    expect(members).toEqual([0, 1, 2]);
  });

  it('does not seed a cluster from a single close observation and an outlier', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.99)]);
    expect(members).toEqual([]);
  });

  it('seeds one identity from a pool that holds two distinct identities', () => {
    const pool = twoDistinctIdentityPool();
    const seed = findNewClusterSeed(pool);
    expect(seed.length).toBeGreaterThanOrEqual(2);
    const angles = seed.map((index) => (index < 3 ? 'A' : 'B'));
    expect(new Set(angles).size).toBe(1);
  });

  it('seeds only the mutually-similar pair from a similarity chain', () => {
    const members = findNewClusterSeed([unitAtCosine(0), unitAtCosine(0.62), unitAtCosine(0.95)]);
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const left of members) {
      for (const right of members) {
        if (left === right) continue;
        const embeddings = [unitAtCosine(0), unitAtCosine(0.62), unitAtCosine(0.95)];
        expect(cosineSimilarity(embeddings[left] ?? [], embeddings[right] ?? []))
          .toBeGreaterThanOrEqual(FACE_CLUSTERING.newClusterSimilarity);
      }
    }
  });
});

describe('clusterFaceObservations', () => {
  const poolInputs = (): { obsId: string; embedding: readonly number[]; quality: number }[] =>
    twoDistinctIdentityPool().map((vector, index) => ({
      obsId: `o${index}`,
      embedding: vector,
      quality: 0.9,
    }));

  it('clusters two clearly distinct embedding sets into two people', () => {
    const outcome = clusterFaceObservations(poolInputs());
    expect(outcome.clusters.length).toBe(2);
    expect(outcome.unassignedObsIds).toEqual([]);
    for (const cluster of outcome.clusters) {
      expect(new Set(cluster.memberObsIds.map((obsId) => (Number(obsId.slice(1)) < 3 ? 'A' : 'B'))).size).toBe(1);
    }
  });

  it('is deterministic and independent of input order', () => {
    const inputs = poolInputs();
    const shuffled = [inputs[4], inputs[0], inputs[5], inputs[1], inputs[3], inputs[2]]
      .filter((value): value is typeof inputs[number] => value !== undefined);
    const first = clusterFaceObservations(inputs);
    const second = clusterFaceObservations(shuffled);
    const normalize = (outcome: typeof first) =>
      outcome.clusters
        .map((cluster) => [...cluster.memberObsIds].sort())
        .sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''));
    expect(normalize(second)).toEqual(normalize(first));
  });
});

describe('selectExemplars', () => {
  it('selects at most one exemplar per file, best quality first', () => {
    const candidates: ExemplarCandidate[] = [
      { obsId: 'a1', fingerprint: 'fp-a', quality: 0.9, cropPath: 'a1.jpg' },
      { obsId: 'a2', fingerprint: 'fp-a', quality: 0.95, cropPath: 'a2.jpg' },
      { obsId: 'a3', fingerprint: 'fp-a', quality: 0.8, cropPath: 'a3.jpg' },
      { obsId: 'b1', fingerprint: 'fp-b', quality: 0.7, cropPath: 'b1.jpg' },
      { obsId: 'b2', fingerprint: 'fp-b', quality: 0.85, cropPath: 'b2.jpg' },
      { obsId: 'c1', fingerprint: 'fp-c', quality: 0.6, cropPath: 'c1.jpg' },
      { obsId: 'c2', fingerprint: 'fp-c', quality: 0.55, cropPath: 'c2.jpg' },
    ];
    const selected = selectExemplars(candidates);
    expect(selected.map((observation) => observation.obsId)).toEqual(['a2', 'b2', 'c1']);
  });

  it('selects a single exemplar for a person confined to one file', () => {
    const candidates: ExemplarCandidate[] = Array.from({ length: 5 }, (_unused, index) => ({
      obsId: `o${index}`,
      fingerprint: 'fp-a',
      quality: 0.5 + index * 0.01,
      cropPath: `o${index}.jpg`,
    }));
    expect(selectExemplars(candidates)).toHaveLength(1);
  });

  it('caps the selection at five files, deterministic under input shuffling', () => {
    const candidates: ExemplarCandidate[] = Array.from({ length: 8 }, (_unused, index) => ({
      obsId: `o${index}`,
      fingerprint: `fp-${index}`,
      quality: index,
      cropPath: `o${index}.jpg`,
    }));
    const expected = ['o7', 'o6', 'o5', 'o4', 'o3'];
    expect(selectExemplars(candidates).map((observation) => observation.obsId)).toEqual(expected);
    const shuffled = [...candidates].reverse();
    expect(selectExemplars(shuffled).map((observation) => observation.obsId)).toEqual(expected);
  });
});

describe('parseFaceObsId', () => {
  it('parses the frame and detection numbers out of an observation id', () => {
    expect(parseFaceObsId('abc:face:3:2')).toEqual({ fingerprint: 'abc', frameIndex: 3, detectionIndex: 2 });
    expect(parseFaceObsId('abc')).toBeNull();
    expect(parseFaceObsId('abc:face:x:1')).toBeNull();
    expect(parseFaceObsId('abc:face:1')).toBeNull();
  });
});

describe('planExemplarBackfill', () => {
  it('plans a backfill only for the exemplars a person is missing', () => {
    const observations: ExemplarPlanObservation[] = [
      { obsId: 'p1:face:1:1', fingerprint: 'fp-a', quality: 0.9, cropPath: 'existing.jpg', personId: 'p1', frameTsS: 1, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { obsId: 'p1:face:1:2', fingerprint: 'fp-b', quality: 0.5, cropPath: null, personId: 'p1', frameTsS: 2, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { obsId: 'p1:face:1:3', fingerprint: 'fp-c', quality: 0.4, cropPath: null, personId: 'p1', frameTsS: 3, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { obsId: 'p2:face:1:1', fingerprint: 'fp-d', quality: 0.3, cropPath: null, personId: 'p2', frameTsS: 4, bbox: { x: 0, y: 0, width: 10, height: 10 } },
    ];
    const plan = planExemplarBackfill(observations);
    expect(plan.items.map((item) => item.obsId)).toEqual(['p1:face:1:2', 'p1:face:1:3', 'p2:face:1:1']);
    expect(plan.items.map((item) => item.fingerprint)).toEqual(['fp-b', 'fp-c', 'fp-d']);
    expect(plan.personsWithoutExemplar).toBe(1);
    expect(plan.observationsUnaddressable).toBe(0);
  });

  it('counts an unparsable observation id as unaddressable rather than throwing', () => {
    const observations: ExemplarPlanObservation[] = [
      { obsId: 'not-a-valid-id', fingerprint: 'fp-a', quality: 0.9, cropPath: null, personId: 'p1', frameTsS: 1, bbox: { x: 0, y: 0, width: 10, height: 10 } },
    ];
    const plan = planExemplarBackfill(observations);
    expect(plan.items).toEqual([]);
    expect(plan.observationsUnaddressable).toBe(1);
    expect(plan.personsWithoutExemplar).toBe(1);
  });
});

describe('boxIoU', () => {
  it('is 1 for identical boxes, 0 for disjoint boxes, 1/3 at half-overlap', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    expect(boxIoU(box, box)).toBeCloseTo(1);
    expect(boxIoU(box, { x: 100, y: 100, width: 10, height: 10 })).toBe(0);
    expect(boxIoU(box, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(1 / 3);
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
  it('matches the ADR-0012 clustering decisions', () => {
    expect(FACE_CLUSTERING).toEqual({
      autoAssignSimilarity: 0.5,
      autoAssignMargin: 0.05,
      reviewBandMin: 0.36,
      newClusterSimilarity: 0.5,
      newClusterMinObservations: 2,
      autoMergeSimilarity: 0.55,
      autoMergeMinPairs: 2,
    });
    expect(FACE_EMBEDDING_DIM).toBe(128);
  });

  it('never makes founding an identity harder than joining one', () => {
    expect(FACE_CLUSTERING.newClusterSimilarity).toBeLessThanOrEqual(FACE_CLUSTERING.autoAssignSimilarity);
  });

  it('a threshold or crop-policy change is not an extraction change — the engine version stays 2', () => {
    expect(FACE_ENGINE_VERSION).toBe(2);
  });
});
