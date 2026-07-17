import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@core/domain/index.js';

import {
  ManagedOllamaRuntimeAdapter,
  managedBinaryPath,
  managedModelsDirectory,
  managedRuntimeDirectory,
  stateFilePath,
  type OllamaPullProgress,
  type RuntimeProcess,
  type RuntimeProcessManager,
  type RuntimeSpawnOptions,
} from './index.js';

const tempRoots: string[] = [];
const closers: Array<() => Promise<void>> = [];
const fakeEndpoints = new Map<string, (url: URL, init?: RequestInit) => Promise<Response>>();
let nextFakePort = 20_000;

describe('ManagedOllamaRuntimeAdapter', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(closers.map((close) => close()));
    closers.length = 0;
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('prefers the system daemon before a managed state file', async () => {
    const home = await tempRoot();
    const managed = await startFakeOllamaServer({ version: 'managed', models: ['gemma3:4b'] });
    const system = await startFakeOllamaServer({ version: 'system', models: ['gemma3:12b'] });
    await mkdir(path.dirname(stateFilePath(home)), { recursive: true });
    await writeFile(stateFilePath(home), JSON.stringify({
      port: managed.port,
      pid: 123,
      version: 'v0.31.1',
      binaryPath: managedBinaryPath(home),
    }), 'utf8');
    const adapter = new ManagedOllamaRuntimeAdapter({ homeDirectory: home, systemBaseUrl: system.origin, fetchImpl: fakeFetch });

    const status = await adapter.status();

    expect(status).toEqual(ok({ runtimeUp: true, runtimeVersion: 'system', installedModels: ['gemma3:12b'] }));
    expect(system.requests.map((request) => request.url)).toEqual(['/api/version', '/api/tags']);
    expect(managed.requests).toEqual([]);
  });

  it('reuses a managed state file when the system daemon is absent', async () => {
    const home = await tempRoot();
    const managed = await startFakeOllamaServer({ version: 'managed-state', models: ['qwen2.5vl:7b'] });
    await mkdir(path.dirname(stateFilePath(home)), { recursive: true });
    await writeFile(stateFilePath(home), JSON.stringify({
      port: managed.port,
      pid: 456,
      version: 'v0.31.1',
      binaryPath: managedBinaryPath(home),
    }), 'utf8');
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      systemBaseUrl: 'http://127.0.0.1:1',
      fetchImpl: fakeFetch,
    });

    const status = await adapter.status();

    expect(status).toEqual(ok({ runtimeUp: true, runtimeVersion: 'managed-state', installedModels: ['qwen2.5vl:7b'] }));
    expect(managed.requests.map((request) => request.url)).toEqual(['/api/version', '/api/tags']);
  });

  it('downloads to download.tmp.tgz, rejects checksum mismatches, and leaves no runtime binary', async () => {
    const home = await tempRoot();
    const release = await startStaticServer(Buffer.from('not-the-pinned-archive'));
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      systemBaseUrl: 'http://127.0.0.1:1',
      releaseUrl: `${release.origin}/download.tmp.tgz`,
      fetchImpl: fakeFetch,
    });

    const result = await adapter.pull('gemma3:12b');

    expect(result).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
    expect(existsSync(path.join(managedRuntimeDirectory(home), 'download.tmp.tgz'))).toBe(false);
    expect(existsSync(managedBinaryPath(home))).toBe(false);
    expect(release.requests).toEqual([{ method: 'GET', url: '/download.tmp.tgz' }]);
  });

  it('starts managed runtime with private env, writes state, and stops only the managed pid', async () => {
    const home = await tempRoot();
    await mkdir(path.dirname(managedBinaryPath(home)), { recursive: true });
    await writeFile(managedBinaryPath(home), 'binary', 'utf8');
    const processManager = new AutoStartOllamaProcessManager();
    closers.push(() => processManager.close());
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      systemBaseUrl: 'http://127.0.0.1:1',
      processManager,
      randomPort: () => 9786,
      fetchImpl: fakeFetch,
      sleep: (milliseconds) => new Promise((resolve) => {
        setTimeout(resolve, Math.min(milliseconds, 5));
      }),
    });

    const pulled = await adapter.pull('gemma3:12b');
    const stateRaw = await readFile(stateFilePath(home), 'utf8');
    const stopped = await adapter.stopManagedDaemon();

    expect(pulled).toEqual(ok({ tag: 'gemma3:12b', status: 'installed' }));
    expect(JSON.parse(stateRaw)).toEqual({
      port: 9786,
      pid: 4321,
      version: 'v0.31.1',
      binaryPath: managedBinaryPath(home),
    });
    expect(processManager.spawnCalls).toEqual([
      {
        command: managedBinaryPath(home),
        args: ['serve'],
        host: '127.0.0.1:9786',
        models: managedModelsDirectory(home),
        detached: true,
      },
    ]);
    expect(stopped).toEqual(ok({ stopped: true }));
    expect(processManager.killed).toEqual([{ pid: 4321, signal: 'SIGTERM' }]);
    expect(existsSync(stateFilePath(home))).toBe(false);
  });

  it('starts the managed daemon on demand and returns its dynamic base URL', async () => {
    const home = await tempRoot();
    await mkdir(path.dirname(managedBinaryPath(home)), { recursive: true });
    await writeFile(managedBinaryPath(home), 'binary', 'utf8');
    const processManager = new AutoStartOllamaProcessManager();
    closers.push(() => processManager.close());
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      systemBaseUrl: 'http://127.0.0.1:1',
      processManager,
      randomPort: () => 9347,
      fetchImpl: fakeFetch,
      sleep: (milliseconds) => new Promise((resolve) => {
        setTimeout(resolve, Math.min(milliseconds, 5));
      }),
    });

    const result = await adapter.ensure();

    expect(result).toEqual(ok({ baseUrl: 'http://127.0.0.1:9347' }));
    expect(processManager.spawnCalls).toEqual([
      {
        command: managedBinaryPath(home),
        args: ['serve'],
        host: '127.0.0.1:9347',
        models: managedModelsDirectory(home),
        detached: true,
      },
    ]);
  });

  it('reports pull progress from completed and total and maps pull errors', async () => {
    const progress: OllamaPullProgress[] = [];
    const server = await startFakeOllamaServer({
      version: '0.31.1',
      models: [],
      pullLines: [
        { status: 'pulling manifest' },
        { status: 'downloading', completed: 25, total: 100 },
        { status: 'downloading', completed: 100, total: 100 },
      ],
    });
    const adapter = new ManagedOllamaRuntimeAdapter({
      systemBaseUrl: server.origin,
      onPullProgress: (event) => progress.push(event),
      fetchImpl: fakeFetch,
    });

    const result = await adapter.pull('gemma3:12b');

    expect(result).toEqual(ok({ tag: 'gemma3:12b', status: 'installed' }));
    expect(progress).toEqual([
      { tag: 'gemma3:12b', status: 'pulling manifest', completed: null, total: null, percentage: null },
      { tag: 'gemma3:12b', status: 'downloading', completed: 25, total: 100, percentage: 25 },
      { tag: 'gemma3:12b', status: 'downloading', completed: 100, total: 100, percentage: 100 },
    ]);

    server.pullStatus = 404;
    const missing = await adapter.pull('missing:model');
    expect(missing).toMatchObject({ ok: false, error: { code: 'model_not_installed' } });

    server.pullStatus = 500;
    const unavailable = await adapter.pull('gemma3:12b');
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
  });

  it('passes cancellation to the lifetime of the Ollama pull request', async () => {
    const pullSignals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      if (String(input).endsWith('/api/version')) {
        return Promise.resolve(new Response(JSON.stringify({ version: '0.31.1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      }
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) return Promise.reject(new Error('Missing pull signal'));
      pullSignals.push(signal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (signal.aborted) {
            controller.error(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const adapter = new ManagedOllamaRuntimeAdapter({ fetchImpl });
    const controller = new AbortController();
    const pulling = adapter.pull('gemma3:12b', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    const result = await pulling;

    expect(pullSignals[0]?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
  });

  it('does not abort a streaming pull after more than ten seconds', async () => {
    vi.useFakeTimers();
    let pullSignal: AbortSignal | null = null;
    const fetchImpl: typeof fetch = (input, init) => {
      if (String(input).endsWith('/api/version')) {
        return Promise.resolve(new Response(JSON.stringify({ version: '0.31.1' }), { status: 200 }));
      }
      const signal = init?.signal;
      pullSignal = signal instanceof AbortSignal ? signal : null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = (): void => controller.error(new Error('aborted'));
          signal?.addEventListener('abort', abort, { once: true });
          setTimeout(() => {
            if (signal?.aborted === true) return;
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ status: 'success' })}\n`));
            controller.close();
          }, 10_001);
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const adapter = new ManagedOllamaRuntimeAdapter({ fetchImpl });

    const pulling = adapter.pull('gemma3:12b');
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(pulling).resolves.toEqual(ok({ tag: 'gemma3:12b', status: 'installed' }));
    expect(pullSignal).toBeNull();
  });

  it('reports local AI as feasible on Apple Silicon when runtime is down', async () => {
    const adapter = new ManagedOllamaRuntimeAdapter({
      fetchImpl: () => Promise.reject(new Error('offline')),
      machineProfile: () => ({ platform: 'darwin', arch: 'arm64', ramGb: 16 }),
    });

    const result = await adapter.dependency();

    expect(result).toEqual(ok({
      name: 'local-ai',
      available: true,
      version: 'auto-managed (not running - starts when needed)',
      source: 'bundled',
      path: null,
      installHint: '',
    }));
  });

  it('reports no installed models from an unreachable runtime without starting it', async () => {
    const home = await tempRoot();
    const processManager = new AutoStartOllamaProcessManager();
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      fetchImpl: () => Promise.reject(new Error('offline')),
      processManager,
      machineProfile: () => ({ platform: 'darwin', arch: 'arm64', ramGb: 16 }),
    });

    const result = await adapter.status();

    expect(result).toEqual(ok({
      runtimeUp: false,
      runtimeVersion: 'v0.31.1',
      installedModels: [],
    }));
    expect(processManager.spawnCalls).toEqual([]);
    expect(existsSync(managedRuntimeDirectory(home))).toBe(false);
  });

  it('reports local AI unavailable with a platform hint off Apple Silicon', async () => {
    const adapter = new ManagedOllamaRuntimeAdapter({
      machineProfile: () => ({ platform: 'linux', arch: 'x64', ramGb: 16 }),
    });

    const result = await adapter.dependency();

    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'local-ai',
        available: false,
        installHint: expect.stringContaining('Apple Silicon'),
      },
    });
  });

  it('refuses invalid and identity-mismatched managed daemon pids', async () => {
    const home = await tempRoot();
    const processManager = new ManualProcessManager('/unrelated/process');
    await mkdir(path.dirname(stateFilePath(home)), { recursive: true });
    await writeFile(stateFilePath(home), JSON.stringify({
      port: 9786,
      pid: -1,
      version: 'v0.31.1',
      binaryPath: managedBinaryPath(home),
    }), 'utf8');
    const adapter = new ManagedOllamaRuntimeAdapter({ homeDirectory: home, processManager });

    const invalid = await adapter.stopManagedDaemon();
    await writeFile(stateFilePath(home), JSON.stringify({
      port: 9786,
      pid: 4321,
      version: 'v0.31.1',
      binaryPath: managedBinaryPath(home),
    }), 'utf8');
    const mismatched = await adapter.stopManagedDaemon();

    expect(invalid).toEqual(ok({ stopped: false }));
    expect(mismatched).toEqual(ok({ stopped: false }));
    expect(processManager.killed).toEqual([]);
  });

  it('refuses to persist a managed runtime without a positive pid', async () => {
    const home = await tempRoot();
    await mkdir(path.dirname(managedBinaryPath(home)), { recursive: true });
    await writeFile(managedBinaryPath(home), 'binary', 'utf8');
    const processManager = new AutoStartOllamaProcessManager(-1);
    closers.push(() => processManager.close());
    const adapter = new ManagedOllamaRuntimeAdapter({
      homeDirectory: home,
      systemBaseUrl: 'http://127.0.0.1:1',
      processManager,
      randomPort: () => 9787,
      fetchImpl: fakeFetch,
    });

    const result = await adapter.pull('gemma3:12b');

    expect(result).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
    expect(existsSync(stateFilePath(home))).toBe(false);
  });

  it('maps delete errors and does not stop a user-owned system daemon', async () => {
    const system = await startFakeOllamaServer({ version: '0.31.1', models: ['gemma3:12b'] });
    const processManager = new ManualProcessManager();
    const adapter = new ManagedOllamaRuntimeAdapter({
      systemBaseUrl: system.origin,
      processManager,
      fetchImpl: fakeFetch,
    });

    const removed = await adapter.rm('gemma3:12b');
    system.deleteStatus = 404;
    const missing = await adapter.rm('missing:model');
    system.deleteStatus = 500;
    const unavailable = await adapter.rm('gemma3:12b');
    const stopped = await adapter.stopManagedDaemon();

    expect(removed).toEqual(ok({ tag: 'gemma3:12b', status: 'removed' }));
    expect(missing).toMatchObject({ ok: false, error: { code: 'model_not_installed' } });
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
    expect(stopped).toEqual(ok({ stopped: false }));
    expect(processManager.killed).toEqual([]);
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'ollama-runtime-adapter-'));
  tempRoots.push(root);
  return root;
};

interface RequestRecord {
  method: string;
  url: string;
  body: unknown;
}

interface FakeOllamaServer {
  origin: string;
  port: number;
  requests: RequestRecord[];
  pullStatus: number;
  deleteStatus: number;
  close(): Promise<void>;
}

const startFakeOllamaServer = async (options: {
  version: string;
  models: string[];
  pullLines?: Array<Record<string, string | number>> | undefined;
}): Promise<FakeOllamaServer> => {
  const requests: RequestRecord[] = [];
  const mutable = {
    pullStatus: 200,
    deleteStatus: 200,
  };
  const port = nextFakePort++;
  const origin = `http://127.0.0.1:${port}`;
  const unregister = registerFakeOllamaEndpoint(origin, options, mutable, requests);
  const fake: FakeOllamaServer = {
    origin,
    port,
    requests,
    get pullStatus() {
      return mutable.pullStatus;
    },
    set pullStatus(value: number) {
      mutable.pullStatus = value;
    },
    get deleteStatus() {
      return mutable.deleteStatus;
    },
    set deleteStatus(value: number) {
      mutable.deleteStatus = value;
    },
    close: async () => unregister(),
  };
  closers.push(fake.close);
  return fake;
};

const startStaticServer = async (
  body: Buffer,
): Promise<{ origin: string; requests: Array<{ method: string; url: string }>; close: () => Promise<void> }> => {
  const requests: Array<{ method: string; url: string }> = [];
  const origin = `http://127.0.0.1:${nextFakePort++}`;
  fakeEndpoints.set(origin, (url, init) => {
    requests.push({ method: init?.method ?? 'GET', url: `${url.pathname}${url.search}` });
    return Promise.resolve(new Response(Uint8Array.from(body).buffer, {
      status: 200,
      headers: { 'content-length': String(body.length) },
    }));
  });
  const fake = {
    origin,
    requests,
    close: async () => {
      fakeEndpoints.delete(origin);
    },
  };
  closers.push(fake.close);
  return fake;
};

class AutoStartOllamaProcessManager implements RuntimeProcessManager {
  readonly spawnCalls: Array<{ command: string; args: string[]; host: string | null; models: string | null; detached: boolean }> = [];
  readonly killed: Array<{ pid: number; signal: 'SIGTERM' }> = [];
  private readonly unregisterEndpoints: Array<() => void> = [];

  constructor(private readonly pid: number | undefined = 4321) {}

  spawn(command: string, args: readonly string[], options: RuntimeSpawnOptions): RuntimeProcess {
    const host = options.env.OLLAMA_HOST ?? null;
    const models = options.env.OLLAMA_MODELS ?? null;
    this.spawnCalls.push({ command, args: [...args], host, models, detached: options.detached });
    if (host !== null && (this.pid ?? 0) > 0) {
      const portText = host.split(':')[1];
      if (portText === undefined) throw new Error('Expected OLLAMA_HOST port');
      const origin = `http://127.0.0.1:${portText}`;
      this.unregisterEndpoints.push(registerFakeOllamaEndpoint(
        origin,
        { version: '0.31.1', models: [], pullLines: [{ status: 'success' }] },
        { pullStatus: 200, deleteStatus: 200 },
        [],
      ));
    }
    return {
      pid: this.pid,
      unref: () => undefined,
    };
  }

  command(): Promise<string | null> {
    return Promise.resolve(this.spawnCalls[0]?.command ?? null);
  }

  kill(pid: number, signal: 'SIGTERM'): void {
    this.killed.push({ pid, signal });
  }

  async close(): Promise<void> {
    this.unregisterEndpoints.forEach((unregister) => unregister());
    this.unregisterEndpoints.length = 0;
  }
}

class ManualProcessManager implements RuntimeProcessManager {
  readonly killed: Array<{ pid: number; signal: 'SIGTERM' }> = [];

  constructor(private readonly commandValue: string | null = null) {}

  spawn(): RuntimeProcess {
    return {
      pid: 1,
      unref: () => undefined,
    };
  }

  command(): Promise<string | null> {
    return Promise.resolve(this.commandValue);
  }

  kill(pid: number, signal: 'SIGTERM'): void {
    this.killed.push({ pid, signal });
  }
}

const fakeFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const endpoint = fakeEndpoints.get(url.origin);
  return endpoint === undefined
    ? Promise.reject(new Error(`No fake endpoint registered for ${url.origin}`))
    : endpoint(url, init);
};

const registerFakeOllamaEndpoint = (
  origin: string,
  options: { version: string; models: string[]; pullLines?: Array<Record<string, string | number>> | undefined },
  mutable: { pullStatus: number; deleteStatus: number },
  requests: RequestRecord[],
): (() => void) => {
  fakeEndpoints.set(origin, (url, init) => {
    const body: unknown = init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body));
    const requestPath = `${url.pathname}${url.search}`;
    requests.push({ method: init?.method ?? 'GET', url: requestPath, body });
    if (url.pathname === '/api/version') return Promise.resolve(jsonResponse(200, { version: options.version }));
    if (url.pathname === '/api/tags') {
      return Promise.resolve(jsonResponse(200, { models: options.models.map((name) => ({ name })) }));
    }
    if (url.pathname === '/api/pull') {
      const responseBody = mutable.pullStatus === 200
        ? `${(options.pullLines ?? [{ status: 'success' }]).map((line) => JSON.stringify(line)).join('\n')}\n`
        : '';
      return Promise.resolve(new Response(responseBody, {
        status: mutable.pullStatus,
        headers: { 'content-type': 'application/x-ndjson' },
      }));
    }
    if (url.pathname === '/api/delete') return Promise.resolve(jsonResponse(mutable.deleteStatus, {}));
    return Promise.resolve(jsonResponse(404, {}));
  });
  return () => fakeEndpoints.delete(origin);
};

const jsonResponse = (status: number, body: unknown): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});
