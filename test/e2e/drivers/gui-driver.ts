/**
 * GUI driver: performs the same scenarios by clicking the real Electron app.
 *
 * Launches the built app on an isolated userData dir pre-seeded so the app
 * opens the scenario's work folder at startup (no native folder picker).
 * Completion is detected via the processing UI (the Cancel button is visible
 * exactly while a pipeline run is in flight) and outcomes are read from disk,
 * so assertions stay identical to the CLI driver's.
 */

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, readCatalog, runCli } from '../helpers.js';
import { E2E_ANALYZER, E2E_LOCAL_MODEL } from '../analyzer-mode.js';
import type { AnalyzeOutcome, BatchOutcome, PipelineDriver } from './types.js';

const RENDERER_HTML = join(REPO_ROOT, 'electron', 'renderer', 'dist', 'index.html');
const MAIN_ENTRY = join(REPO_ROOT, 'dist-electron', 'main', 'index.js');
const PIPELINE_TIMEOUT_MS = 420_000;
const BATCH_TIMEOUT_MS = 880_000;

export class GuiDriver implements PipelineDriver {
  readonly kind = 'gui' as const;
  private app: ElectronApplication | undefined;
  private page: Page | undefined;
  private workdir = '';

  async open(workdir: string): Promise<void> {
    this.workdir = workdir;

    // Local analyzer mode: the GUI spawns bare `process <path>`, so the
    // backend comes from the per-folder config - set it exactly like the
    // Settings modal does (config set via the CLI, cwd = the folder).
    if (E2E_ANALYZER === 'local') {
      const setBackend = await runCli(['config', 'set', 'analyzer_backend', 'local', '--json'], workdir);
      const setModel = await runCli(['config', 'set', 'local_model', E2E_LOCAL_MODEL, '--json'], workdir);
      if (setBackend.code !== 0 || setModel.code !== 0) {
        throw new Error('Failed to preset local analyzer config for the GUI driver');
      }
    }

    const userDataDir = mkdtempSync(join(tmpdir(), 'avc-userdata-'));
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'folder-store.json'),
      JSON.stringify({ currentFolder: workdir, recentFolders: [workdir] }, null, 2)
    );

    // E2E_SLOWMO (ms) slows interactions so a human can watch (E2E_HEADED=1
    // implies a default). The Electron window is shown on screen either way.
    const slowMo = Number(process.env.E2E_SLOWMO ?? (process.env.E2E_HEADED ? '600' : '0')) || 0;

    this.app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      slowMo,
      env: {
        ...process.env,
        NODE_ENV: 'production', // load the built renderer (no Vite server)
        AVC_RENDERER_HTML: RENDERER_HTML,
      },
    });
    this.page = await this.app.firstWindow();
    await this.page.waitForLoadState('domcontentloaded');
  }

  private mustPage(): Page {
    if (!this.page) throw new Error('GuiDriver.open() must be called first');
    return this.page;
  }

  private row(filename: string) {
    return this.mustPage().locator(
      `[data-testid="video-item"][data-video-filename="${filename}"]`
    );
  }

  /** Select a video and click Analyze; returns once processing has started. */
  private async startAnalyze(filename: string): Promise<void> {
    const page = this.mustPage();
    const row = this.row(filename);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
    const analyzeButton = page.getByTestId('analyze-button');
    await expect(analyzeButton).toBeVisible({ timeout: 15_000 });
    await analyzeButton.click();
    // isAnalyzing flips synchronously in the click handler, so this is a
    // race-free "started" signal even for runs that fail within seconds.
    await expect(page.getByTestId('analysis-state'))
      .toHaveAttribute('data-analyzing', 'true', { timeout: 15_000 });
  }

  private async waitUntilIdle(): Promise<void> {
    await expect(this.mustPage().getByTestId('analysis-state'))
      .toHaveAttribute('data-analyzing', 'false', { timeout: PIPELINE_TIMEOUT_MS });
  }

  async analyze(filename: string): Promise<AnalyzeOutcome> {
    await this.startAnalyze(filename);
    await this.waitUntilIdle();
    // Outcome from the tool's own persisted state - same source as CliDriver.
    const rows = await readCatalog(this.workdir);
    const record = rows.find((r) => r.original_name === filename);
    const ok = record?.status === 'completed';
    return { ok, errors: ok ? [] : [`catalog status: ${record?.status ?? 'no record'}`] };
  }

  async analyzeAndCancel(filename: string, afterMs: number): Promise<void> {
    const page = this.mustPage();
    await this.startAnalyze(filename);
    // Cancel only once processing is visibly under way (progress panel up),
    // mirroring what a real user can do.
    await expect(page.getByTestId('cancel-analysis-button')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(afterMs);
    await page.getByTestId('cancel-analysis-button').click();
    await page.getByTestId('confirm-cancel-button').click();
    await this.waitUntilIdle();
  }

  async analyzeAll(): Promise<BatchOutcome> {
    const page = this.mustPage();
    const analyzeAll = page.getByTestId('analyze-all-button');
    await expect(analyzeAll).toBeVisible({ timeout: 60_000 });
    await analyzeAll.click();

    const dialog = page.getByTestId('batch-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: BATCH_TIMEOUT_MS });
    const success = Number(await page.getByTestId('batch-success-count').textContent());
    const failed = Number(await page.getByTestId('batch-failed-count').textContent());
    await page.getByTestId('batch-summary-close').click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    return { success, failed };
  }

  async close(): Promise<void> {
    if (this.app) {
      await this.app.close().catch(() => {});
      this.app = undefined;
      this.page = undefined;
    }
  }
}
