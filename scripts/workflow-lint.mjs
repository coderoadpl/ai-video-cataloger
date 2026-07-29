import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(import.meta.dirname, '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');

const jobLevelIfLine = /^ {4}if:/;

const extractIfClauseText = (blockLines) => {
  const ifIndex = blockLines.findIndex((line) => jobLevelIfLine.test(line));
  if (ifIndex === -1) return '';
  const ifIndent = blockLines[ifIndex].match(/^(\s*)/)[1].length;
  let end = blockLines.length;
  for (let i = ifIndex + 1; i < blockLines.length; i += 1) {
    if (blockLines[i].trim() === '') continue;
    const indent = blockLines[i].match(/^(\s*)/)[1].length;
    if (indent <= ifIndent) {
      end = i;
      break;
    }
  }
  return blockLines.slice(ifIndex, end).join('\n');
};

const problems = [];

const fail = (message) => {
  console.error(`workflow-lint: FAIL\n${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const repositoryUrl = pkg.repository?.url;
const slugMatch = typeof repositoryUrl === 'string' ? repositoryUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/) : null;

if (slugMatch === null) {
  fail(
    'package.json "repository.url" must be a github.com URL naming owner/repo; it is the single source of truth for the workflow guards.',
  );
}

const expectedSlug = `${slugMatch[1]}/${slugMatch[2]}`;

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

let guardCount = 0;
let selfHostedArmedCount = 0;

for (const fileName of workflowFiles) {
  const filePath = path.join(workflowsDir, fileName);
  const relativePath = path.relative(repoRoot, filePath);
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const guardMatch = line.match(/github\.repository\s*==\s*'([^']*)'/);
    if (guardMatch === null) return;
    guardCount += 1;
    const foundSlug = guardMatch[1];
    if (foundSlug !== expectedSlug) {
      problems.push(
        `[repo-guard] ${relativePath}:${index + 1} guards github.repository == '${foundSlug}', but this repository is '${expectedSlug}' — the job would silently skip on every event.`,
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
    const blockText = blockLines.join('\n');
    const ifClauseText = extractIfClauseText(blockLines);

    const usesSelfHosted = blockText.includes('self-hosted');
    const armedForRunner = ifClauseText.includes("vars.CI_RUNNER_READY == 'true'");
    if (usesSelfHosted) {
      if (armedForRunner) {
        selfHostedArmedCount += 1;
      } else {
        problems.push(
          `[runner-gate] ${relativePath} job "${header.id}" runs on a self-hosted runner without vars.CI_RUNNER_READY == 'true' in its if: — with no runner registered it would sit queued for 24h on every PR. See docs/ci.md.`,
        );
      }
    }

    const usesTokenSecret = blockText.includes('secrets.CLAUDE_CODE_OAUTH_TOKEN');
    const armedForSecret = ifClauseText.includes("vars.AI_REVIEW_READY == 'true'");
    if (usesTokenSecret && !armedForSecret) {
      problems.push(
        `[secret-gate] ${relativePath} job "${header.id}" consumes a CLAUDE_CODE_OAUTH_TOKEN slot without vars.AI_REVIEW_READY == 'true' in its if: — the fail-closed gate would mark every PR RED while the secret is absent. See docs/ci.md.`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(
  `workflow-lint: OK — ${workflowFiles.length} workflow file(s), ${guardCount} guard(s) naming ${expectedSlug}, ${selfHostedArmedCount} self-hosted job(s) armed by CI_RUNNER_READY.`,
);
