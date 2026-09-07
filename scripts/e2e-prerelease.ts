import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  formatSummaryTable,
  formatUnexpectedSkipFailure,
  parseLegReport,
  unexpectedSkips,
  type LegReport,
} from './e2e-prerelease-report.js';

const LEGS: readonly string[] = [
  'cli',
  'gui',
  'parity',
  'open-folder',
  'settings',
  'backup',
  'photos',
  'people',
  'people-media',
  'people-pairs',
  'library',
  'library-hide-trash',
  'map',
];

const reportDirectory = path.join(process.cwd(), 'test-results', 'prerelease');

const runLeg = (leg: string, reportFile: string): number => {
  const result = spawnSync('pnpm', ['run', `test:e2e:${leg}`], {
    stdio: 'inherit',
    env: { ...process.env, AVC_E2E_JSON_REPORT: reportFile },
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
};

const readLegReport = (
  leg: string,
  reportFile: string,
  required: boolean,
): LegReport | undefined => {
  try {
    return parseLegReport(leg, JSON.parse(readFileSync(reportFile, 'utf8')));
  } catch (error) {
    if (!required) return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Leg "${leg}" left no readable JSON report at ${reportFile}: ${detail}`);
  }
};

const main = (): void => {
  rmSync(reportDirectory, { recursive: true, force: true });
  mkdirSync(reportDirectory, { recursive: true });

  const reports: LegReport[] = [];
  let firstRedLeg: { leg: string; status: number } | undefined;

  for (const leg of LEGS) {
    const reportFile = path.join(reportDirectory, `${leg}.json`);
    const status = runLeg(leg, reportFile);
    // Playwright wipes test-results/ when it starts, so a leg's report has to be
    // read before the next leg runs.
    const report = readLegReport(leg, reportFile, status === 0);
    if (report !== undefined) reports.push(report);
    if (status !== 0) {
      firstRedLeg = { leg, status };
      break;
    }
  }

  process.stdout.write(`\n${formatSummaryTable(reports)}\n`);

  if (firstRedLeg !== undefined) {
    process.stderr.write(`\nLeg "${firstRedLeg.leg}" failed — stopping the pre-release suite.\n`);
    process.exit(firstRedLeg.status);
  }

  const skips = unexpectedSkips(reports);
  if (skips.length > 0) {
    process.stderr.write(`\n${formatUnexpectedSkipFailure(skips)}\n`);
    process.exit(1);
  }
};

main();
