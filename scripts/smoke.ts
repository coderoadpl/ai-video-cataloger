import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import { createApp } from '@server/src/create-app.js';
import packageJson from '../package.json' with { type: 'json' };
import { z } from 'zod';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(rootDir, 'apps/cli/src/main.ts');

// Gates must never read or write the developer's real macOS Keychain.
process.env.AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN = '1';

class SmokeFailure extends Error {}

const fail = (message: string): never => {
  throw new SmokeFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = (args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env, AVC_WORKING_DIRECTORY: cwd },
    });
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

const jsonEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), timestamp: z.string(), command: z.string(), data: z.unknown().optional() }),
  z.object({ type: z.literal('progress'), timestamp: z.string(), step: z.string() }).passthrough(),
  z.object({ type: z.literal('completed'), timestamp: z.string(), data: z.unknown().optional() }),
  z.object({ type: z.literal('error'), timestamp: z.string(), message: z.string(), code: z.string(), data: z.unknown().optional() }),
]);
const healthEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ status: z.literal('ok'), version: z.string() }) }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
const readyEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: z.object({
      status: z.literal('ok'),
      version: z.string(),
      checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

const require = createRequire(import.meta.url);

const binaryPathSchema = z.string();
const ffprobeModuleSchema = z.object({ path: z.string() });

interface NativeAsset {
  readonly label: string;
  readonly mode: 'readable' | 'executable';
  readonly resolve: () => string;
}

const NATIVE_ASSETS: readonly NativeAsset[] = [
  {
    label: 'ffmpeg-static binary',
    mode: 'executable',
    resolve: () => binaryPathSchema.parse(require('ffmpeg-static')),
  },
  {
    label: '@ffprobe-installer ffprobe binary',
    mode: 'executable',
    resolve: () => ffprobeModuleSchema.parse(require('@ffprobe-installer/ffprobe')).path,
  },
  {
    label: 'electron runtime',
    mode: 'executable',
    resolve: () => binaryPathSchema.parse(require('electron')),
  },
  {
    label: 'onnxruntime-node darwin binding',
    mode: 'readable',
    resolve: () =>
      join(
        dirname(require.resolve('onnxruntime-node/package.json')),
        'bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
      ),
  },
  {
    label: 'sql.js wasm',
    mode: 'readable',
    resolve: () => join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm'),
  },
];

const nativeAssetProblem = (asset: NativeAsset): string | null => {
  let path: string;
  try {
    path = asset.resolve();
  } catch (cause) {
    return `${asset.label} does not resolve: ${String(cause)}`;
  }
  try {
    accessSync(path, asset.mode === 'executable' ? constants.X_OK : constants.R_OK);
    return null;
  } catch {
    return `${asset.label} is missing or not ${asset.mode} at ${path}`;
  }
};

const checkInstalledTree = (): void => {
  const declared = [...Object.keys(packageJson.dependencies), ...Object.keys(packageJson.devDependencies)];
  const unlinked = declared.filter(
    (name) => !existsSync(join(rootDir, 'node_modules', name, 'package.json')),
  );
  if (unlinked.length > 0) {
    const shown = unlinked.slice(0, 10).join('\n  ');
    const rest = unlinked.length > 10 ? `\n  ...and ${unlinked.length - 10} more` : '';
    fail(`Declared dependencies are not linked into node_modules. Run: pnpm install\n  ${shown}${rest}`);
  }

  const assetProblems = NATIVE_ASSETS.map(nativeAssetProblem).filter((problem) => problem !== null);
  if (assetProblems.length > 0) {
    fail(
      'Native assets the packaged bundle reads as literal paths are not materialized; a dependency that ' +
        'needs its install script may have dropped out of onlyBuiltDependencies (pnpm-workspace.yaml). ' +
        `Run: pnpm install\n  ${assetProblems.join('\n  ')}`,
    );
  }
};

const lockLint = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(rootDir, 'scripts/lock-lint.mjs')], {
      cwd: rootDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => reject(new SmokeFailure(`lock-lint could not run: ${String(cause)}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new SmokeFailure(stderr.trim()));
    });
  });

const bootInProcess = async (): Promise<void> => {
  const app = createApp();
  try {
    const response = await app.honoApp.request('/api/health');
    assert(response.ok, `in-process health returned HTTP ${response.status}`);
    const parsed = healthEnvelopeSchema.parse(await response.json());
    assert(parsed.ok, 'in-process health returned an error envelope');
    assert(parsed.data.version === packageJson.version, `in-process health echoed the wrong version: ${parsed.data.version}`);

    const live = await app.honoApp.request('/api/health/live');
    assert(live.ok, `in-process liveness returned HTTP ${live.status}`);
    const liveParsed = healthEnvelopeSchema.parse(await live.json());
    assert(liveParsed.ok, 'in-process liveness returned an error envelope');
  } finally {
    await app.dispose();
  }

  const ready = createApp({ dbDriver: 'memory' });
  try {
    const response = await ready.honoApp.request('/api/health/ready');
    assert(response.ok, `in-process readiness returned HTTP ${response.status}`);
    const parsed = readyEnvelopeSchema.parse(await response.json());
    assert(parsed.ok, 'in-process readiness returned an error envelope');
    assert(parsed.data.checks.every((check) => check.ok), 'in-process readiness reported a failed check');
  } finally {
    await ready.dispose();
  }
};

const parseEvents = (runResult: Run, label: string): Array<z.output<typeof jsonEventSchema>> => {
  const lines = runResult.stdout.trim().split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) fail(`${label}: stdout had no NDJSON events.\nstderr: ${runResult.stderr}`);
  const events: Array<z.output<typeof jsonEventSchema>> = [];
  for (const line of lines) {
    const parsed = jsonEventSchema.safeParse(JSON.parse(line));
    if (parsed.success) events.push(parsed.data);
  }
  if (events.length === 0) fail(`${label}: no lifecycle events found.\nstdout: ${runResult.stdout}\nstderr: ${runResult.stderr}`);
  return events;
};

const completedData = (runResult: Run, label: string): unknown => {
  const completed = parseEvents(runResult, label).find((event) => event.type === 'completed');
  if (completed === undefined) {
    return fail(`${label}: missing completed event.\nstdout: ${runResult.stdout}\nstderr: ${runResult.stderr}`);
  }
  return completed.data;
};

const errorEvent = (runResult: Run, label: string): z.output<typeof jsonEventSchema> => {
  const found = parseEvents(runResult, label).find((event) => event.type === 'error');
  if (found === undefined) {
    return fail(`${label}: missing error event.\nstdout: ${runResult.stdout}\nstderr: ${runResult.stderr}`);
  }
  return found;
};

const driveCli = async (home: string, folder: string): Promise<void> => {
  const env = { HOME: home };

  const doctor = await run(['doctor', '--json'], env, folder);
  const doctorOk = doctor.code === 0 || doctor.code === EXIT_CODE_BY_ERROR_CODE.prerequisites_failed;
  assert(doctorOk, `doctor: unexpected exit ${doctor.code}.\nstdout: ${doctor.stdout}\nstderr: ${doctor.stderr}`);
  z.object({ dependencies: z.array(z.unknown()), allAvailable: z.boolean() }).parse(completedData(doctor, 'doctor'));

  const scan = await run(['scan', folder, '--json'], env, folder);
  assert(scan.code === 0, `scan: expected exit 0, got ${scan.code}.\nstdout: ${scan.stdout}\nstderr: ${scan.stderr}`);
  z.object({ folder: z.string(), videos: z.array(z.unknown()), summary: z.object({ total: z.number() }) }).parse(completedData(scan, 'scan'));

  const set = await run(['config', 'set', 'frames', '4', '--json'], env, folder);
  assert(set.code === 0, `config set: expected exit 0, got ${set.code}.\nstdout: ${set.stdout}\nstderr: ${set.stderr}`);
  z.object({ key: z.literal('frames'), value: z.literal('4') }).parse(completedData(set, 'config set'));

  const get = await run(['config', 'get', 'frames', '--json'], env, folder);
  assert(get.code === 0, `config get: expected exit 0, got ${get.code}.\nstdout: ${get.stdout}\nstderr: ${get.stderr}`);
  z.object({ key: z.literal('frames'), value: z.literal('4') }).parse(completedData(get, 'config get'));

  const status = await run(['status', '--json'], env, folder);
  assert(status.code === 0, `status: expected exit 0, got ${status.code}.\nstdout: ${status.stdout}\nstderr: ${status.stderr}`);
  z.object({ videos: z.array(z.unknown()), summary: z.object({ total: z.number() }) }).parse(completedData(status, 'status'));

  const indexStatus = await run(['index', 'status', '--json'], env, folder);
  assert(indexStatus.code === 0, `index status: expected exit 0, got ${indexStatus.code}.\nstdout: ${indexStatus.stdout}\nstderr: ${indexStatus.stderr}`);
  z.object({
    databasePath: z.string(),
    counts: z.object({ folders: z.number(), files: z.number(), analyses: z.number() }),
    folders: z.array(z.unknown()),
  }).parse(completedData(indexStatus, 'index status'));

  const missingFolder = join(folder, 'missing');
  const missing = await run(['scan', missingFolder, '--json'], env, folder);
  const expected = EXIT_CODE_BY_ERROR_CODE.folder_not_found;
  assert(missing.code === expected, `scan missing: expected exit ${expected}, got ${missing.code}.\nstdout: ${missing.stdout}\nstderr: ${missing.stderr}`);
  const error = errorEvent(missing, 'scan missing');
  assert(error.type === 'error' && error.code === 'FOLDER_NOT_FOUND', `scan missing: expected FOLDER_NOT_FOUND, got ${JSON.stringify(error)}`);
};

const startedAt = Date.now();
const tempDirs: string[] = [];
try {
  console.log('smoke: checking the installed dependency tree...');
  checkInstalledTree();
  console.log('smoke: linting the lockfile under frozen-lockfile semantics...');
  await lockLint();
  console.log('smoke: booting the in-process app via createApp...');
  await bootInProcess();
  console.log('smoke: driving the CLI...');
  const home = mkdtempSync(join(tmpdir(), 'avc-smoke-home-'));
  const folder = mkdtempSync(join(tmpdir(), 'avc-smoke-folder-'));
  tempDirs.push(home, folder);
  await driveCli(home, folder);
  console.log(`\nsmoke: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}
