import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const DEV_PORT = 9473;
const API_PROXY_TARGET = 'http://127.0.0.1:9411';

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

// vite silently externalizes a Node builtin unless it is imported by name, so a
// default or side-effect import ships a bundle that throws in the browser
// instead of failing the build (the configId regression, commit 1ee0502).
const rendererIsBrowserOnly = (): Plugin => ({
  name: 'avc-renderer-is-browser-only',
  apply: 'build',
  enforce: 'pre',
  resolveId: (source: string, importer: string | undefined): null => {
    if (!NODE_BUILTINS.has(source)) return null;
    throw new Error(
      `The renderer bundle graph reached the Node builtin "${source}" via ${importer ?? 'the entry'}. ` +
        'Renderer-reachable modules must be browser-safe — core/domain is in this graph.',
    );
  },
});

export default defineConfig({
  root: 'apps/web',
  base: './',
  plugins: [rendererIsBrowserOnly(), react()],
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
