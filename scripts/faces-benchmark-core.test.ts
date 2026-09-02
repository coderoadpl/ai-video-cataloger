import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  photoFingerprintFromSha256,
} from '@core/domain/index.js';

import {
  benchmarkObservationSchema,
  benchmarkReportTable,
  buildFixtureCorpus,
  defaultDensitySweep,
  labelledPairSchema,
  matchReferenceToNative,
  referencePartitionRecordSchema,
  runBenchmark,
  type LabelledPair,
  type NativeObservation,
  type ReferencePartitionRecord,
} from './faces-benchmark-core.js';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`__fixtures__/faces-benchmark/${name}`, import.meta.url));

const readFixture = async <Schema extends z.ZodTypeAny>(name: string, schema: Schema): Promise<z.output<Schema>> =>
  schema.parse(JSON.parse(await readFile(fixturePath(name), 'utf8')));

describe('faces benchmark metrics', () => {
  it('scores fixture precision, recall, F1, purity and completeness', async () => {
    const reference = await readFixture('reference.json', z.array(referencePartitionRecordSchema));
    const observations = await readFixture('observations.json', z.array(benchmarkObservationSchema));
    const pairs = await readFixture('labelled-pairs.json', z.array(labelledPairSchema));
    const corpus = buildFixtureCorpus(reference.map((record) => ({
      ...record,
      ...observations.find((observation) => observation.obsId === record.observationId),
    })), pairs);

    const report = runBenchmark(corpus, [0.56]);

    expect(report.thresholds[0]?.pairwise).toMatchObject({
      precision: 1,
      recall: 1,
      f1: 1,
      truePositive: 2,
      falsePositive: 0,
      falseNegative: 0,
    });
    expect(report.thresholds[0]?.purity).toBe(1);
    expect(report.thresholds[0]?.completeness).toBe(1);
    expect(report.largestZeroDifferentThreshold).toBe(0.56);
    expect(report.selectedThreshold).toBe(0.56);
    expect(report.pairSample.length).toBeGreaterThan(0);
    expect(benchmarkReportTable(report)).toContain('threshold samplePrecision sampleRecall sampleF1 referencePrecision referenceRecall referenceF1');
  });

  it('selects the higher zero-different threshold over a lower F1 optimum', () => {
    const records: ReferencePartitionRecord[] = [
      { observationId: 'a1', clusterId: 'identity-a', obsId: 'a1', embedding: [1, 0], quality: 1 },
      { observationId: 'a2', clusterId: 'identity-a', obsId: 'a2', embedding: [0.75, 0.6614378278, 0], quality: 1 },
      { observationId: 'b1', clusterId: 'identity-b', obsId: 'b1', embedding: [0.2, 0.756, 0.624], quality: 1 },
      { observationId: 'b2', clusterId: 'identity-b', obsId: 'b2', embedding: [0, 1, 0], quality: 1 },
    ];
    const pairs: LabelledPair[] = [
      { left: 'a1', right: 'a2', verdict: 'same' },
      { left: 'b1', right: 'b2', verdict: 'same' },
      { left: 'a2', right: 'b1', verdict: 'different' },
      { left: 'a1', right: 'b2', verdict: 'unsure' },
    ];

    const report = runBenchmark(buildFixtureCorpus(records, pairs), [0.59, 0.79]);

    expect(report.bestPairwiseF1Threshold).toBe(0.59);
    expect(report.largestZeroDifferentThreshold).toBe(0.79);
    expect(report.selectedThreshold).toBe(0.79);
  });

  it('sweeps edge density as a calibration axis', () => {
    const records: ReferencePartitionRecord[] = [
      { observationId: 'a1', clusterId: 'identity-a', obsId: 'a1', embedding: [1, 0], quality: 1 },
      { observationId: 'a2', clusterId: 'identity-a', obsId: 'a2', embedding: [1, 0], quality: 1 },
      { observationId: 'a3', clusterId: 'identity-a', obsId: 'a3', embedding: [1, 0], quality: 1 },
      { observationId: 'bridge', clusterId: 'identity-a', obsId: 'bridge', embedding: [0.7745966692414834, 0.6324555320336759], quality: 1 },
      { observationId: 'b1', clusterId: 'identity-b', obsId: 'b1', embedding: [0.2, 0.9797958971132712], quality: 1 },
      { observationId: 'b2', clusterId: 'identity-b', obsId: 'b2', embedding: [0.2, 0.9797958971132712], quality: 1 },
      { observationId: 'b3', clusterId: 'identity-b', obsId: 'b3', embedding: [0.2, 0.9797958971132712], quality: 1 },
    ];
    const pairs: LabelledPair[] = [
      { left: 'a1', right: 'a2', verdict: 'same' },
      { left: 'b1', right: 'b2', verdict: 'same' },
      { left: 'a1', right: 'b1', verdict: 'different' },
    ];

    const report = runBenchmark(buildFixtureCorpus(records, pairs), [0.19], [0, 0.3]);

    expect(defaultDensitySweep()).toContain(0.3);
    expect(report.thresholds.map((row) => [row.threshold, row.minEdgeDensity, row.differentPairsMerged])).toEqual([
      [0.19, 0, 1],
      [0.19, 0.3, 0],
    ]);
    expect(benchmarkReportTable(report)).toContain('density');
  });

  it('matches external reference ids to native photo observations by fingerprint and bbox IoU', () => {
    const sourceHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const reference: ReferencePartitionRecord[] = [
      {
        observationId: 'external-a',
        clusterId: 'identity-a',
        sourceContentHash: sourceHash,
        bbox: { x: 10, y: 10, width: 50, height: 50 },
      },
      {
        observationId: 'external-missing',
        clusterId: 'identity-b',
        sourceContentHash: sourceHash,
        bbox: { x: 200, y: 200, width: 50, height: 50 },
      },
    ];
    const fingerprint = photoFingerprintFromSha256(sourceHash);
    const native: NativeObservation[] = [
      {
        obsId: `${fingerprint}:face:1:1`,
        fingerprint,
        bbox: { x: 12, y: 12, width: 50, height: 50 },
        embedding: [1, 0],
        quality: 1,
      },
      {
        obsId: `${fingerprint}:face:1:2`,
        fingerprint,
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        embedding: [0, 1],
        quality: 1,
      },
    ];

    const corpus = matchReferenceToNative(reference, native, [
      { left: 'external-a', right: 'external-missing', verdict: 'different' },
    ]);

    expect(corpus.observations.map((observation) => observation.obsId)).toEqual([`${fingerprint}:face:1:1`]);
    expect(corpus.partition.get(`${fingerprint}:face:1:1`)).toBe('identity-a');
    expect(corpus.pairs[0]).toEqual({ left: `${fingerprint}:face:1:1`, right: 'external-missing', verdict: 'different' });
    expect(corpus.unmatchedReference).toBe(1);
    expect(corpus.unmatchedNative).toBe(1);
  });

  it('matches reference boxes to native detections one-to-one by descending IoU', () => {
    const fingerprint = 'ph_0123456789abcdef';
    const reference: ReferencePartitionRecord[] = [
      {
        observationId: 'external-low-iou',
        clusterId: 'identity-low',
        photoFingerprint: fingerprint,
        bbox: { x: 5, y: 5, width: 100, height: 100 },
      },
      {
        observationId: 'external-high-iou',
        clusterId: 'identity-high',
        photoFingerprint: fingerprint,
        bbox: { x: 0, y: 0, width: 100, height: 100 },
      },
    ];
    const native: NativeObservation[] = [{
      obsId: `${fingerprint}:face:1:1`,
      fingerprint,
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      embedding: [1, 0],
      quality: 1,
    }];

    const corpus = matchReferenceToNative(reference, native, []);

    expect(corpus.observations.map((observation) => observation.obsId)).toEqual([`${fingerprint}:face:1:1`]);
    expect(corpus.partition.get(`${fingerprint}:face:1:1`)).toBe('identity-high');
    expect(corpus.unmatchedReference).toBe(1);
    expect(corpus.unmatchedNative).toBe(0);
  });

  it('reports labelled-sample F1 separately from reference-partition F1', () => {
    const records: ReferencePartitionRecord[] = [
      { observationId: 'a1', clusterId: 'identity-a', obsId: 'a1', embedding: [1, 0], quality: 1 },
      { observationId: 'a2', clusterId: 'identity-a', obsId: 'a2', embedding: [1, 0], quality: 1 },
      { observationId: 'b1', clusterId: 'identity-b', obsId: 'b1', embedding: [0, 1], quality: 1 },
    ];

    const report = runBenchmark(buildFixtureCorpus(records, []), [0.9], [0]);
    const row = report.thresholds[0];

    expect(row?.pairwise.f1).toBe(0);
    expect(row?.referencePairwise.f1).toBe(1);
    expect(benchmarkReportTable(report)).toContain('sampleF1');
    expect(benchmarkReportTable(report)).toContain('referenceF1');
  });
});
