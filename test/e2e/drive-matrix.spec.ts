import { _electron as electron, expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import {
  ELECTRON_MAIN,
  RENDERER_HTML,
  REPO_ROOT,
  addSampleTo,
  readCatalog,
  runCli,
} from './helpers.js';
import { matrixAllowsSkip, missingLegMessage } from './matrix-support.js';
import { SAMPLES, type VideoSample } from './samples.js';

const CELL = 'drive-gui × local-system × skip';
const MATRIX_MODEL = 'gemma3:4b';
const CELL_TIMEOUT_MS = 7_200_000;
const DRIVE_TIMEOUT_MS = 2_400_000;
const TREE_LAYOUT = [
  { subfolder: 'clips-a', sampleId: 'bbb' },
  { subfolder: 'clips-b', sampleId: 'jellyfish' },
] as const;
const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

const ollamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string().optional(), model: z.string().optional() })),
});

test.describe.configure({ mode: 'serial' });

const failOrSkip = (reason: string): never => {
  const message = missingLegMessage(CELL, reason);
  if (matrixAllowsSkip(process.env.E2E_MATRIX_ALLOW_SKIP)) test.skip(true, message);
  throw new Error(message);
};

const requireSystemOllamaModel = async (baseUrl: string, model: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    failOrSkip(`Ollama ${baseUrl} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) failOrSkip(`Ollama ${baseUrl} returned HTTP ${String(response.status)}`);
  const tags = ollamaTagsSchema.parse(await response.json());
  const installed = tags.models.some((entry) => entry.name === model || entry.model === model);
  if (!installed) failOrSkip(`Ollama ${baseUrl} does not have ${model} installed`);
};

const sampleById = (id: string): VideoSample => {
  const sample = SAMPLES.find((candidate) => candidate.id === id);
  if (sample === undefined) throw new Error(`Missing sample: ${id}`);
  return sample;
};

const homeScopeEnvironment = (home: string, baseUrl: string): NodeJS.ProcessEnv => ({
  ...process.env,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
  OLLAMA_HOST: baseUrl,
  HOME: home,
  USERPROFILE: home,
});

const configureHomeScope = async (home: string, environment: NodeJS.ProcessEnv): Promise<void> => {
  for (const [key, value] of [
    ['analyzer_backend', 'local'],
    ['local_model', MATRIX_MODEL],
    ['whisper_mode', 'skip'],
    ['frames', '1'],
  ] as const) {
    const result = await runCli(['config', 'set', key, value, '--json'], home, 60_000, environment);
    expect(result.code, `${CELL} config set ${key}: ${result.stderr}`).toBe(0);
  }
};

const buildDriveTree = async (): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), 'avc-e2e-drive-gui-'));
  for (const leaf of TREE_LAYOUT) {
    const directory = join(root, leaf.subfolder);
    mkdirSync(directory, { recursive: true });
    await addSampleTo(directory, sampleById(leaf.sampleId));
  }
  return root;
};

test(CELL, { tag: '@gui' }, async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  await requireSystemOllamaModel(baseUrl, MATRIX_MODEL);

  const home = mkdtempSync(join(tmpdir(), 'avc-e2e-drive-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'avc-e2e-drive-user-data-'));
  const environment = homeScopeEnvironment(home, baseUrl);
  const root = await buildDriveTree();
  await configureHomeScope(home, environment);
  writeFileSync(
    join(userData, 'folder-store.json'),
    JSON.stringify({ currentFolder: root, recentFolders: [root] }, null, 2),
  );
  mkdirSync(join(home, '.ai-video-cataloger'), { recursive: true });
  writeFileSync(join(home, '.ai-video-cataloger', 'onboarding.json'), JSON.stringify({ completed: true }));

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userData}`],
    cwd: REPO_ROOT,
    env: { ...environment, NODE_ENV: 'production', AVC_RENDERER_HTML: RENDERER_HTML },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.desktopBridge !== undefined);
    await page.evaluate((folder) => window.desktopBridge.folder.setCurrent(folder), root);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const treeScope = page.getByTestId('scope-tree');
    await expect(treeScope).toBeEnabled({ timeout: 120_000 });
    await treeScope.click();

    const analyzeAll = page.getByTestId('analyze-all-button');
    await expect(analyzeAll).toBeEnabled({ timeout: 60_000 });
    await analyzeAll.click();

    const analysisState = page.getByTestId('analysis-state');
    await expect(analysisState).toHaveAttribute('data-analyzing', 'true', { timeout: 60_000 });
    await expect(page.getByTestId('analyze-stop-button')).toBeVisible({ timeout: 300_000 });

    const summary = page.getByTestId('drive-summary-dialog');
    await expect(summary).toBeVisible({ timeout: DRIVE_TIMEOUT_MS });
    await expect(page.getByTestId('drive-folders-count')).toHaveText('2');
    await expect(page.getByTestId('drive-analyzed-count')).toHaveText('2');
    await expect(page.getByTestId('drive-skipped-count')).toHaveText('0');
    await expect(page.getByTestId('drive-failed-count')).toHaveText('0');
    await page.getByTestId('drive-summary-close').click();
    await expect(summary).toBeHidden({ timeout: 15_000 });
    await expect(analysisState).toHaveAttribute('data-analyzing', 'false');

    for (const leaf of TREE_LAYOUT) {
      const rows = await readCatalog(join(root, leaf.subfolder));
      expect(rows, `${CELL}: ${leaf.subfolder} catalog`).toHaveLength(1);
      expect(rows[0]?.original_name).toBe(sampleById(leaf.sampleId).file);
      expect(rows[0]?.status).toBe('completed');
      expect(rows[0]?.new_name).toMatch(RENAMED_PATTERN);
    }
  } finally {
    await app.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
