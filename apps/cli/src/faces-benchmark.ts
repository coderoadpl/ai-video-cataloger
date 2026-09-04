import { readFile } from 'node:fs/promises';

import initSqlJs from 'sql.js';
import { z } from 'zod';

import {
  appError,
  benchmarkObservationSchema,
  buildFixtureCorpus,
  defaultThresholdSweep,
  err,
  labelledPairSchema,
  matchReferenceToNative,
  nativeObservationSchema,
  ok,
  referencePartitionRecordSchema,
  runBenchmark,
  type AppError,
  type BenchmarkReport,
  type LabelledPair,
  type NativeObservation,
  type ReferencePartitionRecord,
  type Result,
} from '@core/domain/index.js';

const benchmarkSourcesSchema = z.object({
  reference: z.string().min(1),
  pairs: z.string().min(1),
  observations: z.string().min(1).optional(),
  catalog: z.string().min(1).optional(),
  thresholds: z.array(z.number()).optional(),
  strongFractions: z.array(z.number()).optional(),
});

export type BenchmarkSources = z.input<typeof benchmarkSourcesSchema>;

const sqlRowSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string(),
  z.instanceof(Uint8Array),
  z.number(),
]);

export const runFromOptions = async (input: BenchmarkSources): Promise<Result<BenchmarkReport, AppError>> => {
  try {
    const options = benchmarkSourcesSchema.safeParse(input);
    if (!options.success) return err(appError('validation', 'Benchmark options do not match the expected shape.', options.error.flatten()));
    const sources = options.data;
    const reference = await readReferencePartition(sources.reference);
    const pairs = await readLabelledPairs(sources.pairs);
    const thresholds = sources.thresholds ?? defaultThresholdSweep();
    const strongFractions = sources.strongFractions;
    if (sources.catalog !== undefined) {
      const native = await readNativeObservations(sources.catalog);
      return ok(runBenchmark(matchReferenceToNative(reference, native, pairs), thresholds, strongFractions));
    }
    const observations = sources.observations === undefined
      ? reference
      : await readBenchmarkObservations(sources.observations);
    const corpus = buildFixtureCorpus(mergeReferenceObservations(reference, observations), pairs);
    if (corpus.observations.length === 0 && reference.length > 0) {
      return err(appError('validation', 'Benchmark observations need embeddings from --observations or --catalog.'));
    }
    return ok(runBenchmark(corpus, thresholds, strongFractions));
  } catch (error) {
    return err(appError('validation', error instanceof Error ? error.message : String(error)));
  }
};

const readJsonOrRows = async (filePath: string): Promise<unknown> => {
  const content = await readFile(filePath, 'utf8');
  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line) => line.split(',').map((part) => part.trim()));
};

const referenceMapSchema = z.record(z.string(), z.string());
const referenceCsvSchema = z.array(z.tuple([z.string().min(1), z.string().min(1)]));

const readReferencePartition = async (filePath: string): Promise<ReferencePartitionRecord[]> => {
  const raw = await readJsonOrRows(filePath);
  const arrayParsed = z.array(referencePartitionRecordSchema).safeParse(raw);
  if (arrayParsed.success) return arrayParsed.data;
  const mapParsed = referenceMapSchema.safeParse(raw);
  if (mapParsed.success) {
    return Object.entries(mapParsed.data).map(([observationId, clusterId]) => ({ observationId, clusterId }));
  }
  return referenceCsvSchema.parse(raw).map(([observationId, clusterId]) => ({ observationId, clusterId }));
};

const labelledPairsCsvSchema = z.array(z.tuple([z.string().min(1), z.string().min(1), z.enum(['same', 'different', 'unsure', 'not_face'])]));

const readLabelledPairs = async (filePath: string): Promise<LabelledPair[]> => {
  const raw = await readJsonOrRows(filePath);
  const arrayParsed = z.array(labelledPairSchema).safeParse(raw);
  if (arrayParsed.success) return arrayParsed.data;
  return labelledPairsCsvSchema.parse(raw).map(([left, right, verdict]) => ({ left, right, verdict }));
};

const readBenchmarkObservations = async (filePath: string): Promise<ReferencePartitionRecord[]> => {
  const raw = await readJsonOrRows(filePath);
  return z.array(benchmarkObservationSchema).parse(raw).map((observation) => ({
    observationId: observation.obsId,
    clusterId: observation.obsId,
    ...observation,
  }));
};

const mergeReferenceObservations = (
  reference: readonly ReferencePartitionRecord[],
  observations: readonly ReferencePartitionRecord[],
): ReferencePartitionRecord[] => {
  const observationsById = new Map(observations.map((observation) => [observation.obsId ?? observation.observationId, observation]));
  return reference.map((record) => ({ ...observationsById.get(record.observationId), ...record }));
};

const readNativeObservations = async (catalogPath: string): Promise<NativeObservation[]> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database(await readFile(catalogPath));
  const result = client.exec('SELECT obs_id, fingerprint, bbox_json, embedding, quality FROM face_observations WHERE media = \'photo\' ORDER BY obs_id');
  const rows = result[0]?.values ?? [];
  return rows.map((row) => nativeFromSqlRow(sqlRowSchema.parse(row)));
};

const nativeFromSqlRow = (row: z.output<typeof sqlRowSchema>): NativeObservation => {
  const [obsId, fingerprint, bboxJson, embeddingBlob, quality] = row;
  const bbox = nativeObservationSchema.shape.bbox.parse(JSON.parse(bboxJson));
  return nativeObservationSchema.parse({
    obsId,
    fingerprint,
    bbox,
    embedding: blobToEmbedding(embeddingBlob),
    quality,
  });
};

const blobToEmbedding = (value: Uint8Array): number[] => {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return [...new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))];
};
