import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const lintScript = join(repoRoot, 'scripts', 'privacy-lint.mjs');
const tempDirectories: string[] = [];

const fixtureRepo = (content: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'avc-privacy-lint-'));
  tempDirectories.push(root);
  spawnSync('git', ['init', '--quiet'], { cwd: root });
  writeFileSync(join(root, 'fixture.txt'), content, 'utf8');
  spawnSync('git', ['add', 'fixture.txt'], { cwd: root });
  return root;
};

const runLint = (root: string) => spawnSync(process.execPath, [lintScript, root], {
  cwd: root,
  encoding: 'utf8',
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('privacy-lint', () => {
  it('rejects a tracked file containing an absolute home path', () => {
    const privatePath = ['', 'Users', 'someone', 'repositories', 'project'].join('/');
    const run = runLint(fixtureRepo(`source=${privatePath}\n`));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fixture.txt:1 [home-path]');
  });

  it('accepts a clean tracked file', () => {
    const run = runLint(fixtureRepo('source=a scratch directory outside the repository\n'));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('privacy-lint: OK');
  });

  it('does not echo a private denylist match', () => {
    const denied = ['sensitive', 'token'].join('-');
    const root = fixtureRepo(`value=${denied}\n`);
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'privacy-denylist.local'), `${denied}\n`, 'utf8');

    const run = runLint(root);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fixture.txt:1 [denylist]');
    expect(run.stderr).not.toContain(denied);
  });
});
