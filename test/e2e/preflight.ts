/**
 * Playwright globalSetup: HARD preflight checks.
 *
 * Policy: no silent skips. If a requirement for the selected samples/projects
 * is missing, the whole suite fails immediately with an actionable message -
 * a green run must mean the pipeline really worked, never "everything was
 * skipped". Claude auth is verified with a real one-line prompt, because a
 * present binary does not prove a valid login.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_DIST, REPO_ROOT } from './helpers.js';
import { selectedSamples } from './samples.js';

function fail(message: string): never {
  throw new Error(`\n\nE2E PREFLIGHT FAILED\n====================\n${message}\n`);
}

function has(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { timeout: 20_000, stdio: 'ignore' }).status === 0;
}

/** Real auth check: a minimal prompt must round-trip through claude. */
function verifyClaudeAuth(): void {
  if (!has('claude', ['--version'])) {
    fail('claude CLI is not installed (or not on PATH). Install Claude Code and log in.');
  }
  const ping = spawnSync('claude', ['-p', 'Reply with exactly: OK'], {
    timeout: 120_000,
    encoding: 'utf-8',
  });
  const output = `${ping.stdout ?? ''}${ping.stderr ?? ''}`;
  if (ping.status !== 0 || !/\bOK\b/.test(ping.stdout ?? '')) {
    fail(
      'claude CLI is installed but a test prompt FAILED - you are probably not ' +
      'logged in (or the session expired). Run "claude" and log in, then retry.\n' +
      `exit code: ${ping.status}\noutput (last 500 chars): ${output.slice(-500)}`
    );
  }
}

export default function preflight(): void {
  const samples = selectedSamples();
  const argv = process.argv.join(' ');
  const guiSelected = !/--project[= ]cli(\s|$)/.test(argv) || /--project[= ]gui/.test(argv);

  // 1. Builds present (never skip - a missing build must be loud)
  if (!existsSync(CLI_DIST)) {
    fail(`CLI build not found at ${CLI_DIST}.\nRun: npm run build (or set E2E_CLI_DIST).`);
  }
  if (guiSelected) {
    const mainEntry = join(REPO_ROOT, 'dist-electron', 'main', 'index.js');
    const rendererHtml = join(REPO_ROOT, 'electron', 'renderer', 'dist', 'index.html');
    if (!existsSync(mainEntry) || !existsSync(rendererHtml)) {
      fail(
        'Electron build not found (dist-electron/ and/or electron/renderer/dist/).\n' +
        'Run: npm run electron:build - or use the npm scripts which build first.'
      );
    }
  }

  // 2. Claude: installed AND authenticated (real round-trip)
  verifyClaudeAuth();

  // 3. Sample-specific tools - hard requirements, with an explicit escape hatch
  const needsWhisper = samples.some((sample) => sample.whisper === 'local');
  if (needsWhisper && !has('which', ['whisper'])) {
    fail(
      `Selected samples (${samples.filter((s) => s.whisper === 'local').map((s) => s.id).join(', ')}) ` +
      'require local whisper, which is not installed.\n' +
      'Install it (pip install openai-whisper) or explicitly narrow the run, ' +
      'e.g. E2E_SAMPLES=jellyfish (no silent skipping).'
    );
  }
  const needsSay = samples.some((sample) => sample.source.kind === 'synthetic');
  if (needsSay && (process.platform !== 'darwin' || !has('which', ['say']))) {
    fail(
      'The synthetic "speech" sample requires macOS `say` to generate its fixture.\n' +
      'Run on macOS or exclude it explicitly, e.g. E2E_SAMPLES=bbb,sintel,jellyfish.'
    );
  }

   
  console.log(
    `[preflight] OK - claude authenticated; samples: ${samples.map((s) => s.id).join(', ')}` +
    (guiSelected ? '; gui build present' : '; cli-only run')
  );
}
