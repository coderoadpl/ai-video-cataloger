import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import { createApp } from '@server/src/create-app.js';
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
const run = (args: string[], env: NodeJS.ProcessEnv): Promise<Run> =>
  new Promise((resolve) => {
    // Spawn a real node process running the CLI through tsx: the actual entry an agent uses.
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env },
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

interface LockPackage {
  version?: string;
  optional?: boolean;
  os?: unknown;
  cpu?: unknown;
}
interface LockFile {
  packages: Record<string, LockPackage>;
}
const readLock = (raw: string): LockFile => JSON.parse(raw);

const checkLockfileDrift = (): void => {
  const src = readLock(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
  let installedRaw: string;
  try {
    installedRaw = readFileSync(join(rootDir, 'node_modules/.package-lock.json'), 'utf8');
  } catch {
    throw new SmokeFailure(
      'Dependencies are not installed (node_modules/.package-lock.json missing). Run: npm install',
    );
  }
  const installed = readLock(installedRaw);
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(src.packages)) {
    if (name === '') continue;
    const present = installed.packages[name];
    const platformConditional =
      entry.optional === true || entry.os !== undefined || entry.cpu !== undefined;
    if (!present) {
      if (!platformConditional) problems.push(`missing: ${name}`);
      continue;
    }
    if (
      entry.version !== undefined &&
      present.version !== undefined &&
      entry.version !== present.version
    ) {
      problems.push(`version: ${name} lock=${entry.version} installed=${present.version}`);
    }
  }
  for (const name of Object.keys(installed.packages)) {
    if (name === '') continue;
    if (!(name in src.packages)) problems.push(`extraneous: ${name}`);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('\n  ');
    const rest = problems.length > 10 ? `\n  ...and ${problems.length - 10} more` : '';
    fail(`Installed dependency tree does not match package-lock.json. Run: npm install\n  ${shown}${rest}`);
  }
};

const okEnvelope = z.object({ ok: z.literal(true), data: z.unknown() });
const errEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
const envelope = z.discriminatedUnion('ok', [okEnvelope, errEnvelope]);
const healthSchema = z.object({ status: z.literal('ok'), version: z.string() });

const readEnvelope = (result: Run, label: string): unknown => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(`${label}: stdout was not a JSON envelope.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
};

const bootInProcess = async (): Promise<void> => {
  const app = createApp({ version: '0.1.0-smoke' });
  try {
    const response = await app.honoApp.request('/api/health');
    assert(response.ok, `in-process health returned HTTP ${response.status}`);
    const parsed = envelope.parse(await response.json());
    assert(parsed.ok, 'in-process health returned an error envelope');
    const health = healthSchema.parse(parsed.data);
    assert(health.version === '0.1.0-smoke', `in-process health echoed the wrong version: ${health.version}`);
  } finally {
    await app.dispose();
  }
};

const driveCli = async (home: string): Promise<void> => {
  const healthRun = await run(['--json', 'health'], { HOME: home });
  assert(
    healthRun.code === 0,
    `cli health: expected exit 0, got ${healthRun.code}.\nstdout: ${healthRun.stdout}\nstderr: ${healthRun.stderr}`,
  );
  const healthEnvelope = envelope.parse(readEnvelope(healthRun, 'cli health'));
  assert(healthEnvelope.ok, 'cli health: expected an ok envelope, got an error');
  const health = healthSchema.parse(healthEnvelope.data);
  assert(health.status === 'ok', `cli health degraded: status=${health.status}`);

  const failRun = await run(['--json', '__fail'], { HOME: home });
  const expectedCode = EXIT_CODE_BY_ERROR_CODE.not_found;
  assert(
    failRun.code === expectedCode,
    `cli __fail: expected taxonomy exit ${expectedCode}, got ${failRun.code}.\nstdout: ${failRun.stdout}\nstderr: ${failRun.stderr}`,
  );
  const failEnvelope = envelope.parse(readEnvelope(failRun, 'cli __fail'));
  assert(!failEnvelope.ok, 'cli __fail: expected an error envelope, got ok');
  assert(
    failEnvelope.error.code === 'not_found',
    `cli __fail: expected error code "not_found", got "${failEnvelope.error.code}"`,
  );
};

const startedAt = Date.now();
const tempDirs: string[] = [];
try {
  console.log('smoke: checking lockfile drift...');
  checkLockfileDrift();
  console.log('smoke: booting the in-process app via createApp...');
  await bootInProcess();
  console.log('smoke: driving the CLI...');
  const home = mkdtempSync(join(tmpdir(), 'avc-smoke-'));
  tempDirs.push(home);
  await driveCli(home);
  console.log(`\nsmoke: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}
