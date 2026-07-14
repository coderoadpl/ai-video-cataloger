import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
    const adapter = new ManagedOllamaRuntimeAdapter({ homeDirectory: home, systemBaseUrl: system.origin });

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
    const adapter = new ManagedOllamaRuntimeAdapter({ homeDirectory: home, systemBaseUrl: 'http://127.0.0.1:1' });

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
  const server = createServer((request, response) => {
    void readJsonBody(request).then((body) => {
      requests.push({ method: request.method ?? '', url: request.url ?? '', body });
      if (request.url === '/api/version') {
        respondJson(response, 200, { version: options.version });
        return;
      }
      if (request.url === '/api/tags') {
        respondJson(response, 200, { models: options.models.map((name) => ({ name })) });
        return;
      }
      if (request.url === '/api/pull') {
        response.statusCode = mutable.pullStatus;
        response.setHeader('content-type', 'application/x-ndjson');
        if (mutable.pullStatus !== 200) {
          response.end('');
          return;
        }
        for (const line of options.pullLines ?? [{ status: 'success' }]) {
          response.write(`${JSON.stringify(line)}\n`);
        }
        response.end();
        return;
      }
      if (request.url === '/api/delete') {
        respondJson(response, mutable.deleteStatus, {});
        return;
      }
      respondJson(response, 404, {});
    });
  });
  await listen(server, 0);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP server address');
  const fake: FakeOllamaServer = {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
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
    close: () => closeServer(server),
  };
  closers.push(fake.close);
  return fake;
};

const startStaticServer = async (
  body: Buffer,
): Promise<{ origin: string; requests: Array<{ method: string; url: string }>; close: () => Promise<void> }> => {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' });
    response.statusCode = 200;
    response.setHeader('content-length', String(body.length));
    response.end(body);
  });
  await listen(server, 0);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP server address');
  const fake = {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
  closers.push(fake.close);
  return fake;
};

class AutoStartOllamaProcessManager implements RuntimeProcessManager {
  readonly spawnCalls: Array<{ command: string; args: string[]; host: string | null; models: string | null; detached: boolean }> = [];
  readonly killed: Array<{ pid: number; signal: 'SIGTERM' }> = [];
  private readonly servers: Server[] = [];

  constructor(private readonly pid: number | undefined = 4321) {}

  spawn(command: string, args: readonly string[], options: RuntimeSpawnOptions): RuntimeProcess {
    const host = options.env.OLLAMA_HOST ?? null;
    const models = options.env.OLLAMA_MODELS ?? null;
    this.spawnCalls.push({ command, args: [...args], host, models, detached: options.detached });
    if (host !== null && (this.pid ?? 0) > 0) {
      const portText = host.split(':')[1];
      if (portText === undefined) throw new Error('Expected OLLAMA_HOST port');
      const server = createServer((request, response) => {
        if (request.url === '/api/version') {
          respondJson(response, 200, { version: '0.31.1' });
          return;
        }
        if (request.url === '/api/pull') {
          response.statusCode = 200;
          response.end(`${JSON.stringify({ status: 'success' })}\n`);
          return;
        }
        respondJson(response, 200, { models: [] });
      });
      server.listen(Number(portText), '127.0.0.1');
      this.servers.push(server);
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
    await Promise.all(this.servers.map((server) => closeServer(server)));
    this.servers.length = 0;
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

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const respondJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return null;
  return JSON.parse(raw);
};
