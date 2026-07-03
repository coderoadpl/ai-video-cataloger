import { defineConfig } from '@playwright/test';

/**
 * Unified e2e config: the SAME scenario specs run against two projects -
 * `cli` (spawns the real binary) and `gui` (drives the real Electron app).
 * globalSetup hard-fails on missing claude auth / whisper / builds: no
 * silent skips, a green run means the pipeline really executed.
 *
 *   npx playwright test --config test/e2e/playwright.config.ts               # both
 *   npx playwright test --config test/e2e/playwright.config.ts --project=cli
 *   npx playwright test --config test/e2e/playwright.config.ts --project=gui
 */
export default defineConfig({
  testDir: '.',
  testMatch: /scenarios\.spec\.ts/,
  globalSetup: './preflight.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  projects: [{ name: 'cli' }, { name: 'gui' }],
});
