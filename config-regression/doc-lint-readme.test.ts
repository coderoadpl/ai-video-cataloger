import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { documentedScripts, readmeScriptProblems } from '../scripts/doc-lint-readme.js';

const repoRoot = join(import.meta.dirname, '..');

const manifest: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const rootScripts = new Set(Object.keys(manifest.scripts));

const FIXTURE_README = [
  '# Fixture app',
  '',
  '## Quick start',
  '',
  '```bash',
  'pnpm install',
  'pnpm run check',
  'pnpm run ship-it-please',
  '```',
  '',
].join('\n');

describe('doc-lint rejects a README documenting a script that does not exist', () => {
  it('names the file and the missing script', () => {
    const problems = readmeScriptProblems('fixture/README.md', FIXTURE_README, rootScripts);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('[readme->scripts]');
    expect(problems[0]).toContain('fixture/README.md');
    expect(problems[0]).toContain('pnpm run ship-it-please');
  });

  it('reads the script name out of prose, flags and argument passthrough alike', () => {
    expect(documentedScripts('run `pnpm run visual --update-snapshots` then `pnpm run cli -- doctor`')).toEqual([
      'visual',
      'cli',
    ]);
  });

  it('passes a README whose commands all exist', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

    expect(readmeScriptProblems('README.md', readme, rootScripts)).toEqual([]);
  });
});

describe('the README probe is wired into the doc-lint gate', () => {
  it('reports the README check in a green doc-lint run', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/doc-lint.ts'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('README(s) documenting only real package scripts');
  });
});
