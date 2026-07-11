import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: __dirname,
  build: {
    // Build straight into the electron-builder file set (dist-electron/**)
    outDir: path.resolve(__dirname, '../../dist-electron/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 9473,
    strictPort: true,
  },
});
