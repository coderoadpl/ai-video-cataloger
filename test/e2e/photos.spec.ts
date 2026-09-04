import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REAL_JPEG_BLUE_LARGE, REAL_JPEG_RED_LARGE } from '../fixtures/real-jpegs.js';
import { E2E_ANALYZER, E2E_LOCAL_MODEL } from './analyzer-mode.js';
import { dismissSetupWizard, ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT, runCli, stubOpenDialog } from './helpers.js';
import { systemOllamaModelMissingReason } from './matrix-support.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-photos-userdata-'));
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  await dismissSetupWizard(page);

  return { app, page };
}

test.describe('Current-folder photos analysis', () => {
  test('keeps scanned-only photos in Analysis and adds analyzed photos to Kolekcja', async () => {
    test.skip(process.platform !== 'darwin', 'photo decode uses /usr/bin/sips');

    const folder = makeEmptyWorkdir('photos-current-folder');
    writeFileSync(join(folder, 'red.jpg'), REAL_JPEG_RED_LARGE);
    writeFileSync(join(folder, 'blue.jpg'), REAL_JPEG_BLUE_LARGE);

    let analyzerAvailable = false;
    if (E2E_ANALYZER === 'local') {
      const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
      const reason = await systemOllamaModelMissingReason(baseUrl, E2E_LOCAL_MODEL);
      analyzerAvailable = reason === null;
      if (analyzerAvailable) {
        const setBackend = await runCli(['config', 'set', 'analyzer_backend', 'local', '--json'], folder);
        const setModel = await runCli(['config', 'set', 'local_model', E2E_LOCAL_MODEL, '--json'], folder);
        analyzerAvailable = setBackend.code === 0 && setModel.code === 0;
      }
    }

    const session = await launch(folder);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();
      await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await stubOpenDialog(session.app, folder);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      await expect(session.page.getByText(folder)).toBeVisible({ timeout: 20_000 });

      const photosToggle = session.page.getByTestId('analysis-media-photos');
      await photosToggle.click();
      await expect(photosToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await expect(session.page.getByTestId('photos-sidebar-unscanned')).toBeHidden({ timeout: 120_000 });

      const rows = session.page.getByTestId('photos-sidebar-row');
      await expect(rows.first()).toBeVisible({ timeout: 30_000 });
      await expect(rows).toHaveCount(2);

      await session.page.getByTestId('mode-library').click();
      await expect(session.page.getByTestId('subnav-collection')).toBeVisible();
      await expect(session.page.getByTestId('subnav-people')).toBeVisible();
      await expect(session.page.getByTestId('subnav-map')).toBeVisible();
      await expect(session.page.getByTestId('subnav-photos')).toHaveCount(0);
      await expect(session.page.getByTestId('library-tile')).toHaveCount(0);

      await session.page.getByTestId('mode-analysis').click();
      await expect(session.page.getByTestId('analysis-media-photos')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
      await rows.first().click();

      const detail = session.page.getByTestId('photos-detail');
      await expect(detail).toBeVisible({ timeout: 30_000 });

      const analyzeStrip = detail.getByTestId('photos-analyze-strip');
      await expect(analyzeStrip).toBeVisible({ timeout: 15_000 });

      if (analyzerAvailable) {
        const analyzeAction = analyzeStrip.getByTestId('photos-analyze-action');
        await expect(analyzeAction).toBeEnabled({ timeout: 15_000 });
        await analyzeAction.click();
        await expect(analyzeStrip).toBeHidden({ timeout: 180_000 });

        await session.page.getByTestId('mode-library').click();
        await session.page.getByTestId('library-media-photo').click();
        await expect(session.page.getByTestId('library-tile').first()).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
