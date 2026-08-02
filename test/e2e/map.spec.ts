import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-map-userdata-'));
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

test.describe('Map surface', () => {
  test('shows an honest empty state on a home with no GPS-located media', async () => {
    const workdir = makeEmptyWorkdir('map-empty-state');
    const session = await launch(workdir);
    try {
      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-map').click();

      const emptyState = session.page.getByTestId('map-empty-state');
      await expect(emptyState).toBeVisible({ timeout: 20_000 });
      await expect(session.page.getByTestId('map-loading')).toHaveCount(0);
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
