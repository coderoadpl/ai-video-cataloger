import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import { configDescriptorSchema, configId, derivedFolderId, type AppError, type Result } from '@core/domain/index.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { createApp } from '@server/src/create-app.js';
import { createInMemoryDeps } from '@server/src/test-support/in-memory-deps.js';
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
const variantRowSchema = z.object({
  configId: z.string(),
  descriptor: z.object({ output_language: z.string(), promptVersion: z.number().int() }).passthrough(),
  selected: z.boolean(),
  createdAt: z.string(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
});

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

  const ready = createApp({ dbDriver: 'memory' }, createInMemoryDeps);
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

const textFilesUnder = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...textFilesUnder(entryPath));
    else if (entry.isFile()) paths.push(entryPath);
  }
  return paths;
};

const assertCredentialNeverSharesPayloadWithConfigId = (
  secret: string,
  roots: readonly string[],
  outputs: readonly string[],
): void => {
  const persisted = roots.flatMap((root) => textFilesUnder(root).map((filePath) => ({
    label: filePath,
    content: readFileSync(filePath).toString('utf8'),
  })));
  const emitted = outputs.map((content, index) => ({ label: `CLI output ${String(index + 1)}`, content }));
  const leaks = [...persisted, ...emitted]
    .filter((candidate) => candidate.content.includes(secret) && /cfg_[0-9a-f]{12}/.test(candidate.content))
    .map((candidate) => candidate.label);
  assert(leaks.length === 0, `credential and configId appeared together in: ${leaks.join(', ')}`);
};

const requiredValue = <T>(result: Result<T, AppError>, label: string): T => {
  if (!result.ok) return fail(`${label}: ${result.error.message}`);
  return result.value;
};

const seedSmokeVariant = async (home: string, folder: string): Promise<string> => {
  const videoPath = join(folder, 'variant-smoke.mp4');
  writeFileSync(videoPath, Buffer.alloc(2048, 1));
  const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
  const fingerprint = requiredValue(await fs.partialContentHash(videoPath), 'variants fixture fingerprint');
  if (fingerprint === null) return fail('variants fixture fingerprint was unavailable');
  const folderId = derivedFolderId(folder);
  const descriptor = configDescriptorSchema.parse({
    family: 'local',
    providerId: 'local',
    modelTag: 'gemma3:12b',
    whisper_mode: 'skip',
    frames: 3,
    output_language: 'en',
    promptVersion: 1,
  });
  const resolvedConfigId = configId(descriptor);
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  requiredValue(await store.upsertFolder({
    folderId,
    currentPath: folder,
    displayName: 'smoke-fixture',
    firstSeenAt: '2026-08-03T00:00:00.000Z',
    lastSeenAt: '2026-08-03T00:00:00.000Z',
  }), 'variants fixture folder');
  requiredValue(await store.upsertFile({
    fingerprint,
    folderId,
    fileName: 'variant-smoke.mp4',
    size: statSync(videoPath).size,
    durationS: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-08-03T00:00:00.000Z',
    analyzer: 'local',
    model: 'gemma3:12b',
    missingAt: null,
  }), 'variants fixture file');
  requiredValue(await store.upsertVariant({
    fingerprint,
    configId: resolvedConfigId,
    descriptor,
    finalName: null,
    description: 'Smoke variant',
    transcript: null,
    language: 'en',
    tags: [],
    analyzer: 'local',
    model: 'gemma3:12b',
    createdAt: '2026-08-03T00:00:00.000Z',
    usage: null,
  }), 'variants fixture analysis');
  requiredValue(await store.setSelectedVariant(fingerprint, resolvedConfigId), 'variants fixture selection');
  requiredValue(await store.setFolderDefaultVariant(folderId, resolvedConfigId), 'variants fixture default');
  requiredValue(await store.dispose(), 'variants fixture persistence');
  return videoPath;
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

  const secret = 'sk-smoke-never-print';
  const setCredential = await run(
    ['config', 'set-credential', 'smoke-provider', '--env', 'AVC_SMOKE_CREDENTIAL', '--json'],
    { ...env, AVC_SMOKE_CREDENTIAL: secret },
    folder,
  );
  assert(
    setCredential.code === 0,
    `config set-credential: expected exit 0, got ${setCredential.code}.\nstderr: ${setCredential.stderr}`,
  );
  assert(!setCredential.stdout.includes(secret), 'config set-credential: the credential leaked into stdout.');
  z.object({ providerId: z.literal('smoke-provider'), stored: z.literal(true) })
    .parse(completedData(setCredential, 'config set-credential'));

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

  const suggestAliases = await run(['tags', 'suggest-aliases', '--json'], env, folder);
  assert(
    suggestAliases.code === 0,
    `tags suggest-aliases: expected exit 0, got ${suggestAliases.code}.\nstdout: ${suggestAliases.stdout}\nstderr: ${suggestAliases.stderr}`,
  );
  z.object({ proposals: z.array(z.unknown()) }).parse(completedData(suggestAliases, 'tags suggest-aliases'));

  const variantPath = await seedSmokeVariant(home, folder);
  const variants = await run(['variants', 'list', variantPath, '--json'], env, folder);
  assert(variants.code === 0, `variants list: expected exit 0, got ${variants.code}.\nstdout: ${variants.stdout}\nstderr: ${variants.stderr}`);
  z.object({ count: z.literal(1), videoPath: z.literal(variantPath) }).parse(completedData(variants, 'variants list'));
  const variantRows = variants.stdout
    .trim()
    .split('\n')
    .map((line) => variantRowSchema.safeParse(JSON.parse(line)))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
  assert(variantRows.length === 1, `variants list: expected one variant row, got ${variantRows.length}`);
  assert(variantRows[0]?.selected === true, 'variants list: expected the smoke variant to be selected');
  assertCredentialNeverSharesPayloadWithConfigId(secret, [home, folder], [
    setCredential.stdout,
    setCredential.stderr,
    indexStatus.stdout,
    indexStatus.stderr,
    variants.stdout,
    variants.stderr,
  ]);

  const deleteCredential = await run(['config', 'delete-credential', 'smoke-provider', '--json'], env, folder);
  assert(
    deleteCredential.code === 0,
    `config delete-credential: expected exit 0, got ${deleteCredential.code}.\nstderr: ${deleteCredential.stderr}`,
  );
  assert(!deleteCredential.stdout.includes(secret), 'config delete-credential: the credential leaked into stdout.');
  z.object({
    providerId: z.literal('smoke-provider'),
    cleared: z.array(z.literal('file')).length(1),
    retained: z.array(z.string()).length(0),
  }).parse(completedData(deleteCredential, 'config delete-credential'));

  const beforeMaterialize = readdirSync(folder).sort();
  const materializeDryRun = await run(['materialize', folder, '--dry-run', '--json'], env, folder);
  assert(
    materializeDryRun.code === 0,
    `materialize --dry-run: expected exit 0, got ${materializeDryRun.code}.\nstdout: ${materializeDryRun.stdout}\nstderr: ${materializeDryRun.stderr}`,
  );
  z.object({ dryRun: z.literal(true), filesTotal: z.number() }).parse(completedData(materializeDryRun, 'materialize --dry-run'));
  assert(
    JSON.stringify(readdirSync(folder).sort()) === JSON.stringify(beforeMaterialize),
    'materialize --dry-run: the folder listing changed even though nothing should have been written',
  );

  const materializeMissing = await run(['materialize', join(folder, 'missing'), '--json'], env, folder);
  const materializeMissingExpected = EXIT_CODE_BY_ERROR_CODE.folder_not_found;
  assert(
    materializeMissing.code === materializeMissingExpected,
    `materialize missing: expected exit ${materializeMissingExpected}, got ${materializeMissing.code}.\nstdout: ${materializeMissing.stdout}\nstderr: ${materializeMissing.stderr}`,
  );

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
