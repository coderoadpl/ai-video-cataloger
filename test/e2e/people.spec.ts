import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HuggingFaceWhisperModelDownloader } from '../../adapters/whisper/index.js';
import { FILE_ARTIFACTS } from '../../core/domain/index.js';
import { ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-people-userdata-'));
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

test.describe('People: enable faces, index, and rename a real grouping', () => {
  test('faces switch, real indexing over a folder, and a rename via the card menu', async () => {
    const samplePhoto = process.env.E2E_FACES_SAMPLE_PHOTO;
    if (samplePhoto === undefined || samplePhoto.length === 0) {
      test.skip(true, 'Set E2E_FACES_SAMPLE_PHOTO to a real photo with a detectable face to run this leg');
      return;
    }
    if (!existsSync(samplePhoto)) {
      test.skip(true, `E2E_FACES_SAMPLE_PHOTO does not exist: ${samplePhoto}`);
      return;
    }

    const folder = makeEmptyWorkdir('people-real-indexing');
    const home = isolatedHome(folder);
    const downloads = new HuggingFaceWhisperModelDownloader({ homeDirectory: home });
    for (const artifact of Object.values(FILE_ARTIFACTS)) {
      const ready = await downloads.isFileArtifactDownloaded(artifact);
      if (!ready.ok) {
        test.skip(true, `Face model artifact check failed for ${artifact.id}: ${ready.error.message}`);
        return;
      }
      if (!ready.value) {
        const downloaded = await downloads.downloadFileArtifact(artifact, { force: false });
        if (!downloaded.ok) {
          test.skip(true, `Face model artifact ${artifact.id} unavailable in this environment: ${downloaded.error.message}`);
          return;
        }
      }
    }

    copyFileSync(samplePhoto, join(folder, basename(samplePhoto)));

    const session = await launch(folder);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();

      await stubOpenDialog(session.app, folder);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      await expect(session.page.getByText(folder)).toBeVisible({ timeout: 20_000 });

      const photosToggle = session.page.getByTestId('analysis-media-photos');
      await photosToggle.click();
      await expect(photosToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      const scanButton = session.page.getByTestId('photos-scan-action');
      await expect(scanButton).toBeVisible({ timeout: 20_000 });
      await scanButton.click();
      await expect(session.page.getByTestId('photos-sidebar-unscanned')).toBeHidden({ timeout: 120_000 });

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const facesSwitch = session.page.getByTestId('faces-enabled-switch');
      await expect(facesSwitch).toBeVisible({ timeout: 15_000 });
      if (!(await facesSwitch.locator('input[type="checkbox"]').isChecked())) {
        await facesSwitch.click();
        await session.page.getByTestId('settings-save').click();
        await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      } else {
        await session.page.getByTestId('settings-cancel').click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      const indexButton = session.page.getByTestId('people-index');
      await expect(indexButton).toBeEnabled({ timeout: 30_000 });
      await indexButton.click();

      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-people').click();

      const card = session.page.getByTestId('people-card').first();
      await expect(card).toBeVisible({ timeout: 300_000 });

      await card.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-rename').click();
      const renameInput = session.page.getByTestId('people-rename-input');
      await expect(renameInput).toBeVisible({ timeout: 10_000 });
      await renameInput.fill('E2E person one');
      await session.page.getByTestId('people-rename-save').click();

      await expect(card.getByText('E2E person one')).toBeVisible({ timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
