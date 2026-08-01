import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { E2E_ANALYZER, E2E_LOCAL_MODEL } from '../analyzer-mode.js';
import { ELECTRON_MAIN, isolatedHome, readCatalog, RENDERER_HTML, REPO_ROOT, runCli } from '../helpers.js';
import type { AnalyzeOptions, AnalyzeOutcome, BatchOutcome, PipelineDriver } from './types.js';

const PIPELINE_TIMEOUT_MS = 420_000;
const BATCH_TIMEOUT_MS = 880_000;

export class GuiDriver implements PipelineDriver {
  readonly kind = 'gui' as const;
  private app: ElectronApplication | undefined;
  private page: Page | undefined;
  private workdir = '';

  async open(workdir: string): Promise<void> {
    this.workdir = workdir;
    await this.configureAnalyzer();

    const userDataDir = mkdtempSync(join(tmpdir(), 'avc-userdata-'));
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'folder-store.json'),
      JSON.stringify({ currentFolder: workdir, recentFolders: [workdir] }, null, 2),
    );

    const slowMo = Number(process.env.E2E_SLOWMO ?? (process.env.E2E_HEADED ? '600' : '0')) || 0;

    this.app = await electron.launch({
      args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      slowMo,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        AVC_RENDERER_HTML: RENDERER_HTML,
        AVC_HOME_DIRECTORY: isolatedHome(workdir),
      },
    });
    this.page = await this.app.firstWindow();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForFunction(() => window.desktopBridge !== undefined);
    await this.page.evaluate((folderPath) => window.desktopBridge.folder.setCurrent(folderPath), workdir);
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.enterAnalysisMode();
  }

  private async enterAnalysisMode(): Promise<void> {
    const page = this.mustPage();
    const analysisTab = page.getByTestId('mode-analysis');
    await expect(analysisTab).toBeVisible({ timeout: 15_000 });
    await analysisTab.click();
    await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  }

  private mustPage(): Page {
    if (this.page === undefined) throw new Error('GuiDriver.open() must be called first');
    return this.page;
  }

  private row(filename: string) {
    return this.mustPage().locator(`[data-testid="video-item"][data-video-filename="${filename}"]`);
  }

  private async configureAnalyzer(): Promise<void> {
    if (E2E_ANALYZER !== 'local') return;
    const setBackend = await runCli(['config', 'set', 'analyzer_backend', 'local', '--json'], this.workdir);
    const setModel = await runCli(['config', 'set', 'local_model', E2E_LOCAL_MODEL, '--json'], this.workdir);
    if (setBackend.code !== 0 || setModel.code !== 0) {
      throw new Error('Failed to preset local analyzer config for the GUI driver');
    }
  }

  private async configureWhisper(options: AnalyzeOptions): Promise<void> {
    const result = await runCli(['config', 'set', 'whisper_mode', options.whisper, '--json'], this.workdir);
    if (result.code !== 0) throw new Error(`Failed to preset whisper mode: ${options.whisper}`);
  }

  private async startAnalyze(filename: string, options: AnalyzeOptions): Promise<void> {
    await this.configureWhisper(options);
    const page = this.mustPage();
    const row = this.row(filename);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
    const analyzeButton = page.getByTestId('analyze-button');
    await expect(analyzeButton).toBeVisible({ timeout: 15_000 });
    await analyzeButton.click();
    await expect(page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'true', { timeout: 15_000 });
  }

  private async waitUntilIdle(): Promise<void> {
    await expect(this.mustPage().getByTestId('analysis-state'))
      .toHaveAttribute('data-analyzing', 'false', { timeout: PIPELINE_TIMEOUT_MS });
  }

  async analyze(filename: string, options: AnalyzeOptions): Promise<AnalyzeOutcome> {
    await this.startAnalyze(filename, options);
    await this.waitUntilIdle();
    const rows = await readCatalog(this.workdir);
    const record = rows.find((row) => row.original_name === filename);
    const ok = record?.status === 'completed';
    return { ok, errors: ok ? [] : [`catalog status: ${record?.status ?? 'no record'}`] };
  }

  async analyzeAndCancel(filename: string, afterMs: number, options: AnalyzeOptions): Promise<void> {
    const page = this.mustPage();
    await this.startAnalyze(filename, options);
    await expect(page.getByTestId('cancel-analysis-button')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(afterMs);
    await page.getByTestId('cancel-analysis-button').click();
    await page.getByTestId('confirm-cancel-button').click();
    await this.waitUntilIdle();
  }

  async analyzeAll(options: AnalyzeOptions): Promise<BatchOutcome> {
    await this.configureWhisper(options);
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
    if (this.app === undefined) return;
    await this.app.close().catch(() => undefined);
    this.app = undefined;
    this.page = undefined;
  }
}
