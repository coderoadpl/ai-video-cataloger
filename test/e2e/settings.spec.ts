import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dismissSetupWizard, ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-settings-userdata-'));
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

test.describe('Settings modal end to end', () => {
  test('changing whisper mode and tag language persists across reopen', async () => {
    const folder = makeEmptyWorkdir('settings-modal');
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

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });

      const whisperSelect = session.page.getByTestId('whisper-mode-select');
      await expect(whisperSelect).toBeVisible({ timeout: 15_000 });
      await whisperSelect.click();
      await session.page.getByTestId('whisper-mode-option-skip').click();
      await expect(whisperSelect).toContainText(/skip|pomiń/i, { timeout: 15_000 });

      const tagLanguageSelect = session.page.getByTestId('tag-language-select');
      await tagLanguageSelect.click();
      await session.page.getByRole('listbox').locator('li[data-value="pl"]').click();

      await session.page.getByTestId('settings-save').click();
      await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await session.page.getByTestId('open-settings-button').click();
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('whisper-mode-select')).toContainText(/skip|pomiń/i, { timeout: 15_000 });
      await expect(session.page.getByTestId('tag-language-select')).toHaveText(/polski|polish/i, { timeout: 15_000 });

      await session.page.getByTestId('settings-cancel').click();
      await expect(modal).toBeHidden({ timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
