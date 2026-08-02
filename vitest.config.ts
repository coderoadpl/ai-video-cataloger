import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { scaledTimeout } from './test/helpers/gate-timeout.js';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./adapters', import.meta.url)),
      '@server': fileURLToPath(new URL('./apps/server', import.meta.url)),
    },
  },
  test: {
    maxWorkers: 4,
    testTimeout: scaledTimeout(5000),
    hookTimeout: scaledTimeout(10000),
    // Gates must never read or write the developer's real macOS Keychain.
    env: { AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['core/**/*.ts', 'adapters/**/*.ts', 'apps/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Renderer bootstrap: mounts React into the DOM, no database-free unit
        // surface, exercised by the GUI e2e job.
        'apps/web/src/main.tsx',
        // Dev-only component gallery (CLAUDE.md §House rules): a QA tool, not
        // shipped, driven by scripts/gallery-shots.mjs, not vitest.
        'apps/web/src/gallery/**',
        // Visual-regression harness (ADR-0005): fixture surfaces for the
        // screenshot suite, rendered by `pnpm run visual`, never by vitest.
        'apps/web/src/visual/**',
        // Gate-orchestration scripts (top-level programs that boot the real app /
        // scan docs and process.exit()): run by `pnpm run smoke` / `pnpm run
        // doc-lint`, never by vitest, so counting them 0% would depress the floor.
        'scripts/smoke.ts',
        'scripts/doc-lint.ts',
      ],
      // Ratchet floor, not aspiration: each threshold is the measured coverage of
      // `vitest run --coverage` rounded DOWN to the whole percent. A regression
      // below the floor fails `pnpm run check`; raise the floor whenever coverage
      // climbs. First measured 2026-07-25 (Phase 3): stmts 79.33 / branches 80.57
      // / funcs 73.68 / lines 79.33. Raised 2026-08-03 (W34a): stmts 86.65 /
      // branches 83.43 / funcs 81.32 / lines 86.65.
      thresholds: {
        statements: 86,
        branches: 83,
        functions: 81,
        lines: 86,
      },
    },
    projects: [
      {
        extends: true,
        test: { name: 'core-domain', environment: 'node', include: ['core/domain/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'core-contract', environment: 'node', include: ['core/contract/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'core-server', environment: 'node', include: ['core/server/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'core-client', environment: 'node', include: ['core/client/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'adapters', environment: 'node', include: ['adapters/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'eslint-plugin',
          environment: 'node',
          include: ['eslint-plugin-avc/**/*.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/test/setup.ts'],
          testTimeout: scaledTimeout(30000),
        },
      },
      {
        extends: true,
        test: { name: 'desktop', environment: 'node', include: ['apps/desktop/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'app-server', environment: 'node', include: ['apps/server/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'cli',
          environment: 'node',
          include: ['test/cli/**/*.test.ts', 'apps/cli/**/*.test.ts'],
          testTimeout: scaledTimeout(30000),
        },
      },
      {
        extends: true,
        test: {
          name: 'config',
          environment: 'node',
          include: ['config-regression/**/*.test.ts'],
          testTimeout: scaledTimeout(120000),
          // The beforeAll boots a real eslint subprocess over planted fixtures;
          // under coverage instrumentation that first run exceeds the 10s default.
          hookTimeout: scaledTimeout(120000),
        },
      },
      {
        extends: true,
        test: { name: 'e2e-support', environment: 'node', include: ['test/e2e/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'scripts', environment: 'node', include: ['scripts/**/*.test.ts'] },
      },
    ],
  },
});
