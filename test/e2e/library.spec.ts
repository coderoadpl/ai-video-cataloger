import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { E2E_ANALYZER, E2E_LOCAL_MODEL } from './analyzer-mode.js';
import { ELECTRON_MAIN, isolatedHome, makeWorkdir, RENDERER_HTML, REPO_ROOT, runCli, stubOpenDialog } from './helpers.js';
import { SAMPLES } from './samples.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

const SPEECH_SAMPLE = SAMPLES.find((sample) => sample.id === 'speech');
if (SPEECH_SAMPLE === undefined) throw new Error('speech sample missing from SAMPLES');

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-library-userdata-'));
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

  const wizard = page.getByTestId('setup-wizard');
  if (await wizard.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByTestId('wizard-configure-later').click();
    await wizard.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  return { app, page };
}

test.describe('Library: same-session visibility, search, and subtitled preview', () => {
  test('an analyzed clip is searchable and previewable with subtitles in the same session', async () => {
    const { dir: workdir } = await makeWorkdir(SPEECH_SAMPLE);
    const filename = SPEECH_SAMPLE.file;

    if (E2E_ANALYZER === 'local') {
      const setBackend = await runCli(['config', 'set', 'analyzer_backend', 'local', '--json'], workdir);
      const setModel = await runCli(['config', 'set', 'local_model', E2E_LOCAL_MODEL, '--json'], workdir);
      if (setBackend.code !== 0 || setModel.code !== 0) {
        throw new Error('Failed to preset local analyzer config for the GUI library leg');
      }
    }

    const session = await launch(workdir);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();
      await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await stubOpenDialog(session.app, workdir);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      const row = session.page.locator(`[data-testid="video-item"][data-video-filename="${filename}"]`);
      await expect(row).toBeVisible({ timeout: 60_000 });

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const whisperSelect = session.page.getByTestId('whisper-mode-select');
      await expect(whisperSelect).toBeVisible({ timeout: 15_000 });
      await whisperSelect.click();
      await session.page.getByTestId('whisper-mode-option-local').click();
      const saveButton = session.page.getByTestId('settings-save');
      if (await saveButton.isEnabled()) {
        await saveButton.click();
        await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      } else {
        await session.page.getByTestId('settings-cancel').click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await row.click();
      const analyzeButton = session.page.getByTestId('analyze-button');
      await expect(analyzeButton).toBeVisible({ timeout: 15_000 });
      await analyzeButton.click();
      await expect(session.page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'true', { timeout: 15_000 });
      await expect(session.page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'false', { timeout: 420_000 });

      const detail = session.page.getByTestId('detail-layout');
      await expect(detail).toBeVisible({ timeout: 15_000 });
      await expect(detail).toHaveAttribute('data-video-status', 'completed', { timeout: 15_000 });

      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-collection').click();

      const searchInput = session.page.getByTestId('library-search-input');
      await expect(searchInput).toBeVisible({ timeout: 15_000 });
      await searchInput.locator('input').fill('pasta');

      const tile = session.page.getByTestId('library-tile').first();
      await expect(tile).toBeVisible({ timeout: 20_000 });
      await tile.click();

      const player = session.page.getByTestId('preview-player');
      await expect(player).toBeVisible({ timeout: 15_000 });
      const subtitles = player.getByTestId('preview-subtitles-track');
      await expect(subtitles).toHaveCount(1, { timeout: 15_000 });
      await expect(subtitles).toHaveAttribute('kind', 'subtitles');
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
