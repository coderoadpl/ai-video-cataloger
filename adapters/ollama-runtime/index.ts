import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { z } from 'zod';

import {
  appError,
  ok,
  type AppError,
  type MachineProfile,
  type Result,
} from '@core/domain/index.js';
import type {
  DependencyStatus,
  LocalAiRuntimePort,
  LocalAiRuntimeStatus,
} from '@core/server/index.js';

export const OLLAMA_PINNED_VERSION = 'v0.31.1';
export const OLLAMA_RELEASE_URL =
  `https://github.com/ollama/ollama/releases/download/${OLLAMA_PINNED_VERSION}/ollama-darwin.tgz`;
export const OLLAMA_RELEASE_SHA256 = '0c4f92389fcc1f651c17282e2eaffd68c8d3d06e1f7b307604102ad0e09a10c9';
export const SYSTEM_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const probeTimeoutMs = 1_000;
const serveStartTimeoutMs = 30_000;
const execFileAsync = promisify(execFile);

const runtimeStateSchema = z.object({
  port: z.number().int().min(1),
  pid: z.number().int(),
  version: z.string(),
});

const versionResponseSchema = z.object({
  version: z.string().optional(),
});

const tagsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
  })).default([]),
});

const pullStreamEventSchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
});

type RuntimeState = z.output<typeof runtimeStateSchema>;

export interface OllamaPullProgress {
  tag: string;
  status: string;
  completed: number | null;
  total: number | null;
  percentage: number | null;
}

export interface RuntimeProcess {
  pid?: number | undefined;
  unref(): void;
}

export interface RuntimeProcessManager {
  spawn(command: string, args: readonly string[], options: RuntimeSpawnOptions): RuntimeProcess;
  kill(pid: number, signal: 'SIGTERM'): void;
}

export interface RuntimeSpawnOptions {
  env: NodeJS.ProcessEnv;
  detached: boolean;
  stdio: ['ignore', number, number];
}

export interface ManagedOllamaRuntimeAdapterOptions {
  homeDirectory?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  processManager?: RuntimeProcessManager | undefined;
  extractArchive?: ((archivePath: string, runtimeDirectory: string) => Promise<Result<void, AppError>>) | undefined;
  randomPort?: (() => number) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  nowMs?: (() => number) | undefined;
  machineProfile?: (() => MachineProfile) | undefined;
  onPullProgress?: ((progress: OllamaPullProgress) => void) | undefined;
  releaseUrl?: string | undefined;
  systemBaseUrl?: string | undefined;
}

export class ManagedOllamaRuntimeAdapter implements LocalAiRuntimePort {
  private readonly homeDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly processManager: RuntimeProcessManager;
  private readonly extractArchive: (archivePath: string, runtimeDirectory: string) => Promise<Result<void, AppError>>;
  private readonly randomPort: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly nowMs: () => number;
  private readonly machineProfile: () => MachineProfile;
  private readonly onPullProgress: ((progress: OllamaPullProgress) => void) | undefined;
  private readonly releaseUrl: string;
  private readonly systemBaseUrl: string;

  constructor(options: ManagedOllamaRuntimeAdapterOptions = {}) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.processManager = options.processManager ?? nodeProcessManager;
    this.extractArchive = options.extractArchive ?? extractTarArchive;
    this.randomPort = options.randomPort ?? randomManagedPort;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    this.nowMs = options.nowMs ?? Date.now;
    this.machineProfile = options.machineProfile ?? currentMachineProfile;
    this.onPullProgress = options.onPullProgress;
    this.releaseUrl = options.releaseUrl ?? OLLAMA_RELEASE_URL;
    this.systemBaseUrl = trimTrailingSlash(options.systemBaseUrl ?? SYSTEM_OLLAMA_BASE_URL);
  }

  machine(): Promise<Result<MachineProfile, AppError>> {
    return Promise.resolve(ok(this.machineProfile()));
  }

  async status(): Promise<Result<LocalAiRuntimeStatus, AppError>> {
    const runtime = await this.findRunningRuntime();
    if (runtime === null) {
      return ok({ runtimeUp: false, runtimeVersion: OLLAMA_PINNED_VERSION, installedModels: [] });
    }
    const installed = await this.listModels(runtime.baseUrl);
    if (!installed.ok) return installed;
    return ok({
      runtimeUp: true,
      runtimeVersion: runtime.version,
      installedModels: installed.value,
    });
  }

  async pull(tag: string): Promise<Result<{ tag: string; status: 'installed' }, AppError>> {
    const runtime = await this.ensureRuntime();
    if (!runtime.ok) return runtime;
    const pulled = await this.pullModel(runtime.value.baseUrl, tag);
    if (!pulled.ok) return pulled;
    return ok({ tag, status: 'installed' });
  }

  async rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>> {
    const runtime = await this.findRunningRuntime();
    if (runtime === null) {
      return { ok: false, error: appError('ollama_unavailable', 'Local AI runtime is not running - nothing to remove from') };
    }
    const deleted = await this.deleteModel(runtime.baseUrl, tag);
    if (!deleted.ok) return deleted;
    return ok({ tag, status: 'removed' });
  }

  async stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>> {
    const state = await this.readState();
    if (state === null) return ok({ stopped: false });
    let stopped = false;
    try {
      this.processManager.kill(state.pid, 'SIGTERM');
      stopped = true;
    } catch {
      stopped = false;
    }
    await rm(stateFilePath(this.homeDirectory), { force: true });
    return ok({ stopped });
  }

  async dependency(): Promise<Result<DependencyStatus, AppError>> {
    const runtime = await this.findRunningRuntime();
    if (runtime === null) {
      return ok({
        name: 'ollama',
        available: false,
        version: OLLAMA_PINNED_VERSION,
        source: 'bundled',
        path: managedBinaryPath(this.homeDirectory),
        installHint: 'Local AI runtime starts automatically when needed',
      });
    }
    return ok({
      name: 'ollama',
      available: true,
      version: runtime.managed ? `managed ${runtime.version}` : runtime.version,
      source: runtime.managed ? 'bundled' : 'system',
      path: runtime.baseUrl,
      installHint: '',
    });
  }

  private async ensureRuntime(): Promise<Result<RunningRuntime, AppError>> {
    const system = await this.probeRuntime(this.systemBaseUrl, false, null);
    if (system !== null) return ok(system);

    const state = await this.readState();
    if (state !== null) {
      const managed = await this.probeRuntime(baseUrlForPort(state.port), true, state.version);
      if (managed !== null) return ok(managed);
    }

    return this.startManagedRuntime();
  }

  private async findRunningRuntime(): Promise<RunningRuntime | null> {
    const system = await this.probeRuntime(this.systemBaseUrl, false, null);
    if (system !== null) return system;

    const state = await this.readState();
    if (state === null) return null;
    return this.probeRuntime(baseUrlForPort(state.port), true, state.version);
  }

  private async probeRuntime(baseUrl: string, managed: boolean, fallbackVersion: string | null): Promise<RunningRuntime | null> {
    try {
      const response = await this.fetchImpl(`${baseUrl}/api/version`, {
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json().catch(() => ({}));
      const parsed = versionResponseSchema.safeParse(body);
      return {
        baseUrl,
        managed,
        version: parsed.success ? parsed.data.version ?? fallbackVersion ?? OLLAMA_PINNED_VERSION : fallbackVersion ?? OLLAMA_PINNED_VERSION,
      };
    } catch {
      return null;
    }
  }

  private async startManagedRuntime(): Promise<Result<RunningRuntime, AppError>> {
    const installed = await this.installManagedBinary();
    if (!installed.ok) return installed;

    const port = this.randomPort();
    const baseUrl = baseUrlForPort(port);
    const modelsDir = managedModelsDirectory(this.homeDirectory);
    try {
      await mkdir(modelsDir, { recursive: true });
      await mkdir(appDirectory(this.homeDirectory), { recursive: true });
      const logFd = openSync(logFilePath(this.homeDirectory), 'a');
      const child = this.processManager.spawn(installed.value, ['serve'], {
        env: {
          ...process.env,
          OLLAMA_HOST: `127.0.0.1:${port}`,
          OLLAMA_MODELS: modelsDir,
        },
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();
      const deadline = this.nowMs() + serveStartTimeoutMs;
      while (this.nowMs() < deadline) {
        const runtime = await this.probeRuntime(baseUrl, true, OLLAMA_PINNED_VERSION);
        if (runtime !== null) {
          await this.writeState({ port, pid: child.pid ?? -1, version: OLLAMA_PINNED_VERSION });
          return ok(runtime);
        }
        await this.sleep(250);
      }
      return {
        ok: false,
        error: appError('ollama_unavailable', `Local AI runtime did not start within ${serveStartTimeoutMs / 1000}s`),
      };
    } catch (cause) {
      return { ok: false, error: appError('ollama_unavailable', errorMessage(cause, 'Failed to start local AI runtime'), cause) };
    }
  }

  private async installManagedBinary(): Promise<Result<string, AppError>> {
    const binaryPath = managedBinaryPath(this.homeDirectory);
    if (existsSync(binaryPath)) return ok(binaryPath);

    const runtimeDir = managedRuntimeDirectory(this.homeDirectory);
    const tempTarball = path.join(runtimeDir, 'download.tmp.tgz');
    try {
      await mkdir(runtimeDir, { recursive: true });
      await rm(tempTarball, { force: true });
      const response = await this.fetchImpl(this.releaseUrl, { redirect: 'follow' });
      if (!response.ok || response.body === null) {
        return { ok: false, error: appError('ollama_unavailable', `Failed to download the local AI runtime (HTTP ${response.status})`) };
      }
      const downloaded = await readResponseBody(response.body);
      const actualSha256 = createHash('sha256').update(downloaded).digest('hex');
      await writeFile(tempTarball, downloaded);
      if (actualSha256 !== OLLAMA_RELEASE_SHA256) {
        await rm(tempTarball, { force: true });
        return {
          ok: false,
          error: appError('ollama_unavailable', 'Local AI runtime download failed checksum verification', {
            expectedSha256: OLLAMA_RELEASE_SHA256,
            actualSha256,
          }),
        };
      }
      const extracted = await this.extractArchive(tempTarball, runtimeDir);
      await rm(tempTarball, { force: true });
      if (!extracted.ok) return extracted;
      if (!existsSync(binaryPath)) {
        return { ok: false, error: appError('ollama_unavailable', 'Local AI runtime archive did not contain the expected binary') };
      }
      return ok(binaryPath);
    } catch (cause) {
      await rm(tempTarball, { force: true });
      return { ok: false, error: appError('ollama_unavailable', errorMessage(cause, 'Failed to install local AI runtime'), cause) };
    }
  }

  private async readState(): Promise<RuntimeState | null> {
    try {
      const raw = await readFile(stateFilePath(this.homeDirectory), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const state = runtimeStateSchema.safeParse(parsed);
      return state.success ? state.data : null;
    } catch {
      return null;
    }
  }

  private async writeState(state: RuntimeState): Promise<void> {
    await mkdir(appDirectory(this.homeDirectory), { recursive: true });
    await writeFile(stateFilePath(this.homeDirectory), JSON.stringify(state, null, 2), 'utf8');
  }

  private async listModels(baseUrl: string): Promise<Result<string[], AppError>> {
    const response = await this.request(baseUrl, '/api/tags', { method: 'GET' });
    if (!response.ok) return response;
    if (!response.value.ok) {
      return { ok: false, error: appError('ollama_unavailable', `Local AI runtime not reachable at ${baseUrl}: HTTP ${response.value.status}`) };
    }
    const body = await parseJson(response.value);
    if (!body.ok) return body;
    const parsed = tagsResponseSchema.safeParse(body.value);
    if (!parsed.success) return { ok: false, error: appError('ollama_unavailable', 'Local AI runtime returned invalid model list') };
    return ok(parsed.data.models.map((model) => model.name));
  }

  private async pullModel(baseUrl: string, tag: string): Promise<Result<void, AppError>> {
    const response = await this.request(baseUrl, '/api/pull', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: tag, stream: true }),
    });
    if (!response.ok) return response;
    if (response.value.status === 404) return { ok: false, error: appError('model_not_installed', `Model not found: ${tag}`) };
    if (!response.value.ok || response.value.body === null) {
      return { ok: false, error: appError('ollama_unavailable', `Local AI runtime not reachable at ${baseUrl}: HTTP ${response.value.status}`) };
    }
    return this.readPullStream(response.value.body, tag);
  }

  private async deleteModel(baseUrl: string, tag: string): Promise<Result<void, AppError>> {
    const response = await this.request(baseUrl, '/api/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: tag }),
    });
    if (!response.ok) return response;
    if (response.value.status === 404) return { ok: false, error: appError('model_not_installed', `Model not installed: ${tag}`) };
    if (!response.value.ok) {
      return { ok: false, error: appError('ollama_unavailable', `Local AI runtime not reachable at ${baseUrl}: HTTP ${response.value.status}`) };
    }
    return ok(undefined);
  }

  private async request(baseUrl: string, urlPath: string, init: RequestInit): Promise<Result<Response, AppError>> {
    try {
      const response = await this.fetchImpl(`${baseUrl}${urlPath}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
      return ok(response);
    } catch (cause) {
      return { ok: false, error: appError('ollama_unavailable', unavailableMessage(baseUrl, cause), cause) };
    }
  }

  private async readPullStream(body: ReadableStream<Uint8Array>, tag: string): Promise<Result<void, AppError>> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      const parsed = this.parsePullLines(buffered, tag);
      buffered = parsed.remaining;
      if (!parsed.result.ok) return parsed.result;
    }
    if (buffered.trim().length === 0) return ok(undefined);
    return this.handlePullLine(buffered.trim(), tag);
  }

  private parsePullLines(buffered: string, tag: string): { remaining: string; result: Result<void, AppError> } {
    let remaining = buffered;
    while (true) {
      const newlineIndex = remaining.indexOf('\n');
      if (newlineIndex < 0) return { remaining, result: ok(undefined) };
      const line = remaining.slice(0, newlineIndex).trim();
      remaining = remaining.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      const handled = this.handlePullLine(line, tag);
      if (!handled.ok) return { remaining, result: handled };
    }
  }

  private handlePullLine(line: string, tag: string): Result<void, AppError> {
    let body: unknown;
    try {
      body = JSON.parse(line);
    } catch {
      return ok(undefined);
    }
    const parsed = pullStreamEventSchema.safeParse(body);
    if (!parsed.success) return ok(undefined);
    if (parsed.data.error !== undefined) {
      return {
        ok: false,
        error: modelError(parsed.data.error)
          ? appError('model_not_installed', `Model pull failed: ${parsed.data.error}`)
          : appError('ollama_unavailable', `Model pull failed: ${parsed.data.error}`),
      };
    }
    const total = parsed.data.total ?? null;
    const completed = parsed.data.completed ?? null;
    this.onPullProgress?.({
      tag,
      status: parsed.data.status ?? '',
      completed,
      total,
      percentage: total === null || total <= 0 || completed === null ? null : Math.min(100, Math.round((completed / total) * 100)),
    });
    return ok(undefined);
  }
}

export interface RunningRuntime {
  baseUrl: string;
  managed: boolean;
  version: string;
}

export const appDirectory = (homeDirectory: string): string =>
  path.join(homeDirectory, '.ai-video-cataloger');

export const managedRuntimeDirectory = (homeDirectory: string): string =>
  path.join(appDirectory(homeDirectory), 'runtime', `ollama-${OLLAMA_PINNED_VERSION}`);

export const managedBinaryPath = (homeDirectory: string): string =>
  path.join(managedRuntimeDirectory(homeDirectory), 'ollama');

export const managedModelsDirectory = (homeDirectory: string): string =>
  path.join(appDirectory(homeDirectory), 'models', 'ollama');

export const stateFilePath = (homeDirectory: string): string =>
  path.join(appDirectory(homeDirectory), 'ollama-runtime.json');

export const logFilePath = (homeDirectory: string): string =>
  path.join(appDirectory(homeDirectory), 'ollama.log');

const readResponseBody = async (body: ReadableStream<Uint8Array>): Promise<Buffer> => {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(Buffer.from(chunk.value));
  }
  return Buffer.concat(chunks);
};

const parseJson = async (response: Response): Promise<Result<unknown, AppError>> => {
  try {
    const body: unknown = await response.json();
    return ok(body);
  } catch (cause) {
    return { ok: false, error: appError('ollama_unavailable', errorMessage(cause, 'Local AI runtime returned invalid JSON'), cause) };
  }
};

const modelError = (message: string): boolean =>
  /not found|file does not exist/i.test(message);

const baseUrlForPort = (port: number): string =>
  `http://127.0.0.1:${port}`;

const trimTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const randomManagedPort = (): number =>
  9000 + Math.floor(Math.random() * 1000);

const currentMachineProfile = (): MachineProfile => ({
  platform: process.platform,
  arch: process.arch,
  ramGb: Math.round(totalmem() / 1024 / 1024 / 1024),
});

const unavailableMessage = (baseUrl: string, cause: unknown): string =>
  `Local AI runtime not reachable at ${baseUrl}: ${errorMessage(cause, 'request failed')}`;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

const extractTarArchive = async (archivePath: string, runtimeDirectory: string): Promise<Result<void, AppError>> => {
  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', runtimeDirectory]);
    return ok(undefined);
  } catch (cause) {
    return { ok: false, error: appError('ollama_unavailable', errorMessage(cause, 'Failed to extract local AI runtime'), cause) };
  }
};

const nodeProcessManager: RuntimeProcessManager = {
  spawn: (command, args, options) => spawn(command, [...args], options),
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
};
