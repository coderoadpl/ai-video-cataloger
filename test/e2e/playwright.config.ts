import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  globalSetup: './preflight.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['./matrix-reporter.ts']],
  projects: [
    { name: 'cli', testMatch: /scenarios\.spec\.ts/ },
    { name: 'gui', testMatch: /scenarios\.spec\.ts/ },
    { name: 'matrix', testMatch: /(matrix|faces-matrix)\.spec\.ts/ },
    { name: 'open-folder', testMatch: /open-folder\.spec\.ts/ },
    { name: 'settings', testMatch: /settings\.spec\.ts/ },
    { name: 'photos', testMatch: /photos\.spec\.ts/ },
    { name: 'people', testMatch: /people\.spec\.ts/ },
    { name: 'people-media', testMatch: /people-media\.spec\.ts/ },
    { name: 'library', testMatch: /library\.spec\.ts/ },
    { name: 'map', testMatch: /map\.spec\.ts/ },
  ],
});
