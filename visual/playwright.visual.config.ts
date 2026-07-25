import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const repoRoot = join(import.meta.dirname, '..');
const viteConfig = 'apps/web/vite.visual.config.ts';
const PORT = 9484;
const baseURL = `http://127.0.0.1:${PORT}`;

const surface = {
  ...devices['Desktop Chrome'],
  baseURL,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
  trace: 'retain-on-failure',
} as const;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  ignoreSnapshots: process.platform !== 'darwin',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixels: 0,
      threshold: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  reporter: 'list',
  projects: [
    { name: 'chromium-dark', use: { ...surface, colorScheme: 'dark' } },
    { name: 'chromium-light', use: { ...surface, colorScheme: 'light' } },
  ],
  webServer: {
    command: `pnpm exec vite build --config ${viteConfig} && pnpm exec vite preview --config ${viteConfig} --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: repoRoot,
    url: `${baseURL}/visual.html`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
