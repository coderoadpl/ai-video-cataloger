import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const expectedProjects = (leg: string): readonly string[] =>
  leg === 'parity' ? ['cli', 'gui'] : [leg === 'backup' ? 'backup-settings' : leg];

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
    return parseLegReport(leg, JSON.parse(readFileSync(reportFile, 'utf8')), expectedProjects(leg));
  } catch (error) {
    if (!required) return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Leg "${leg}" left no readable JSON report at ${reportFile}: ${detail}`);
  }
};

export const runPrerelease = (root = process.cwd(), executeLeg = runLeg): number => {
  const reportsRoot = path.join(realpathSync(root), '.e2e-prerelease');
  mkdirSync(reportsRoot, { recursive: true });
  const lock = path.join(reportsRoot, 'lock');
  try {
    mkdirSync(lock);
  } catch {
    throw new Error('Prerelease is already running in this checkout. After confirming it has stopped, remove .e2e-prerelease/lock if left by an interrupted run.');
  }
  try {
    const reportDirectory = mkdtempSync(path.join(reportsRoot, 'run-'));

    const reports: LegReport[] = [];
    let firstRedLeg: { leg: string; status: number } | undefined;

    for (const leg of LEGS) {
      const reportFile = path.join(reportDirectory, `${leg}.json`);
      const status = executeLeg(leg, reportFile);
      const report = readLegReport(leg, reportFile, status === 0);
      if (report !== undefined) reports.push(report);
      if (status !== 0 || (report !== undefined && (report.failed > 0 || report.flaky > 0))) {
        firstRedLeg = { leg, status: status || 1 };
        break;
      }
    }

    process.stdout.write(`\n${formatSummaryTable(reports)}\n`);

    if (firstRedLeg !== undefined) {
      process.stderr.write(`\nLeg "${firstRedLeg.leg}" failed — stopping the pre-release suite.\n`);
      return firstRedLeg.status;
    }

    const skips = unexpectedSkips(reports);
    if (skips.length > 0) {
      process.stderr.write(`\n${formatUnexpectedSkipFailure(skips)}\n`);
      return 1;
    }
    return 0;
  } finally {
    rmSync(lock, { recursive: true });
  }
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPrerelease();
}
