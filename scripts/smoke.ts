import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import { createApp } from '@server/src/create-app.js';
import packageJson from '../package.json' with { type: 'json' };
import { z } from 'zod';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(rootDir, 'apps/cli/src/main.ts');

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

const lockPackageSchema = z.object({
  version: z.string().optional(),
  optional: z.boolean().optional(),
  os: z.unknown().optional(),
  cpu: z.unknown().optional(),
});
const lockFileSchema = z.object({ packages: z.record(lockPackageSchema) });
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

const readLock = (raw: string): z.output<typeof lockFileSchema> => lockFileSchema.parse(JSON.parse(raw));

const readInstalledLock = (): string => {
  try {
    return readFileSync(join(rootDir, 'node_modules/.package-lock.json'), 'utf8');
  } catch {
    return fail('Dependencies are not installed (node_modules/.package-lock.json missing). Run: npm install');
  }
};

const checkLockfileDrift = (): void => {
  const src = readLock(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
  const installed = readLock(readInstalledLock());
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(src.packages)) {
    if (name === '') continue;
    const present = installed.packages[name];
    const platformConditional = entry.optional === true || entry.os !== undefined || entry.cpu !== undefined;
    if (present === undefined) {
      if (!platformConditional) problems.push(`missing: ${name}`);
      continue;
    }
    if (entry.version !== undefined && present.version !== undefined && entry.version !== present.version) {
      problems.push(`version: ${name} lock=${entry.version} installed=${present.version}`);
    }
  }
  for (const name of Object.keys(installed.packages)) {
    if (name !== '' && !(name in src.packages)) problems.push(`extraneous: ${name}`);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('\n  ');
    const rest = problems.length > 10 ? `\n  ...and ${problems.length - 10} more` : '';
    fail(`Installed dependency tree does not match package-lock.json. Run: npm install\n  ${shown}${rest}`);
  }
};

const bootInProcess = async (): Promise<void> => {
  const app = createApp();
  try {
    const response = await app.honoApp.request('/api/health');
    assert(response.ok, `in-process health returned HTTP ${response.status}`);
    const parsed = healthEnvelopeSchema.parse(await response.json());
    assert(parsed.ok, 'in-process health returned an error envelope');
    assert(parsed.data.version === packageJson.version, `in-process health echoed the wrong version: ${parsed.data.version}`);
  } finally {
    await app.dispose();
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
  console.log('smoke: checking lockfile drift...');
  checkLockfileDrift();
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
