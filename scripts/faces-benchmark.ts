import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { benchmarkReportTable } from '@core/domain/index.js';

import { runFromOptions, type BenchmarkSources } from '../apps/cli/src/faces-benchmark.js';

interface ParsedArgs {
  reference?: string;
  pairs?: string;
  observations?: string;
  catalog?: string;
  corpus?: string;
  thresholds?: number[];
  strongFractions?: number[];
}

const main = async (): Promise<void> => {
  const report = await runFromOptions(resolveSources(parseArgs(process.argv.slice(2))));
  if (!report.ok) {
    process.stderr.write(`${report.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(report.value, null, 2)}\n\n${benchmarkReportTable(report.value)}\n`);
};

const numberList = (value: string): number[] =>
  value.split(',').map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));

const parseArgs = (args: readonly string[]): ParsedArgs => {
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
  const reference = values.reference ?? values['reference-partition'];
  const pairs = values.pairs ?? values['labelled-pairs'];
  return {
    ...(reference === undefined ? {} : { reference }),
    ...(pairs === undefined ? {} : { pairs }),
    ...(values.observations === undefined ? {} : { observations: values.observations }),
    ...(values.catalog === undefined ? {} : { catalog: values.catalog }),
    ...(values.corpus === undefined ? {} : { corpus: values.corpus }),
    ...(values.thresholds === undefined ? {} : { thresholds: numberList(values.thresholds) }),
    ...(values['strong-fractions'] === undefined ? {} : { strongFractions: numberList(values['strong-fractions']) }),
  };
};

const resolveSources = (options: ParsedArgs): BenchmarkSources => {
  const fixtureDir = fileURLToPath(new URL('../core/domain/__fixtures__/faces-benchmark/', import.meta.url));
  const corpus = options.corpus === undefined ? undefined : resolveCorpus(options.corpus);
  return {
    reference: options.reference ?? path.join(corpus ?? fixtureDir, 'reference.json'),
    pairs: options.pairs ?? path.join(corpus ?? fixtureDir, 'labelled-pairs.json'),
    ...(options.observations === undefined && corpus === undefined ? { observations: path.join(fixtureDir, 'observations.json') } : {}),
    ...(options.observations === undefined ? {} : { observations: options.observations }),
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    ...(options.thresholds === undefined ? {} : { thresholds: options.thresholds }),
    ...(options.strongFractions === undefined ? {} : { strongFractions: options.strongFractions }),
  };
};

const resolveCorpus = (corpus: string): string => {
  if (path.isAbsolute(corpus)) return corpus;
  const scratch = process.env.AVC_SCRATCH_DIR;
  return scratch === undefined ? path.resolve(corpus) : path.resolve(scratch, corpus);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
