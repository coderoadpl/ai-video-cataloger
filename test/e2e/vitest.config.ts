import { defineConfig } from 'vitest/config';

/**
 * Separate config for the real-video e2e suite: long timeouts, sequential,
 * NOT picked up by the root config (files are named *.e2e.ts on purpose).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 480_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    globals: false,
  },
});
