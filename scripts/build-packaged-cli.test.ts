import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const spawnNode = (args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const unexpectedStderr = (stderr: string): string =>
  stderr
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('[backup] Keychain disabled:'))
    .join('\n');

let stagedDir = '';
let home = '';
let folder = '';

const cliEnv = (): NodeJS.ProcessEnv => ({
  HOME: home,
  AVC_HOME_DIRECTORY: home,
  AVC_WORKING_DIRECTORY: folder,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
});

describe('packaged CLI bundle', () => {
  beforeAll(async () => {
    const build = await spawnNode([path.join(rootDir, 'scripts/build-packaged-cli.mjs')], {}, rootDir);
    expect(build.code, `package:stage failed.\n${build.stdout}\n${build.stderr}`).toBe(0);
    stagedDir = await realpath(await mkdtemp(path.join(tmpdir(), 'avc-packaged-cli-')));
    home = await realpath(await mkdtemp(path.join(tmpdir(), 'avc-packaged-cli-home-')));
    folder = await realpath(await mkdtemp(path.join(tmpdir(), 'avc-packaged-cli-folder-')));
    for (const asset of ['index.js', 'package.json', 'sql-wasm.wasm']) {
      await copyFile(path.join(rootDir, 'dist/cli', asset), path.join(stagedDir, asset));
    }
  }, 120_000);

  afterAll(async () => {
    for (const directory of [stagedDir, home, folder]) {
      if (directory.length > 0) await rm(directory, { recursive: true, force: true });
    }
  });

  const PREREQUISITES_FAILED = 15;

  it.each([
    // doctor legitimately exits prerequisites_failed on a runner without ffmpeg/whisper/claude
    // installed; either code proves the packaged CLI parsed and ran the command instead of falling
    // into the faces-benchmark entry guard.
    ['doctor', ['doctor', '--json'], [0, PREREQUISITES_FAILED]],
    ['search', ['search', 'x', '--json'], [0]],
    ['tags list', ['tags', 'list', '--json'], [0]],
    ['status', ['status', '--json'], [0]],
  ])('runs %s with an expected exit code and no unexpected stderr', async (_label, args, expectedCodes) => {
    const result = await spawnNode([path.join(stagedDir, 'index.js'), ...args], cliEnv(), folder);

    expect(unexpectedStderr(result.stderr)).toBe('');
    expect(expectedCodes).toContain(result.code);
  }, 60_000);
});
