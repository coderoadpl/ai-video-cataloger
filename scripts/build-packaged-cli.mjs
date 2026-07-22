import { build } from 'esbuild';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';

const requireShim = [
  '#!/usr/bin/env node',
  'import { createRequire as __avcCreateRequire } from "node:module";',
  'import { dirname as __avcDirname } from "node:path";',
  'import { fileURLToPath as __avcFileURLToPath } from "node:url";',
  'const __filename = __avcFileURLToPath(import.meta.url);',
  'const __dirname = __avcDirname(__filename);',
  'const require = __avcCreateRequire(import.meta.url);',
].join('\n');

await rm('dist/cli', { recursive: true, force: true });
await mkdir('dist/cli', { recursive: true });
await build({
  entryPoints: ['apps/cli/src/main.ts'],
  outfile: 'dist/cli/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['onnxruntime-node'],
  banner: { js: requireShim },
});
await writeFile(
  'dist/cli/package.json',
  `${JSON.stringify({ type: 'module', main: 'index.js', bin: { 'ai-video-cataloger': 'index.js' } }, null, 2)}\n`,
);
await chmod('dist/cli/index.js', 0o755);
