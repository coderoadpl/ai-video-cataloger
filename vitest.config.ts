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
    ],
  },
});
