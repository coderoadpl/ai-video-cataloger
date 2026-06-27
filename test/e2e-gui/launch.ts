/**
 * Shared harness for the Electron GUI e2e test.
 *
 * Prepares an isolated work folder (a copy of a known sample video) plus an
 * isolated Electron userData dir pre-seeded so the app opens that folder on
 * launch - this drives the real renderer flow (auto-scan -> list -> Analyze)
 * without touching the native folder picker.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDERER_HTML = join(REPO_ROOT, 'electron', 'renderer', 'dist', 'index.html');
const MAIN_ENTRY = join(REPO_ROOT, 'dist-electron', 'main', 'index.js');

export interface GuiHarness {
  app: ElectronApplication;
  page: Page;
  workdir: string;
  videoFile: string;
}

/**
 * Launch the built Electron app scoped to a fresh folder containing one copy
 * of `sampleAbsPath` (named `sampleFile`).
 */
export async function launchAppWithVideo(
  sampleAbsPath: string,
  sampleFile: string
): Promise<GuiHarness> {
  // Isolated work folder with the video to catalog
  const workdir = mkdtempSync(join(tmpdir(), 'avc-gui-'));
  copyFileSync(sampleAbsPath, join(workdir, sampleFile));

  // Isolated Electron userData, pre-seeded so the app opens `workdir` on start
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-userdata-'));
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    join(userDataDir, 'folder-store.json'),
    JSON.stringify({ currentFolder: workdir, recentFolders: [workdir] }, null, 2)
  );

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production', // force the built-renderer path (no Vite server)
      AVC_RENDERER_HTML: RENDERER_HTML,
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, workdir, videoFile: sampleFile };
}
