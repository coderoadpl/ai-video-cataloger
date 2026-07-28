import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const guardPath = path.join(repoRoot, 'scripts/assert-node.mjs');
const temporaryDirectories: string[] = [];

const createNodeVersionDirectory = async (version: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avc-node-guard-'));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, '.nvmrc'), `${version}\n`);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Node gate guard', () => {
  it('rejects a mismatched Node version and accepts the running version', async () => {
    const actualVersion = process.version.replace(/^v/, '');
    const mismatchedDirectory = await createNodeVersionDirectory('0.0.0');
    const mismatch = spawnSync(process.execPath, [guardPath], {
      cwd: mismatchedDirectory,
      encoding: 'utf8',
    });

    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('expected 0.0.0');
    expect(mismatch.stderr).toContain(`running ${actualVersion}`);
    expect(mismatch.stderr).toContain('run: nvm use');

    const matchingDirectory = await createNodeVersionDirectory(actualVersion);
    const match = spawnSync(process.execPath, [guardPath], {
      cwd: matchingDirectory,
      encoding: 'utf8',
    });

    expect(match.status).toBe(0);
    expect(match.stdout).toBe('');
    expect(match.stderr).toBe('');
  });
});
