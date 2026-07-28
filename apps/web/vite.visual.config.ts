import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../core', import.meta.url)),
      'node:crypto': fileURLToPath(new URL('src/visual/node-crypto.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/visual', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('visual.html', import.meta.url)),
    },
  },
});
