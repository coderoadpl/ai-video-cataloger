import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DORMANCY_FLAGS = ['CI_RUNNER_READY', 'AI_REVIEW_READY'];

export const lintWorkflows = (workflowsDir, expectedSlug) => {
  const problems = [];

  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();

  for (const fileName of workflowFiles) {
    const content = readFileSync(path.join(workflowsDir, fileName), 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const guardMatch = line.match(/github\.repository\s*==\s*'([^']*)'/);
      if (guardMatch === null) return;
      const foundSlug = guardMatch[1];
      if (foundSlug !== expectedSlug) {
        problems.push(
          `[repo-guard] ${fileName}:${String(index + 1)} guards github.repository == '${foundSlug}', but this repository is '${expectedSlug}' — the job would silently skip on every event.`,
        );
      }
    });

    lines.forEach((line, index) => {
      for (const flag of DORMANCY_FLAGS) {
        if (!line.includes(`vars.${flag}`)) continue;
        problems.push(
          `[dormancy-flag] ${fileName}:${String(index + 1)} reads vars.${flag} — the dormancy gating was removed with the self-hosted runner; a gate now runs, or fails, on every event. See docs/ci.md.`,
        );
      }
    });

    const jobsLineIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (jobsLineIndex === -1) continue;

    const jobHeaders = [];
    for (let i = jobsLineIndex + 1; i < lines.length; i += 1) {
      const headerMatch = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (headerMatch !== null) jobHeaders.push({ id: headerMatch[1], line: i });
    }

    jobHeaders.forEach((header, headerIndex) => {
      const blockEnd = headerIndex + 1 < jobHeaders.length ? jobHeaders[headerIndex + 1].line : lines.length;
      const blockLines = lines.slice(header.line, blockEnd);

      const runsOnLine = blockLines.find((line) => /^ {4}runs-on:/.test(line));
      if (runsOnLine !== undefined && runsOnLine.includes('self-hosted')) {
        problems.push(
          `[hosted-runner] ${fileName} job "${header.id}" targets a self-hosted runner; this repository has none and registers none. See docs/decisions/0017-hosted-ci-runners.md.`,
        );
      }

      const nameLine = blockLines.find((line) => /^ {4}name:/.test(line));
      if (nameLine !== undefined && nameLine.includes('${{')) {
        problems.push(
          `[job-name] ${fileName} job "${header.id}" computes its name from an expression; a required status check is matched by the rendered name, so it must be a literal.`,
        );
      }
    });
  }

  return problems;
};

const repositorySlug = (packageJsonPath) => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const url = pkg.repository?.url;
  const match = typeof url === 'string' ? url.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/) : null;
  return match === null ? null : `${match[1]}/${match[2]}`;
};

const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isDirectlyExecuted) {
  const repoRoot = path.join(import.meta.dirname, '..');
  const expectedSlug = repositorySlug(path.join(repoRoot, 'package.json'));

  if (expectedSlug === null) {
    console.error(
      'workflow-lint: FAIL\npackage.json "repository.url" must be a github.com URL naming owner/repo; it is the single source of truth for the workflow guards.',
    );
    process.exit(1);
  }

  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  const problems = lintWorkflows(workflowsDir, expectedSlug);

  if (problems.length > 0) {
    console.error(`workflow-lint: FAIL\n${problems.join('\n')}`);
    process.exit(1);
  }

  const workflowCount = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).length;
  console.log(
    `workflow-lint: OK — ${String(workflowCount)} workflow file(s) on hosted runners, literal job names, guards naming ${expectedSlug}.`,
  );
}
