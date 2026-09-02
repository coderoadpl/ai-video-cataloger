import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import initSqlJs from 'sql.js';
import { z } from 'zod';

import { appError, err, ok, type AppError, type Result } from '@core/domain/index.js';

import {
  benchmarkObservationSchema,
  benchmarkReportTable,
  buildFixtureCorpus,
  defaultThresholdSweep,
  labelledPairSchema,
  matchReferenceToNative,
  nativeObservationSchema,
  referencePartitionRecordSchema,
  runBenchmark,
  type BenchmarkReport,
  type LabelledPair,
  type NativeObservation,
  type ReferencePartitionRecord,
} from './faces-benchmark-core.js';

const cliOptionsSchema = z.object({
  reference: z.string().min(1).optional(),
  pairs: z.string().min(1).optional(),
  observations: z.string().min(1).optional(),
  catalog: z.string().min(1).optional(),
  corpus: z.string().min(1).optional(),
  thresholds: z.array(z.number()).optional(),
  densities: z.array(z.number()).optional(),
});

const sqlRowSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string(),
  z.instanceof(Uint8Array),
  z.number(),
]);

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const report = await runFromOptions(options);
  if (!report.ok) {
    process.stderr.write(`${report.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(report.value, null, 2)}\n\n${benchmarkReportTable(report.value)}\n`);
};

export const runFromOptions = async (input: z.input<typeof cliOptionsSchema>): Promise<Result<BenchmarkReport, AppError>> => {
  try {
    const options = cliOptionsSchema.safeParse(input);
    if (!options.success) return err(appError('validation', 'Benchmark options do not match the expected shape.', options.error.flatten()));
    const paths = resolveInputPaths(options.data);
    const reference = await readReferencePartition(paths.reference);
    const pairs = await readLabelledPairs(paths.pairs);
    const thresholds = options.data.thresholds ?? defaultThresholdSweep();
    const densities = options.data.densities;
    if (paths.catalog !== undefined) {
      const native = await readNativeObservations(paths.catalog);
      return ok(runBenchmark(matchReferenceToNative(reference, native, pairs), thresholds, densities));
    }
    const observations = paths.observations === undefined
      ? reference
      : await readBenchmarkObservations(paths.observations);
    const corpus = buildFixtureCorpus(mergeReferenceObservations(reference, observations), pairs);
    if (corpus.observations.length === 0 && reference.length > 0) {
      return err(appError('validation', 'Benchmark observations need embeddings from --observations or --catalog.'));
    }
    return ok(runBenchmark(corpus, thresholds, densities));
  } catch (error) {
    return err(appError('validation', error instanceof Error ? error.message : String(error)));
  }
};

const parseArgs = (args: readonly string[]): z.input<typeof cliOptionsSchema> => {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return {
    ...(values.reference === undefined && values['reference-partition'] === undefined ? {} : { reference: values.reference ?? values['reference-partition'] }),
    ...(values.pairs === undefined && values['labelled-pairs'] === undefined ? {} : { pairs: values.pairs ?? values['labelled-pairs'] }),
    ...(values.observations === undefined ? {} : { observations: values.observations }),
    ...(values.catalog === undefined ? {} : { catalog: values.catalog }),
    ...(values.corpus === undefined ? {} : { corpus: values.corpus }),
    ...(values.thresholds === undefined
      ? {}
      : { thresholds: values.thresholds.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)) }),
    ...(values.densities === undefined
      ? {}
      : { densities: values.densities.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)) }),
  };
};

const resolveInputPaths = (options: z.output<typeof cliOptionsSchema>): {
  reference: string;
  pairs: string;
  observations?: string | undefined;
  catalog?: string | undefined;
} => {
  const fixtureDir = fileURLToPath(new URL('__fixtures__/faces-benchmark/', import.meta.url));
  const corpus = options.corpus === undefined ? undefined : resolveCorpus(options.corpus);
  return {
    reference: options.reference ?? (corpus === undefined ? path.join(fixtureDir, 'reference.json') : path.join(corpus, 'reference.json')),
    pairs: options.pairs ?? (corpus === undefined ? path.join(fixtureDir, 'labelled-pairs.json') : path.join(corpus, 'labelled-pairs.json')),
    ...(options.observations === undefined && corpus === undefined ? { observations: path.join(fixtureDir, 'observations.json') } : {}),
    ...(options.observations === undefined ? {} : { observations: options.observations }),
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
  };
};

const resolveCorpus = (corpus: string): string => {
  if (path.isAbsolute(corpus)) return corpus;
  const scratch = process.env.AVC_SCRATCH_DIR;
  return scratch === undefined ? path.resolve(corpus) : path.resolve(scratch, corpus);
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

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
