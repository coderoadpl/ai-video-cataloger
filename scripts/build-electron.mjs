import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const requireShim = [
  'import { createRequire as __avcCreateRequire } from "node:module";',
  'import { dirname as __avcDirname } from "node:path";',
  'import { fileURLToPath as __avcFileURLToPath } from "node:url";',
  'const __filename = __avcFileURLToPath(import.meta.url);',
  'const __dirname = __avcDirname(__filename);',
  'const require = __avcCreateRequire(import.meta.url);',
].join('\n');

const googleOAuthDefines = {
  'process.env.AVC_GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(process.env.AVC_GOOGLE_OAUTH_CLIENT_ID ?? ''),
  'process.env.AVC_GOOGLE_OAUTH_CLIENT_SECRET': JSON.stringify(process.env.AVC_GOOGLE_OAUTH_CLIENT_SECRET ?? ''),
};

await rm('dist-electron', { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: ['apps/desktop/src/main.ts'],
    outfile: 'dist-electron/main.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', 'onnxruntime-node'],
    banner: { js: requireShim },
    define: googleOAuthDefines,
  }),
  build({
    entryPoints: ['apps/desktop/src/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
]);
