import { defineConfig } from '@playwright/test';

/**
 * GUI e2e config: drives the real Electron app via Playwright's _electron.
 * Long single-worker run (the pipeline shells out to ffmpeg/whisper/claude).
 * Not part of `npm test`; run with `npm run test:e2e:gui`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.gui\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 480_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
});
