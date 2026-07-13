import { defineConfig } from '@playwright/test';

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
