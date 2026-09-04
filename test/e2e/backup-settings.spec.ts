import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dismissSetupWizard, ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
  recoveryKeyPath: string;
}

const SERVICE_ACCOUNT_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'backup@example.com',
  private_key: 'not-a-real-key',
  private_key_id: 'key-1',
  token_uri: 'https://oauth.example.test/token',
});

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-backup-userdata-'));
  const recoveryKeyPath = join(workdir, 'recovery-key.txt');
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_DRIVER: 'memory',
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    },
  });

  await app.evaluate(({ app: electronApp, dialog }, savePath) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: savePath });
    const relaunched = { value: false };
    electronApp.relaunch = () => {
      relaunched.value = true;
    };
    electronApp.exit = () => undefined;
    Object.defineProperty(globalThis, 'avcRelaunchRequested', { get: () => relaunched.value });
  }, recoveryKeyPath);

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  await dismissSetupWizard(page);

  return { app, page, recoveryKeyPath };
}

async function openBackupSettings(page: Page): Promise<void> {
  await page.getByTestId('open-settings-button').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settings-backup')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('settings-backup').scrollIntoViewIfNeeded();
}

async function enableBackup(session: Session): Promise<void> {
  await session.page.getByTestId('backup-enabled-switch').locator('input').click();
  await expect(session.page.getByTestId('backup-stepper')).toBeVisible();

  await session.page.getByTestId('backup-provider-service-account').locator('input').click();
  await session.page.getByTestId('backup-stepper-next').click();

  await session.page.getByTestId('backup-shared-drive-id').fill('drive-e2e');
  await session.page.getByTestId('backup-key-json').fill(SERVICE_ACCOUNT_KEY);
  await session.page.getByTestId('backup-connect').click();

  await expect(session.page.getByTestId('backup-export-recovery-key')).toBeVisible({ timeout: 15_000 });
  await session.page.getByTestId('backup-export-recovery-key').click();
  await expect(session.page.getByTestId('backup-recovery-key-report')).toBeVisible({ timeout: 15_000 });
  await expect(session.page.getByTestId('backup-finish')).toBeDisabled();

  await session.page.getByTestId('backup-recovery-key-saved').locator('input').click();
  await session.page.getByTestId('backup-finish').click();
  await expect(session.page.getByTestId('backup-stepper')).toBeHidden({ timeout: 15_000 });
}

test.describe('Settings > Backup end to end', () => {
  test('enables backup through the stepper, backs up on demand, and confirms a restore', async () => {
    const workdir = makeEmptyWorkdir('backup-settings');
    const session = await launch(workdir);
    try {
      await openBackupSettings(session.page);
      await expect(session.page.getByTestId('backup-run-now')).toHaveCount(0);

      await enableBackup(session);

      await expect(session.page.getByTestId('backup-run-now')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('backup-connection')).toContainText('memory@example.com');
      expect(readFileSync(session.recoveryKeyPath, 'utf8')).toContain('recovery key');

      await expect(session.page.getByTestId('backup-list')).toBeVisible({ timeout: 20_000 });
      await expect(session.page.getByTestId('backup-last-success')).not.toContainText('No backup yet', {
        timeout: 20_000,
      });

      await session.page.getByTestId('settings-cancel').click();
      await expect(session.page.getByTestId('backup-indicator')).toHaveAttribute('data-state', 'idle', {
        timeout: 20_000,
      });

      await openBackupSettings(session.page);
      const archives = session.page.locator('[data-testid^="backup-row-"]');
      await expect(archives).toHaveCount(1, { timeout: 20_000 });

      await session.page.getByTestId('backup-run-now').click();
      await expect(session.page.getByTestId('backup-run-now')).toBeDisabled({ timeout: 15_000 });
      await expect(session.page.getByTestId('backup-run-now')).toBeEnabled({ timeout: 30_000 });
      await expect(archives).toHaveCount(2, { timeout: 20_000 });

      const restoreButton = session.page.getByTestId('backup-list').getByRole('button', { name: /restore|przywróć/i }).first();
      await expect(restoreButton).toBeVisible({ timeout: 20_000 });
      await restoreButton.click();

      const dialog = session.page.getByTestId('backup-restore-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/local copy of the current catalog|kopia obecnego katalogu/i);
      await expect(dialog).toContainText(/app restarts|uruchomi się ponownie/i);

      await session.page.getByTestId('backup-restore-confirm').click();
      await expect(session.page.getByTestId('backup-restore-confirm-final')).toBeVisible();
      await session.page.getByTestId('backup-restore-confirm-final').click();

      await expect
        .poll(async () => session.app.evaluate(() => Reflect.get(globalThis, 'avcRelaunchRequested')), {
          timeout: 30_000,
        })
        .toBe(true);
    } finally {
      await session.app.close();
    }
  });
});
