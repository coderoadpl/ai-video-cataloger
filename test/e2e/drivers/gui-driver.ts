import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { E2E_ANALYZER, E2E_LOCAL_MODEL } from '../analyzer-mode.js';
import {
  dismissSetupWizard,
  ELECTRON_MAIN,
  isolatedHome,
  readCatalog,
  RENDERER_HTML,
  REPO_ROOT,
  runCli,
  stubOpenDialog,
} from '../helpers.js';
import type { AnalyzeOptions, AnalyzeOutcome, BatchOutcome, PipelineDriver } from './types.js';

const PIPELINE_TIMEOUT_MS = 420_000;
const BATCH_TIMEOUT_MS = 880_000;
const TERMINAL_STATUS = /^(completed|error)$/;

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
    await dismissSetupWizard(this.page);
    await this.enterAnalysisMode();
    await this.openFolder(workdir);
  }

  private async enterAnalysisMode(): Promise<void> {
    const page = this.mustPage();
    const analysisTab = page.getByTestId('mode-analysis');
    await expect(analysisTab).toBeVisible({ timeout: 15_000 });
    await analysisTab.click();
    await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  }

  private async openFolder(workdir: string): Promise<void> {
    const page = this.mustPage();
    await stubOpenDialog(this.mustApp(), workdir);
    const openFolderButton = page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
    await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
    await openFolderButton.click();
    await expect(page.getByTestId('video-item').first()).toBeVisible({ timeout: 60_000 });
  }

  private mustPage(): Page {
    if (this.page === undefined) throw new Error('GuiDriver.open() must be called first');
    return this.page;
  }

  private mustApp(): ElectronApplication {
    if (this.app === undefined) throw new Error('GuiDriver.open() must be called first');
    return this.app;
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
    const page = this.mustPage();
    await page.getByTestId('open-settings-button').click();
    const modal = page.getByTestId('settings-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const whisperSelect = page.getByTestId('whisper-mode-select');
    await expect(whisperSelect).toBeVisible({ timeout: 15_000 });
    await whisperSelect.click();
    const option = page.getByTestId(`whisper-mode-option-${options.whisper}`);
    const optionLabel = (await option.textContent())?.trim() ?? '';
    expect(optionLabel.length, `whisper mode option ${options.whisper} has no label`).toBeGreaterThan(0);
    await option.click();
    await expect(whisperSelect).toContainText(optionLabel, { timeout: 15_000 });

    const saveButton = page.getByTestId('settings-save');
    if (await saveButton.isEnabled()) {
      await saveButton.click();
      await expect(page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
    } else {
      await page.getByTestId('settings-cancel').click();
    }
    await expect(modal).toBeHidden({ timeout: 15_000 });
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
    const details = this.mustPage().getByTestId('detail-layout');
    await expect(details).toBeVisible({ timeout: 15_000 });
    await expect(details.getByTestId('video-status-badge')).toBeVisible({ timeout: 15_000 });
    await expect(details).toHaveAttribute('data-video-status', TERMINAL_STATUS, { timeout: 15_000 });
    const uiStatus = await details.getAttribute('data-video-status');
    const ok = uiStatus === 'completed';

    const rows = await readCatalog(this.workdir);
    const record = rows.find((catalogRow) => catalogRow.original_name === filename);
    const catalogOk = record?.status === 'completed';
    if (ok !== catalogOk) {
      throw new Error(
        `UI/catalog status mismatch for ${filename}: UI=${uiStatus ?? 'unknown'} catalog=${record?.status ?? 'no record'}`,
      );
    }
    return { ok, errors: ok ? [] : [`row status: ${uiStatus ?? 'unknown'}`] };
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
