/**
 * Managed Ollama runtime.
 *
 * The user installs nothing by hand: when the local analyzer is used we
 * (1) prefer a user-owned system daemon at 127.0.0.1:11434 if it responds,
 * (2) otherwise reuse our own previously started daemon (state file),
 * (3) otherwise download the PINNED standalone release once (sha256-verified,
 *     tmp+rename like the whisper model downloads), extract it into the app
 *     dir and start `ollama serve` on a random high port with a private
 *     OLLAMA_MODELS directory.
 *
 * The release tarball contains the `ollama` binary plus its sibling
 * llama-server/dylibs, so the WHOLE archive is extracted into a versioned
 * directory and the binary must run from there.
 */

import { spawn } from 'node:child_process';
import { execa } from 'execa';
import {
  createWriteStream, existsSync, mkdirSync, openSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CodedError } from './json-output.js';

export const OLLAMA_PINNED_VERSION = 'v0.31.1';
const OLLAMA_RELEASE_URL =
  `https://github.com/ollama/ollama/releases/download/${OLLAMA_PINNED_VERSION}/ollama-darwin.tgz`;
// sha256 of ollama-darwin.tgz for the pinned version (verified at pin time)
const OLLAMA_RELEASE_SHA256 =
  '0c4f92389fcc1f651c17282e2eaffd68c8d3d06e1f7b307604102ad0e09a10c9';

const SYSTEM_BASE_URL = 'http://127.0.0.1:11434';
const PROBE_TIMEOUT_MS = 1_000;
const SERVE_START_TIMEOUT_MS = 30_000;

export type RuntimeEvent = { status: string; percent?: number | null };
export type RuntimeEventCallback = (event: RuntimeEvent) => void;

export interface LocalRuntime {
  baseUrl: string;
  /** True when the daemon is the one we installed/started ourselves. */
  managed: boolean;
}

function appDir(): string {
  return join(homedir(), '.ai-video-cataloger');
}

/** Versioned directory holding the extracted release (binary + dylibs). */
export function getManagedRuntimeDir(): string {
  return join(appDir(), 'runtime', `ollama-${OLLAMA_PINNED_VERSION}`);
}

export function getManagedBinaryPath(): string {
  return join(getManagedRuntimeDir(), 'ollama');
}

function getModelsDir(): string {
  return join(appDir(), 'models', 'ollama');
}

function getStateFilePath(): string {
  return join(appDir(), 'ollama-runtime.json');
}

function getLogFilePath(): string {
  return join(appDir(), 'ollama.log');
}

interface RuntimeState {
  port: number;
  pid: number;
  version: string;
}

/** Probe an Ollama base url; true when it answers /api/version quickly. */
export async function probeDaemon(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** A user-owned system daemon on the default port, when present. */
export async function detectSystemDaemon(): Promise<string | null> {
  return (await probeDaemon(SYSTEM_BASE_URL)) ? SYSTEM_BASE_URL : null;
}

function readState(): RuntimeState | null {
  try {
    const raw = readFileSync(getStateFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as RuntimeState;
    if (typeof parsed.port !== 'number' || typeof parsed.pid !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Download + verify + extract the pinned release into the versioned dir. */
export async function installManagedBinary(onEvent?: RuntimeEventCallback): Promise<string> {
  const binaryPath = getManagedBinaryPath();
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const runtimeDir = getManagedRuntimeDir();
  mkdirSync(runtimeDir, { recursive: true });
  const tgzPath = join(runtimeDir, 'download.tmp.tgz');

  onEvent?.({ status: `Downloading local AI runtime (Ollama ${OLLAMA_PINNED_VERSION}, ~123 MB)...` });
  const response = await fetch(OLLAMA_RELEASE_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new CodedError(
      `Failed to download the local AI runtime (HTTP ${response.status})`,
      'OLLAMA_UNAVAILABLE'
    );
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    createWriteStream(tgzPath)
  );

  const digest = createHash('sha256').update(readFileSync(tgzPath)).digest('hex');
  if (digest !== OLLAMA_RELEASE_SHA256) {
    rmSync(tgzPath, { force: true });
    throw new CodedError(
      `Local AI runtime download failed checksum verification (got ${digest})`,
      'OLLAMA_UNAVAILABLE'
    );
  }

  onEvent?.({ status: 'Installing local AI runtime...' });
  await execa('tar', ['-xzf', tgzPath, '-C', runtimeDir]);
  rmSync(tgzPath, { force: true });

  if (!existsSync(binaryPath)) {
    throw new CodedError(
      'Local AI runtime archive did not contain the expected binary',
      'OLLAMA_UNAVAILABLE'
    );
  }
  return binaryPath;
}

async function startManagedDaemon(onEvent?: RuntimeEventCallback): Promise<LocalRuntime> {
  const binaryPath = await installManagedBinary(onEvent);
  const port = 9000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;

  mkdirSync(getModelsDir(), { recursive: true });
  onEvent?.({ status: 'Starting local AI runtime...' });

  const logFd = openSync(getLogFilePath(), 'a');
  const child = spawn(binaryPath, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${port}`,
      OLLAMA_MODELS: getModelsDir(),
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  const deadline = Date.now() + SERVE_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeDaemon(baseUrl)) {
      const state: RuntimeState = {
        port,
        pid: child.pid ?? -1,
        version: OLLAMA_PINNED_VERSION,
      };
      writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2));
      return { baseUrl, managed: true };
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }

  throw new CodedError(
    `Local AI runtime did not start within ${SERVE_START_TIMEOUT_MS / 1000}s (see ${getLogFilePath()})`,
    'OLLAMA_UNAVAILABLE'
  );
}

/**
 * Ensure SOME reachable runtime and return its base url.
 * Preference: system daemon > our previously started daemon > start fresh.
 */
export async function ensureLocalRuntime(onEvent?: RuntimeEventCallback): Promise<LocalRuntime> {
  const system = await detectSystemDaemon();
  if (system) {
    return { baseUrl: system, managed: false };
  }

  const state = readState();
  if (state) {
    const baseUrl = `http://127.0.0.1:${state.port}`;
    if (await probeDaemon(baseUrl)) {
      return { baseUrl, managed: true };
    }
  }

  return startManagedDaemon(onEvent);
}

/**
 * Best-effort view of an already-running runtime WITHOUT starting anything
 * (doctor / models list use this - they must never trigger downloads).
 */
export async function findRunningRuntime(): Promise<LocalRuntime | null> {
  const system = await detectSystemDaemon();
  if (system) return { baseUrl: system, managed: false };
  const state = readState();
  if (state) {
    const baseUrl = `http://127.0.0.1:${state.port}`;
    if (await probeDaemon(baseUrl)) return { baseUrl, managed: true };
  }
  return null;
}

/** Stop the daemon we started (never touches a user-owned system daemon). */
export function stopManagedDaemon(): boolean {
  const state = readState();
  if (!state) return false;
  let stopped = false;
  try {
    process.kill(state.pid, 'SIGTERM');
    stopped = true;
  } catch {
    // already dead
  }
  rmSync(getStateFilePath(), { force: true });
  return stopped;
}
