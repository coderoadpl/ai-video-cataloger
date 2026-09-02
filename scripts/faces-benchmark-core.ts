import { z } from 'zod';

import {
  EXEMPLAR_BBOX_MIN_IOU,
  FACE_CLUSTERING,
  boxIoU,
  clusterFaceObservations,
  type FaceBox,
  type FaceClusterInput,
} from '@core/domain/index.js';

export const pairVerdictSchema = z.enum(['same', 'different', 'unsure', 'not_face']);
export type PairVerdict = z.output<typeof pairVerdictSchema>;

const benchmarkFaceBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  sourceWidth: z.number().int().positive().optional(),
  sourceHeight: z.number().int().positive().optional(),
});

export const benchmarkObservationSchema = z.object({
  obsId: z.string().min(1),
  embedding: z.array(z.number()).min(1),
  quality: z.number().default(1),
  boxPx: z.number().positive().optional(),
  bbox: benchmarkFaceBoxSchema.optional(),
  photoFingerprint: z.string().min(1).optional(),
  sourceContentHash: z.string().min(1).optional(),
});
export type BenchmarkObservation = z.output<typeof benchmarkObservationSchema>;

export const referencePartitionRecordSchema = z.object({
  observationId: z.string().min(1),
  clusterId: z.string().min(1),
}).and(benchmarkObservationSchema.partial());
export type ReferencePartitionRecord = z.output<typeof referencePartitionRecordSchema>;

export const labelledPairSchema = z.object({
  left: z.string().min(1),
  right: z.string().min(1),
  verdict: pairVerdictSchema,
});
export type LabelledPair = z.output<typeof labelledPairSchema>;

export const nativeObservationSchema = z.object({
  obsId: z.string().min(1),
  fingerprint: z.string().min(1),
  bbox: benchmarkFaceBoxSchema,
  embedding: z.array(z.number()).min(1),
  quality: z.number(),
});
export type NativeObservation = z.output<typeof nativeObservationSchema>;

export interface MatchedBenchmarkCorpus {
  observations: BenchmarkObservation[];
  partition: Map<string, string>;
  pairs: LabelledPair[];
  unmatchedReference: number;
  unmatchedNative: number;
}

export interface ThresholdBenchmarkRow {
  threshold: number;
  pairwise: { precision: number; recall: number; f1: number; truePositive: number; falsePositive: number; falseNegative: number };
  purity: number;
  completeness: number;
  clusterCount: number;
  largestCluster: number;
  differentPairsMerged: number;
  elapsedMs: number;
}

export interface BenchmarkReport {
  thresholds: ThresholdBenchmarkRow[];
  selectedThreshold: number;
  bestPairwiseF1Threshold: number;
  largestZeroDifferentThreshold: number | null;
  pairSample: { left: string; right: string; similarity: number; bandMin: number; bandMax: number }[];
  unmatchedReference: number;
  unmatchedNative: number;
}

export const defaultThresholdSweep = (): number[] =>
  Array.from({ length: 26 }, (_unused, index) => Number((0.36 + index * 0.02).toFixed(2)));

export const buildFixtureCorpus = (
  records: readonly ReferencePartitionRecord[],
  pairs: readonly LabelledPair[],
): MatchedBenchmarkCorpus => {
  const observations = records
    .filter((record): record is ReferencePartitionRecord & { obsId: string; embedding: number[] } =>
      record.obsId !== undefined && record.embedding !== undefined)
    .map((record) => ({
      obsId: record.obsId,
      embedding: record.embedding,
      quality: record.quality ?? 1,
      ...(record.boxPx === undefined ? {} : { boxPx: record.boxPx }),
      ...(record.bbox === undefined ? {} : { bbox: record.bbox }),
    }));
  return {
    observations,
    partition: new Map(records.map((record) => [record.obsId ?? record.observationId, record.clusterId])),
    pairs: [...pairs],
    unmatchedReference: 0,
    unmatchedNative: 0,
  };
};

export const matchReferenceToNative = (
  referenceRecords: readonly ReferencePartitionRecord[],
  nativeObservations: readonly NativeObservation[],
  pairs: readonly LabelledPair[],
): MatchedBenchmarkCorpus => {
  const nativeByFingerprint = new Map<string, NativeObservation[]>();
  for (const observation of nativeObservations) {
    const bucket = nativeByFingerprint.get(observation.fingerprint);
    if (bucket === undefined) nativeByFingerprint.set(observation.fingerprint, [observation]);
    else bucket.push(observation);
  }

  const matchedIds = new Map<string, string>();
  const observations: BenchmarkObservation[] = [];
  const partition = new Map<string, string>();
  let unmatchedReference = 0;

  for (const reference of referenceRecords) {
    const fingerprint = referenceFingerprint(reference);
    const bbox = reference.bbox;
    if (fingerprint === null || bbox === undefined) {
      unmatchedReference += 1;
      continue;
    }
    const candidates = nativeByFingerprint.get(fingerprint) ?? [];
    const match = bestNativeMatch(bbox, candidates);
    if (match === null) {
      unmatchedReference += 1;
      continue;
    }
    matchedIds.set(reference.observationId, match.obsId);
    observations.push({
      obsId: match.obsId,
      embedding: match.embedding,
      quality: match.quality,
      boxPx: Math.min(match.bbox.width, match.bbox.height),
      bbox: match.bbox,
      photoFingerprint: match.fingerprint,
    });
    partition.set(match.obsId, reference.clusterId);
  }

  const matchedNativeIds = new Set(matchedIds.values());
  const unmatchedNative = nativeObservations.filter((observation) => !matchedNativeIds.has(observation.obsId)).length;
  return {
    observations,
    partition,
    pairs: pairs.map((pair) => ({
      left: matchedIds.get(pair.left) ?? pair.left,
      right: matchedIds.get(pair.right) ?? pair.right,
      verdict: pair.verdict,
    })),
    unmatchedReference,
    unmatchedNative,
  };
};

export const runBenchmark = (
  corpus: MatchedBenchmarkCorpus,
  thresholds: readonly number[] = defaultThresholdSweep(),
): BenchmarkReport => {
  const rows = thresholds.map((threshold) => benchmarkThreshold(corpus, threshold));
  const bestPairwise = [...rows].sort((left, right) =>
    right.pairwise.f1 - left.pairwise.f1 || right.threshold - left.threshold)[0];
  const largestZeroDifferent = [...rows]
    .filter((row) => row.differentPairsMerged === 0)
    .sort((left, right) => right.threshold - left.threshold)[0];
  const candidates = rows.filter((row) =>
    row.differentPairsMerged === 0 && bestPairwise !== undefined && row.threshold >= bestPairwise.threshold);
  const selected = (candidates.length === 0 ? largestZeroDifferent : [...candidates].sort((left, right) => right.threshold - left.threshold)[0])
    ?? [...rows].sort((left, right) => right.threshold - left.threshold)[0];
  return {
    thresholds: rows,
    selectedThreshold: selected?.threshold ?? FACE_CLUSTERING.clusterCutSimilarity,
    bestPairwiseF1Threshold: bestPairwise?.threshold ?? FACE_CLUSTERING.clusterCutSimilarity,
    largestZeroDifferentThreshold: largestZeroDifferent?.threshold ?? null,
    pairSample: stratifiedPairSample(corpus.observations),
    unmatchedReference: corpus.unmatchedReference,
    unmatchedNative: corpus.unmatchedNative,
  };
};

export const benchmarkReportTable = (report: BenchmarkReport): string => {
  const lines = [
    'threshold precision recall f1 purity completeness clusters largest differentMerged elapsedMs',
    ...report.thresholds.map((row) => [
      row.threshold.toFixed(2),
      row.pairwise.precision.toFixed(3),
      row.pairwise.recall.toFixed(3),
      row.pairwise.f1.toFixed(3),
      row.purity.toFixed(3),
      row.completeness.toFixed(3),
      String(row.clusterCount),
      String(row.largestCluster),
      String(row.differentPairsMerged),
      String(row.elapsedMs),
    ].join(' ')),
    `selected ${report.selectedThreshold.toFixed(2)}`,
    `bestPairwiseF1 ${report.bestPairwiseF1Threshold.toFixed(2)}`,
    `largestZeroDifferent ${report.largestZeroDifferentThreshold === null ? 'none' : report.largestZeroDifferentThreshold.toFixed(2)}`,
    `pairSample ${String(report.pairSample.length)}`,
    `unmatched reference=${String(report.unmatchedReference)} native=${String(report.unmatchedNative)}`,
  ];
  return lines.join('\n');
};

const referenceFingerprint = (record: ReferencePartitionRecord): string | null => {
  const raw = record.photoFingerprint ?? record.sourceContentHash;
  if (raw === undefined) return null;
  return raw.startsWith('ph_') ? raw : `ph_${raw}`;
};

const bestNativeMatch = (bbox: FaceBox, candidates: readonly NativeObservation[]): NativeObservation | null => {
  const ranked = candidates
    .map((candidate) => ({ candidate, iou: boxIoU(bbox, candidate.bbox) }))
    .filter((entry) => entry.iou >= EXEMPLAR_BBOX_MIN_IOU)
    .sort((left, right) => right.iou - left.iou || left.candidate.obsId.localeCompare(right.candidate.obsId));
  return ranked[0]?.candidate ?? null;
};

const benchmarkThreshold = (corpus: MatchedBenchmarkCorpus, threshold: number): ThresholdBenchmarkRow => {
  const startedAt = Date.now();
  const outcome = clusterFaceObservations(corpus.observations.map(toClusterInput), { clusterCutSimilarity: threshold });
  const clusterByObsId = new Map<string, string>();
  for (const cluster of outcome.clusters) {
    for (const obsId of cluster.memberObsIds) clusterByObsId.set(obsId, cluster.personId);
  }
  for (const obsId of outcome.unassignedObsIds) clusterByObsId.set(obsId, `unassigned:${obsId}`);
  const pairwise = scorePairs(corpus.pairs, clusterByObsId);
  const partitionScores = scorePartition(corpus.partition, clusterByObsId);
  return {
    threshold,
    pairwise,
    purity: partitionScores.purity,
    completeness: partitionScores.completeness,
    clusterCount: outcome.clusters.length,
    largestCluster: outcome.clusters.reduce((largest, cluster) => Math.max(largest, cluster.memberObsIds.length), 0),
    differentPairsMerged: pairwise.falsePositive,
    elapsedMs: Date.now() - startedAt,
  };
};

const toClusterInput = (observation: BenchmarkObservation): FaceClusterInput => ({
  obsId: observation.obsId,
  embedding: observation.embedding,
  quality: observation.quality,
  ...(observation.boxPx === undefined ? {} : { boxPx: observation.boxPx }),
});

const stratifiedPairSample = (
  observations: readonly BenchmarkObservation[],
): { left: string; right: string; similarity: number; bandMin: number; bandMax: number }[] => {
  const bands = new Map<number, { left: string; right: string; similarity: number; bandMin: number; bandMax: number }>();
  const ordered = [...observations].sort((left, right) => left.obsId.localeCompare(right.obsId));
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex];
      if (right === undefined) continue;
      const similarity = cosineSimilarityForSample(left.embedding, right.embedding);
      if (similarity < 0.3 || similarity >= 0.7) continue;
      const bandIndex = Math.floor((similarity - 0.3) / 0.02);
      if (bands.has(bandIndex)) continue;
      const bandMin = Number((0.3 + bandIndex * 0.02).toFixed(2));
      bands.set(bandIndex, {
        left: left.obsId,
        right: right.obsId,
        similarity,
        bandMin,
        bandMax: Number((bandMin + 0.02).toFixed(2)),
      });
    }
  }
  return [...bands.values()].sort((left, right) => left.bandMin - right.bandMin || left.left.localeCompare(right.left) || left.right.localeCompare(right.right));
};

const cosineSimilarityForSample = (left: readonly number[], right: readonly number[]): number => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
};

const scorePairs = (
  pairs: readonly LabelledPair[],
  clusterByObsId: ReadonlyMap<string, string>,
): ThresholdBenchmarkRow['pairwise'] => {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const pair of pairs) {
    if (pair.verdict !== 'same' && pair.verdict !== 'different') continue;
    const left = clusterByObsId.get(pair.left);
    const right = clusterByObsId.get(pair.right);
    if (left === undefined || right === undefined) continue;
    const merged = left === right;
    if (pair.verdict === 'same' && merged) truePositive += 1;
    if (pair.verdict === 'same' && !merged) falseNegative += 1;
    if (pair.verdict === 'different' && merged) falsePositive += 1;
  }
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, truePositive, falsePositive, falseNegative };
};

const scorePartition = (
  referenceByObsId: ReadonlyMap<string, string>,
  clusterByObsId: ReadonlyMap<string, string>,
): { purity: number; completeness: number } => {
  const matched = [...referenceByObsId.entries()].filter(([obsId]) => clusterByObsId.has(obsId));
  if (matched.length === 0) return { purity: 0, completeness: 0 };
  return {
    purity: weightedBestOverlap(matched, ([obsId]) => clusterByObsId.get(obsId) ?? '', ([, reference]) => reference),
    completeness: weightedBestOverlap(matched, ([, reference]) => reference, ([obsId]) => clusterByObsId.get(obsId) ?? ''),
  };
};

const weightedBestOverlap = (
  rows: readonly (readonly [string, string])[],
  bucketOf: (row: readonly [string, string]) => string,
  labelOf: (row: readonly [string, string]) => string,
): number => {
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bucket = bucketOf(row);
    const reference = labelOf(row);
    const counts = buckets.get(bucket) ?? new Map<string, number>();
    counts.set(reference, (counts.get(reference) ?? 0) + 1);
    buckets.set(bucket, counts);
  }
  let total = 0;
  for (const counts of buckets.values()) total += Math.max(...counts.values());
  return total / rows.length;
};
