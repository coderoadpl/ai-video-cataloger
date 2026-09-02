import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  benchmarkObservationSchema,
  benchmarkReportTable,
  buildFixtureCorpus,
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
    expect(benchmarkReportTable(report)).toContain('threshold precision recall f1');
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

  it('matches external reference ids to native photo observations by fingerprint and bbox IoU', () => {
    const reference: ReferencePartitionRecord[] = [
      {
        observationId: 'external-a',
        clusterId: 'identity-a',
        sourceContentHash: 'abc123',
        bbox: { x: 10, y: 10, width: 50, height: 50 },
      },
      {
        observationId: 'external-missing',
        clusterId: 'identity-b',
        sourceContentHash: 'abc123',
        bbox: { x: 200, y: 200, width: 50, height: 50 },
      },
    ];
    const native: NativeObservation[] = [
      {
        obsId: 'ph_abc123:face:1:1',
        fingerprint: 'ph_abc123',
        bbox: { x: 12, y: 12, width: 50, height: 50 },
        embedding: [1, 0],
        quality: 1,
      },
      {
        obsId: 'ph_abc123:face:1:2',
        fingerprint: 'ph_abc123',
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        embedding: [0, 1],
        quality: 1,
      },
    ];

    const corpus = matchReferenceToNative(reference, native, [
      { left: 'external-a', right: 'external-missing', verdict: 'different' },
    ]);

    expect(corpus.observations.map((observation) => observation.obsId)).toEqual(['ph_abc123:face:1:1']);
    expect(corpus.partition.get('ph_abc123:face:1:1')).toBe('identity-a');
    expect(corpus.pairs[0]).toEqual({ left: 'ph_abc123:face:1:1', right: 'external-missing', verdict: 'different' });
    expect(corpus.unmatchedReference).toBe(1);
    expect(corpus.unmatchedNative).toBe(1);
  });
});
