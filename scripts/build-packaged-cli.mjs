import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const requireShim = [
  '#!/usr/bin/env node',
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

const stageDir = 'dist/cli';
const stagedEntry = path.join(stageDir, 'index.js');

await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await build({
  entryPoints: ['apps/cli/src/main.ts'],
  outfile: stagedEntry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['onnxruntime-node'],
  banner: { js: requireShim },
  define: googleOAuthDefines,
});
await writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify({ type: 'module', main: 'index.js', bin: { 'ai-video-cataloger': 'index.js' } }, null, 2)}\n`,
);
await chmod(stagedEntry, 0o755);

const require = createRequire(import.meta.url);
const sqlJsWasmSource = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
await copyFile(sqlJsWasmSource, path.join(stageDir, 'sql-wasm.wasm'));

await verifyStagedCli(stageDir);

async function verifyStagedCli(sourceDir) {
  const isolated = await mkdtemp(path.join(tmpdir(), 'avc-pkg-cli-'));
  const home = await mkdtemp(path.join(tmpdir(), 'avc-pkg-cli-home-'));
  const folder = await mkdtemp(path.join(tmpdir(), 'avc-pkg-cli-folder-'));
  try {
    for (const asset of ['index.js', 'package.json', 'sql-wasm.wasm']) {
      await copyFile(path.join(sourceDir, asset), path.join(isolated, asset));
    }
    const result = await runNode([path.join(isolated, 'index.js'), 'tags', 'list', '--json'], {
      HOME: home,
      AVC_WORKING_DIRECTORY: folder,
      AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
    });
    if (result.code !== 0) {
      throw new Error(
        `Packaged CLI verification failed: "tags list" exited ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
    console.log('package:stage: isolated staged CLI DB-touching verification passed');
  } finally {
    await rm(isolated, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  }
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}
