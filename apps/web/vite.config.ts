import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEV_PORT = 9473;
const API_PROXY_TARGET = 'http://127.0.0.1:9411';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../core', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: DEV_PORT,
    strictPort: false,
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: false },
    },
  },
});
