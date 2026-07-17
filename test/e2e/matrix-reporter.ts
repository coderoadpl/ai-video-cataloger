import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { formatMatrixSummary, type MatrixSummaryRow } from './matrix-support.js';

export default class MatrixReporter implements Reporter {
  private readonly rows: MatrixSummaryRow[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (test.parent.project()?.name !== 'matrix') return;
    this.rows.push({ cell: test.title, result: result.status, durationMs: result.duration });
  }

  onEnd(): void {
    if (this.rows.length > 0) console.log(`\n${formatMatrixSummary(this.rows)}`);
  }

  printsToStdio(): boolean {
    return true;
  }
}
