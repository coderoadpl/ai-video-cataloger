import { describe, expect, it } from 'vitest';

import {
  formatSummaryTable,
  formatUnexpectedSkipFailure,
  parseLegReport,
  unexpectedSkips,
  type LegReport,
} from './e2e-prerelease-report.js';

const test = (
  title: string,
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped',
  options: { projectName?: string; annotation?: string; resultAnnotation?: string } = {},
): Record<string, unknown> => ({
  title,
  tests: [
    {
      projectName: options.projectName ?? 'gui',
      status,
      annotations: options.annotation === undefined ? [] : [{ type: 'skip', description: options.annotation }],
      results: [
        {
          annotations:
            options.resultAnnotation === undefined
              ? []
              : [{ type: 'skip', description: options.resultAnnotation }],
        },
      ],
    },
  ],
});

describe('parseLegReport', () => {
  it('counts passed, failed and skipped tests across nested suites', () => {
    const report = parseLegReport('people', {
      suites: [
        {
          title: 'people.spec.ts',
          specs: [test('a', 'expected'), test('b', 'unexpected')],
          suites: [
            {
              title: 'nested',
              specs: [test('c', 'flaky'), test('d', 'skipped', { annotation: 'no fixtures' })],
            },
          ],
        },
      ],
    });

    expect(report).toMatchObject({ leg: 'people', passed: 1, failed: 1, flaky: 1, skippedCount: 1 });
    expect(report.skipped).toEqual([
      { title: 'd', projectName: 'gui', reason: 'no fixtures' },
    ]);
  });

  it('reads the skip reason recorded on the run result when the test carries none', () => {
    const report = parseLegReport('people-pairs', {
      suites: [{ title: 's', specs: [test('x', 'skipped', { resultAnnotation: 'set the samples variable' })] }],
    });

    expect(report.skipped[0]?.reason).toBe('set the samples variable');
  });

  it('falls back to a placeholder reason when nothing was recorded', () => {
    const report = parseLegReport('map', {
      suites: [{ title: 's', specs: [test('y', 'skipped')] }],
    });

    expect(report.skipped[0]?.reason).toBe('no reason recorded');
  });

  it('rejects a report that is not a Playwright JSON report', () => {
    expect(() => parseLegReport('cli', { suites: 'nope' })).toThrow(/cli/);
  });
});

describe('unexpectedSkips', () => {
  const allowed = parseLegReport('gui', {
    suites: [
      {
        title: 'scenarios.spec.ts',
        specs: [
          test('S5 pre-feature installation migrates, searches, resumes, and renames', 'skipped', {
            annotation: 'CLI-only old-data compatibility scenario',
          }),
          test('S6 two configurations share a transcript and switch selected search and artifacts', 'skipped', {
            annotation: 'CLI-only variant scenario',
          }),
        ],
      },
    ],
  });

  it('accepts the CLI-only scenarios the gui project cannot run', () => {
    expect(unexpectedSkips([allowed])).toEqual([]);
  });

  it('refuses the same titles when another project skips them', () => {
    const other = parseLegReport('people', {
      suites: [
        {
          title: 'people.spec.ts',
          specs: [
            test('S5 pre-feature installation migrates, searches, resumes, and renames', 'skipped', {
              projectName: 'people',
              annotation: 'CLI-only old-data compatibility scenario',
            }),
          ],
        },
      ],
    });

    expect(unexpectedSkips([other])).toHaveLength(1);
  });

  it('reports a skipped real-fixture leg with its title and reason', () => {
    const people = parseLegReport('people', {
      suites: [
        {
          title: 'people.spec.ts',
          specs: [
            test('indexes real photos into people', 'skipped', {
              projectName: 'people',
              annotation: 'Set E2E_FACES_SAMPLE_PHOTOS to a folder of real photos',
            }),
          ],
        },
      ],
    });

    const skips = unexpectedSkips([allowed, people]);
    const message = formatUnexpectedSkipFailure(skips);

    expect(message).toContain('indexes real photos into people');
    expect(message).toContain('Set E2E_FACES_SAMPLE_PHOTOS to a folder of real photos');
    expect(message).not.toContain('CLI-only');
  });
});

describe('formatSummaryTable', () => {
  it('prints one row per leg with its counts', () => {
    const reports: readonly LegReport[] = [
      { leg: 'cli', passed: 6, failed: 0, flaky: 0, skippedCount: 2, skipped: [] },
      { leg: 'map', passed: 1, failed: 0, flaky: 0, skippedCount: 0, skipped: [] },
    ];

    const table = formatSummaryTable(reports);

    expect(table).toMatch(/leg\s+\|\s+passed\s+\|\s+failed\s+\|\s+flaky\s+\|\s+skipped/);
    expect(table).toMatch(/cli\s+\|\s+6\s+\|\s+0\s+\|\s+0\s+\|\s+2/);
    expect(table).toMatch(/map\s+\|\s+1\s+\|\s+0\s+\|\s+0\s+\|\s+0/);
  });
});

it('rejects reports without test records', () => {
  expect(() => parseLegReport('cli', { suites: [] })).toThrow(/executed tests/);
});
