import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lintWorkflows } from './workflow-lint.mjs';

const SLUG = 'owner/repo';

const workflowsDirWith = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'avc-workflow-lint-'));
  const workflowsDir = path.join(dir, '.github', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(workflowsDir, name), content, 'utf8');
  }
  return workflowsDir;
};

const lint = (files) => lintWorkflows(workflowsDirWith(files), SLUG);

const cleanWorkflow = `name: check

jobs:
  check:
    name: check
    if: github.repository == 'owner/repo'
    runs-on: macos-15
    steps:
      - run: pnpm run check
`;

describe('lintWorkflows', () => {
  it('accepts a hosted workflow with a literal job name and a matching repo guard', () => {
    expect(lint({ 'check.yml': cleanWorkflow })).toEqual([]);
  });

  it('rejects a guard naming another repository', () => {
    const problems = lint({
      'check.yml': cleanWorkflow.replace("'owner/repo'", "'someone/else'"),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[repo-guard]');
  });

  it('rejects a self-hosted runner label', () => {
    const problems = lint({
      'check.yml': cleanWorkflow.replace('runs-on: macos-15', 'runs-on: [self-hosted, macOS, arm64]'),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[hosted-runner]');
  });

  it('rejects a revived dormancy variable', () => {
    const problems = lint({
      'check.yml': cleanWorkflow.replace(
        "if: github.repository == 'owner/repo'",
        "if: vars.CI_RUNNER_READY == 'true'",
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[dormancy-flag]');
  });

  it('rejects the AI review dormancy variable too', () => {
    const problems = lint({
      'ai-review.yml': cleanWorkflow.replace(
        "if: github.repository == 'owner/repo'",
        "if: vars.AI_REVIEW_READY == 'true'",
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[dormancy-flag]');
  });

  it('rejects a job name computed from an expression', () => {
    const problems = lint({
      'check.yml': cleanWorkflow.replace(
        'name: check\n    if:',
        'name: "${{ github.event_name }}"\n    if:',
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[job-name]');
  });

  it('ignores files that are not workflow definitions', () => {
    expect(lint({ 'notes.txt': 'runs-on: [self-hosted]' })).toEqual([]);
  });
});
