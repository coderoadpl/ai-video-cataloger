import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./adapters', import.meta.url)),
      '@server': fileURLToPath(new URL('./apps/server', import.meta.url)),
    },
  },
  test: {
    // Gates must never read or write the developer's real macOS Keychain.
    env: { AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1' },
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
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/test/setup.ts'],
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
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          name: 'config',
          environment: 'node',
          include: ['config-regression/**/*.test.ts'],
          testTimeout: 120000,
        },
      },
    ],
  },
});
