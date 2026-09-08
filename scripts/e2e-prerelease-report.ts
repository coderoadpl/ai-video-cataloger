import { z } from 'zod';

const annotationSchema = z.object({ type: z.string(), description: z.string().optional() });

const testSchema = z.object({
  projectName: z.string(),
  status: z.enum(['skipped', 'expected', 'unexpected', 'flaky']),
  annotations: z.array(annotationSchema).optional(),
  results: z.array(z.object({ status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']).optional(), annotations: z.array(annotationSchema).optional() })).optional(),
});

const specSchema = z.object({ title: z.string(), tests: z.array(testSchema) });

type SpecNode = z.infer<typeof specSchema>;
type TestNode = z.infer<typeof testSchema>;

type SuiteNode = {
  readonly specs: readonly SpecNode[];
  readonly suites?: readonly SuiteNode[] | undefined;
};

const suiteSchema: z.ZodType<SuiteNode> = z.lazy(() =>
  z.object({ specs: z.array(specSchema), suites: z.array(suiteSchema).optional() }),
);

const jsonReportSchema = z.object({ suites: z.array(suiteSchema) });

export type SkippedTest = {
  readonly title: string;
  readonly projectName: string;
  readonly reason: string;
};

export type LegReport = {
  readonly leg: string;
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skippedCount: number;
  readonly skipped: readonly SkippedTest[];
};

const ALLOWED_SKIPS: readonly Omit<SkippedTest, 'reason'>[] = [
  {
    projectName: 'gui',
    title: 'S5 pre-feature installation migrates, searches, resumes, and renames',
  },
  {
    projectName: 'gui',
    title: 'S6 two configurations share a transcript and switch selected search and artifacts',
  },
];

const flattenSpecs = (suites: readonly SuiteNode[]): readonly SpecNode[] =>
  suites.flatMap((suite) => [...suite.specs, ...flattenSpecs(suite.suites ?? [])]);

const skipReasonOf = (test: TestNode): string => {
  const annotations = [
    ...(test.annotations ?? []),
    ...(test.results ?? []).flatMap((result) => result.annotations ?? []),
  ];
  const skip = annotations.find(
    (annotation) => annotation.type === 'skip' && annotation.description !== undefined,
  );
  return skip?.description ?? 'no reason recorded';
};

export const parseLegReport = (leg: string, raw: unknown, expectedProjects: readonly string[] = []): LegReport => {
  const parsed = jsonReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Leg "${leg}" produced a file that is not a Playwright JSON report.`);
  }

  const tests = flattenSpecs(parsed.data.suites).flatMap((spec) =>
    spec.tests.map((test) => ({ spec, test })),
  );
  if (tests.length === 0) throw new Error(`Leg "${leg}" has no executed tests.`);
  for (const project of expectedProjects) {
    if (!tests.some(({ test }) => test.projectName === project && test.status !== 'skipped' && test.results?.some((result) => result.status !== undefined && result.status !== 'skipped') === true)) {
      throw new Error(`Leg "${leg}" has no executed tests for expected project "${project}".`);
    }
  }
  const skipped = tests
    .filter(({ test }) => test.status === 'skipped')
    .map(({ spec, test }) => ({
      title: spec.title,
      projectName: test.projectName,
      reason: skipReasonOf(test),
    }));

  return {
    leg,
    passed: tests.filter(({ test }) => test.status === 'expected').length,
    flaky: tests.filter(({ test }) => test.status === 'flaky').length,
    failed: tests.filter(({ test }) => test.status === 'unexpected').length,
    skippedCount: skipped.length,
    skipped,
  };
};

const isAllowedSkip = (skipped: SkippedTest): boolean =>
  ALLOWED_SKIPS.some(
    (allowed) => allowed.projectName === skipped.projectName && allowed.title === skipped.title,
  );

export const unexpectedSkips = (reports: readonly LegReport[]): readonly SkippedTest[] =>
  reports.flatMap((report) => report.skipped.filter((skipped) => !isAllowedSkip(skipped)));

export const formatUnexpectedSkipFailure = (skips: readonly SkippedTest[]): string =>
  [
    `${String(skips.length)} pre-release test(s) self-skipped instead of running:`,
    ...skips.map((skip) => `  - [${skip.projectName}] ${skip.title} — ${skip.reason}`),
  ].join('\n');

const HEADER: readonly string[] = ['leg', 'passed', 'failed', 'flaky', 'skipped'];

export const formatSummaryTable = (reports: readonly LegReport[]): string => {
  const rows: readonly (readonly string[])[] = [
    HEADER,
    ...reports.map((report) => [
      report.leg,
      String(report.passed),
      String(report.failed),
      String(report.flaky),
      String(report.skippedCount),
    ]),
  ];
  const widths = HEADER.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join(' | ')
        .trimEnd(),
    )
    .join('\n');
};
