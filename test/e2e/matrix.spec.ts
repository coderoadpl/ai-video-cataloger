import { _electron as electron, expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';

import { managedWhisperBinaryPath } from '../../adapters/whisper-runtime/index.js';
import {
  ELECTRON_MAIN,
  RENDERER_HTML,
  REPO_ROOT,
  addSampleTo,
  findKeyword,
  listVideos,
  makeEmptyWorkdir,
  readCatalog,
  runCli,
  type CliResult,
} from './helpers.js';
import { matrixAllowsSkip, matrixHome, missingLegMessage } from './matrix-support.js';
import { SAMPLES, type VideoSample } from './samples.js';

const MATRIX_MODEL = 'gemma3:4b';
const WHISPER_MODEL = 'base';
const CELL_TIMEOUT_MS = 7_200_000;
const PIPELINE_TIMEOUT_MS = 1_200_000;
const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;
const ollamaTagsSchema = z.object({
  models: z.array(z.object({
    name: z.string().optional(),
    model: z.string().optional(),
  })),
});

test.describe.configure({ mode: 'serial' });

const cacheHome = matrixHome(process.env);

const CLI_AUTH_DIRS = ['.claude', '.claude.json', '.codex', '.cursor'] as const;

const linkCliAuthIntoCacheHome = (): void => {
  const realHome = process.env.MATRIX_REAL_HOME ?? process.env.HOME;
  if (realHome === undefined || realHome === cacheHome) return;
  mkdirSync(cacheHome, { recursive: true });
  for (const entry of CLI_AUTH_DIRS) {
    const source = join(realHome, entry);
    const target = join(cacheHome, entry);
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target);
  }
};

linkCliAuthIntoCacheHome();

const sampleById = (id: string): VideoSample => {
  const sample = SAMPLES.find((candidate) => candidate.id === id);
  if (sample === undefined) throw new Error(`Missing sample: ${id}`);
  return sample;
};

const cellEnvironment = (home: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ...overrides,
  HOME: home,
  USERPROFILE: home,
});

const unavailableManagedOllamaEnvironment = (home = cacheHome): NodeJS.ProcessEnv =>
  cellEnvironment(home, { OLLAMA_HOST: 'http://127.0.0.1:1' });

const failOrSkip = (cell: string, reason: string): never => {
  const message = missingLegMessage(cell, reason);
  if (matrixAllowsSkip(process.env.E2E_MATRIX_ALLOW_SKIP)) test.skip(true, message);
  throw new Error(message);
};

const requireAppleSilicon = (cell: string): void => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    failOrSkip(cell, `managed local AI requires darwin/arm64; found ${process.platform}/${process.arch}`);
  }
};

const requireCommandAuthentication = (
  cell: string,
  command: string,
  authenticationArgs: readonly string[],
  environment: NodeJS.ProcessEnv,
): void => {
  const result = spawnSync(command, authenticationArgs, {
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error !== undefined) failOrSkip(cell, `${command} is not installed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`.trim();
    failOrSkip(cell, `${command} is not authenticated${detail.length === 0 ? '' : `: ${detail}`}`);
  }
};

const requireSystemOllamaModel = async (cell: string, baseUrl: string, model: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    failOrSkip(cell, `Ollama ${baseUrl} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) failOrSkip(cell, `Ollama ${baseUrl} returned HTTP ${String(response.status)}`);
  const tags = ollamaTagsSchema.parse(await response.json());
  const installed = tags.models.some((entry) => entry.name === model || entry.model === model);
  if (!installed) failOrSkip(cell, `Ollama ${baseUrl} does not have ${model} installed`);
};

const setup = async (
  cell: string,
  workdir: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): Promise<CliResult> => {
  mkdirSync(cacheHome, { recursive: true });
  const result = await runCli(['setup', ...args, '--yes', '--json'], workdir, CELL_TIMEOUT_MS, environment);
  const errors = result.events.filter((event) => event.type === 'error');
  expect(result.code, `${cell} setup stderr: ${result.stderr}`).toBe(0);
  expect(errors, `${cell} setup errors: ${result.stdout}`).toEqual([]);
  expect(result.events.some((event) => event.type === 'completed'), result.stdout).toBe(true);
  return result;
};

const assertPipeline = async (
  cell: string,
  workdir: string,
  sample: VideoSample,
  environment: NodeJS.ProcessEnv,
  transcriptExpected: boolean,
): Promise<void> => {
  await addSampleTo(workdir, sample);
  const result = await runCli(
    ['process', join(workdir, sample.file), '--frames', '1', '--timeout', '900', '--json'],
    workdir,
    PIPELINE_TIMEOUT_MS,
    environment,
  );
  const errors = result.events
    .filter((event) => event.type === 'error')
    .map((event) => event.error ?? event.message ?? event.code ?? 'unknown error');
  expect(result.code, `${cell}: ${errors.join(' | ')}\n${result.stderr}`).toBe(0);
  expect(result.events[0]?.type).toBe('started');
  expect(result.events.some((event) => event.type === 'progress')).toBe(true);
  expect(result.events.some((event) => event.type === 'completed')).toBe(true);

  const videos = listVideos(workdir);
  expect(videos).toHaveLength(1);
  const renamed = videos[0];
  expect(renamed).toMatch(RENAMED_PATTERN);
  expect(renamed).not.toBe(sample.file);
  expect(extname(renamed ?? '')).toBe(extname(sample.file));

  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    original_name: sample.file,
    new_name: renamed,
    status: 'completed',
  });

  const base = basename(renamed ?? '', extname(renamed ?? ''));
  const summaryPath = join(workdir, 'summaries', `${base}.txt`);
  expect(existsSync(summaryPath)).toBe(true);
  const summary = readFileSync(summaryPath, 'utf8').trim();
  expect(summary.length).toBeGreaterThan(20);
  expect(findKeyword(`${renamed ?? ''}\n${summary}`, sample.contentKeywords)).toBeTruthy();

  const frames = readdirSync(join(workdir, 'frames', base)).filter((name) => name.endsWith('.jpg'));
  expect(frames.length).toBeGreaterThan(0);
  if (transcriptExpected) {
    const transcriptPath = join(workdir, 'transcripts', `${base}.txt`);
    expect(existsSync(transcriptPath)).toBe(true);
    const transcript = readFileSync(transcriptPath, 'utf8');
    expect(findKeyword(transcript, sample.transcriptKeywords ?? [])).toBeTruthy();
  }
};

const runCliCell = async (
  cell: string,
  sample: VideoSample,
  environment: NodeJS.ProcessEnv,
  setupArgs: readonly string[],
  transcriptExpected = false,
): Promise<void> => {
  const workdir = makeEmptyWorkdir(cell);
  try {
    await setup(cell, workdir, environment, setupArgs);
    await assertPipeline(cell, workdir, sample, environment, transcriptExpected);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
};

test('local-managed × managed-whisper', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'local-managed × managed-whisper';
  requireAppleSilicon(cell);
  const environment = unavailableManagedOllamaEnvironment();
  mkdirSync(cacheHome, { recursive: true });

  const missingModelWorkdir = makeEmptyWorkdir('matrix-managed-missing-model');
  const missingModel = `matrix-missing-${String(Date.now())}:latest`;
  try {
    await addSampleTo(missingModelWorkdir, sampleById('bbb'));
    const provider = JSON.stringify({ family: 'local', providerId: 'local', modelTag: missingModel });
    for (const [key, value] of [
      ['analyzer_provider', provider],
      ['analyzer_backend', 'local'],
      ['local_model', missingModel],
      ['whisper_mode', 'skip'],
    ]) {
      const configured = await runCli(['config', 'set', key ?? '', value ?? '', '--json'], missingModelWorkdir, 60_000, environment);
      expect(configured.code, configured.stderr).toBe(0);
    }
    const probe = await runCli(
      ['process', join(missingModelWorkdir, 'BigBuckBunny480p30s.mp4'), '--whisper', 'skip', '--json'],
      missingModelWorkdir,
      PIPELINE_TIMEOUT_MS,
      environment,
    );
    expect(probe.events.some((event) => event.type === 'error' && event.code === 'MODEL_NOT_INSTALLED')).toBe(true);
    expect(probe.events.some((event) => event.code === 'OLLAMA_UNAVAILABLE')).toBe(false);
  } finally {
    rmSync(missingModelWorkdir, { recursive: true, force: true });
  }

  if (!existsSync(managedWhisperBinaryPath(cacheHome))) {
    const installed = await runCli(['models', 'whisper-runtime', 'install', '--json'], cacheHome, PIPELINE_TIMEOUT_MS, environment);
    expect(installed.code, installed.stderr).toBe(0);
  }
  expect(existsSync(managedWhisperBinaryPath(cacheHome))).toBe(true);

  await runCliCell(
    cell,
    sampleById('speech'),
    environment,
    ['--analyzer', 'local', '--local-model', MATRIX_MODEL, '--transcription', 'managed', '--whisper-model', WHISPER_MODEL],
    true,
  );
});

test('local-system × skip', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'local-system × skip';
  const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  await requireSystemOllamaModel(cell, baseUrl, MATRIX_MODEL);
  await runCliCell(
    cell,
    sampleById('bbb'),
    cellEnvironment(cacheHome, { OLLAMA_HOST: baseUrl }),
    ['--analyzer', 'local', '--local-model', MATRIX_MODEL, '--transcription', 'skip'],
  );
});

test('api × skip', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'api × skip';
  const systemUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const baseUrl = process.env.E2E_API_BASE_URL ?? `${systemUrl}/v1`;
  const model = process.env.E2E_API_MODEL ?? MATRIX_MODEL;
  const key = process.env.E2E_API_KEY ?? (process.env.E2E_API_BASE_URL === undefined ? 'ollama-local-dummy-key' : undefined);
  if (key === undefined || key.length === 0) failOrSkip(cell, 'E2E_API_KEY is required when E2E_API_BASE_URL selects a cloud provider');
  if (process.env.E2E_API_BASE_URL === undefined) await requireSystemOllamaModel(cell, systemUrl, model);
  const environment = cellEnvironment(cacheHome, { E2E_CELL_API_KEY: key });
  await runCliCell(
    cell,
    sampleById('bbb'),
    environment,
    [
      '--analyzer', 'api',
      '--api-base-url', baseUrl,
      '--api-model', model,
      '--api-key-env', 'E2E_CELL_API_KEY',
      '--transcription', 'skip',
    ],
  );
});

for (const harness of [
  { cell: 'harness-claude × skip', provider: 'claude-code', command: 'claude', auth: ['auth', 'status'] },
  { cell: 'harness-codex × skip', provider: 'codex', command: 'codex', auth: ['login', 'status'] },
  { cell: 'harness-cursor-agent × skip', provider: 'cursor-agent', command: 'cursor-agent', auth: ['status'] },
] as const) {
  test(harness.cell, async () => {
    test.setTimeout(CELL_TIMEOUT_MS);
    const realHome = process.env.HOME;
    if (realHome === undefined) failOrSkip(harness.cell, 'HOME is not set');
    // agent CLIs resolve auth stores (keychain paths incl.) via HOME; a faked HOME logs them out
    const environment = cellEnvironment(realHome);
    requireCommandAuthentication(harness.cell, harness.command, harness.auth, environment);
    await runCliCell(
      harness.cell,
      sampleById('bbb'),
      environment,
      ['--analyzer', 'harness', '--harness', harness.provider, '--transcription', 'skip'],
    );
  });
}

test('local-managed × configured-whisper', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'local-managed × configured-whisper';
  requireAppleSilicon(cell);
  const whisperPath = managedWhisperBinaryPath(cacheHome);
  if (!existsSync(whisperPath)) failOrSkip(cell, `cached managed whisper binary is missing: ${whisperPath}`);
  await runCliCell(
    cell,
    sampleById('speech'),
    unavailableManagedOllamaEnvironment(),
    [
      '--analyzer', 'local',
      '--local-model', MATRIX_MODEL,
      '--transcription', 'own',
      '--whisper-path', whisperPath,
      '--whisper-model', WHISPER_MODEL,
    ],
    true,
  );
});

test('local-system × openai-whisper-api', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'local-system × openai-whisper-api';
  const key = process.env.OPENAI_API_KEY;
  if (key === undefined || key.length === 0) failOrSkip(cell, 'OPENAI_API_KEY is required for the real Whisper API leg');
  const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const whisperApiBaseUrl = process.env.E2E_WHISPER_API_BASE_URL;
  const whisperApiModel = process.env.E2E_WHISPER_API_MODEL;
  await requireSystemOllamaModel(cell, baseUrl, MATRIX_MODEL);
  await runCliCell(
    cell,
    sampleById('speech'),
    cellEnvironment(cacheHome, { OLLAMA_HOST: baseUrl, OPENAI_API_KEY: key }),
    [
      '--analyzer', 'local', '--local-model', MATRIX_MODEL, '--transcription', 'api',
      ...(whisperApiBaseUrl === undefined ? [] : ['--whisper-api-base-url', whisperApiBaseUrl]),
      ...(whisperApiModel === undefined ? [] : ['--whisper-api-model', whisperApiModel]),
    ],
    true,
  );
});

const linkCachedArtifacts = (freshHome: string, cell: string): void => {
  const cacheDirectory = join(cacheHome, '.ai-video-cataloger');
  const freshDirectory = join(freshHome, '.ai-video-cataloger');
  mkdirSync(freshDirectory, { recursive: true });
  for (const name of ['bin', 'models', 'runtime']) {
    const source = join(cacheDirectory, name);
    if (!existsSync(source)) failOrSkip(cell, `persistent matrix cache is missing ${source}`);
    symlinkSync(source, join(freshDirectory, name), 'dir');
  }
};

test('wizard-folder-gui × local-managed × managed-whisper', { tag: '@gui' }, async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'wizard-folder-gui × local-managed × managed-whisper';
  requireAppleSilicon(cell);
  const sample = sampleById('speech');
  const workdir = makeEmptyWorkdir('matrix-wizard-folder');
  const freshHome = mkdtempSync(join(tmpdir(), 'avc-matrix-fresh-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'avc-matrix-user-data-'));
  linkCachedArtifacts(freshHome, cell);
  await addSampleTo(workdir, sample);
  writeFileSync(
    join(userData, 'folder-store.json'),
    JSON.stringify({ currentFolder: null, recentFolders: [] }, null, 2),
  );

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userData}`],
    cwd: REPO_ROOT,
    env: {
      ...unavailableManagedOllamaEnvironment(freshHome),
      NODE_ENV: 'production',
      AVC_RENDERER_HTML: RENDERER_HTML,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.desktopBridge !== undefined);
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-analyzer')).toBeVisible();
    await page.getByTestId('wizard-local-model-select').click();
    await page.getByRole('option', { name: /Gemma 3 4B/i }).click();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-transcription')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('transcription-managed')).toBeVisible();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-downloads')).toBeVisible();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-readiness')).toBeVisible({ timeout: CELL_TIMEOUT_MS });
    await expect(page.getByTestId('readiness-ready')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-done')).toBeVisible();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('setup-wizard')).toBeHidden();

    await page.evaluate(async (folder) => window.desktopBridge.folder.setCurrent(folder), workdir);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const row = page.locator(`[data-testid="video-item"][data-video-filename="${sample.file}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
    const analyzeButton = page.getByTestId('analyze-button');
    await expect(analyzeButton).toBeEnabled({ timeout: 60_000 });
    await analyzeButton.click();
    await expect(page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'false', { timeout: PIPELINE_TIMEOUT_MS });
    const rows = await readCatalog(workdir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.new_name).toMatch(RENAMED_PATTERN);
    expect(existsSync(join(workdir, 'summaries', `${basename(rows[0]?.new_name ?? '', extname(rows[0]?.new_name ?? ''))}.txt`))).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(workdir, { recursive: true, force: true });
    rmSync(freshHome, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
