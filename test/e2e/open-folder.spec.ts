import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { desktopLaunchEnv, dismissSetupWizard, ELECTRON_MAIN, expectInactiveWindow, isolatedHome, makeEmptyWorkdir, removeTempDir, RENDERER_HTML, REPO_ROOT } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-open-folder-userdata-'));
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: desktopLaunchEnv(userDataDir, {
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    }),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expectInactiveWindow(app);
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  await dismissSetupWizard(page);

  return { app, page };
}

async function stubPickedFolder(app: ElectronApplication, folderPath: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, folderPath);
}

test.describe('Open Folder keeps the analysis medium already in use', () => {
  test('from a fresh install, picking a folder shows the video sidebar for that folder', async () => {
    const pickedFolder = makeEmptyWorkdir('open-folder-fresh');
    const session = await launch(pickedFolder);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();
      await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await stubPickedFolder(session.app, pickedFolder);

      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();

      await expect(session.page.getByText(pickedFolder)).toBeVisible({ timeout: 20_000 });
      await expect(session.page.getByTestId('analysis-media-videos')).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(pickedFolder);
    }
  });

  test('from a photos-analysis session, picking a folder stays on the photos sidebar and re-scopes it', async () => {
    const pickedFolder = makeEmptyWorkdir('open-folder-from-photos');
    const session = await launch(pickedFolder);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();
      await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      const photosToggle = session.page.getByTestId('analysis-media-photos');
      await expect(photosToggle).toBeVisible({ timeout: 15_000 });
      await photosToggle.click();
      await expect(photosToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await session.page.waitForFunction(() => window.desktopBridge !== undefined);
      await expect(session.page.getByTestId('analysis-media-photos')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

      await stubPickedFolder(session.app, pickedFolder);

      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();

      await expect(session.page.getByTestId('sidebar-folder-identity')).toContainText(pickedFolder, { timeout: 20_000 });
      await expect(session.page.getByTestId('analysis-media-photos')).toHaveAttribute('aria-pressed', 'true');
      await expect(session.page.getByTestId('analysis-media-videos')).toHaveAttribute('aria-pressed', 'false');
    } finally {
      await session.app.close().catch(() => undefined);
      await removeTempDir(pickedFolder);
    }
  });
});
