import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { E2E_ANALYZER, E2E_LOCAL_MODEL } from './analyzer-mode.js';
import { CLI_DIST, ELECTRON_MAIN, RENDERER_HTML } from './helpers.js';
import { selectedSamples } from './samples.js';

const runtimeStateSchema = z.object({ port: z.number().int().positive() });
const tagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string() })).optional(),
});

function fail(message: string): never {
  throw new Error(`\n\nE2E PREFLIGHT FAILED\n====================\n${message}\n`);
}

function has(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { timeout: 20_000, stdio: 'ignore' }).status === 0;
}

function verifyClaudeAuth(): void {
  if (!has('claude', ['--version'])) {
    fail('claude CLI is not installed or not on PATH. Install Claude Code and log in.');
  }
  const ping = spawnSync('claude', ['-p', 'Reply with exactly: OK'], {
    timeout: 120_000,
    encoding: 'utf-8',
  });
  const output = `${ping.stdout ?? ''}${ping.stderr ?? ''}`;
  if (ping.status !== 0 || !/\bOK\b/.test(ping.stdout ?? '')) {
    fail(
      'claude CLI is installed but a test prompt failed. Run "claude" and log in, then retry.\n' +
        `exit code: ${String(ping.status)}\noutput: ${output.slice(-500)}`,
    );
  }
}

async function reachableRuntimeBaseUrl(): Promise<string | null> {
  const probe = async (baseUrl: string): Promise<boolean> => {
    try {
      const response = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await probe('http://127.0.0.1:11434')) return 'http://127.0.0.1:11434';
  try {
    const parsed = runtimeStateSchema.safeParse(
      JSON.parse(readFileSync(join(homedir(), '.ai-video-cataloger', 'ollama-runtime.json'), 'utf8')),
    );
    if (!parsed.success) return null;
    const managed = `http://127.0.0.1:${String(parsed.data.port)}`;
    if (await probe(managed)) return managed;
  } catch {
    return null;
  }
  return null;
}

async function verifyLocalAnalyzer(model: string): Promise<void> {
  const baseUrl = await reachableRuntimeBaseUrl();
  if (baseUrl === null) {
    fail(
      'E2E_ANALYZER=local but no Ollama runtime is reachable.\n' +
        `Start it and install the model: node ${CLI_DIST} models pull ${model}`,
    );
  }
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
  const parsed = tagsResponseSchema.safeParse(await response.json());
  if (!parsed.success) fail(`E2E_ANALYZER=local but ${baseUrl}/api/tags returned an unexpected shape.`);
  const installed = (parsed.data.models ?? []).some((entry) => entry.name === model || entry.name === `${model}:latest`);
  if (!installed) {
    fail(`E2E_ANALYZER=local but model "${model}" is not installed on ${baseUrl}.\nInstall it: node ${CLI_DIST} models pull ${model}`);
  }
}

export default async function preflight(): Promise<void> {
  const samples = selectedSamples();
  const argv = process.argv.join(' ');
  const guiSelected = !/--project[= ]cli(\s|$)/.test(argv) || /--project[= ]gui/.test(argv);

  if (!existsSync(CLI_DIST)) {
    fail(`CLI build not found at ${CLI_DIST}.\nRun: npm run package:stage or set E2E_CLI_DIST.`);
  }
  if (guiSelected && (!existsSync(ELECTRON_MAIN) || !existsSync(RENDERER_HTML))) {
    fail(
      `Electron build not found.\nmain: ${ELECTRON_MAIN}\nrenderer: ${RENDERER_HTML}\n` +
        'Run: npm run electron:build or set E2E_ELECTRON_MAIN/E2E_RENDERER_HTML.',
    );
  }

  if (E2E_ANALYZER === 'claude') verifyClaudeAuth();

  const needsWhisper = samples.some((sample) => sample.whisper === 'local');
  if (needsWhisper && !has('which', ['whisper'])) {
    fail(
      `Selected samples (${samples.filter((sample) => sample.whisper === 'local').map((sample) => sample.id).join(', ')}) ` +
        'require local whisper. Install it or set E2E_SAMPLES to samples that use whisper=skip.',
    );
  }

  const needsSay = samples.some((sample) => sample.source.kind === 'synthetic');
  if (needsSay && (process.platform !== 'darwin' || !has('which', ['say']))) {
    fail('The synthetic speech sample requires macOS `say`. Run on macOS or exclude it with E2E_SAMPLES.');
  }

  if (E2E_ANALYZER === 'local') await verifyLocalAnalyzer(E2E_LOCAL_MODEL);

  console.log(
    `[preflight] OK analyzer=${E2E_ANALYZER}; samples=${samples.map((sample) => sample.id).join(',')}` +
      (guiSelected ? '; gui build present' : '; cli-only run'),
  );
}
