import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
    await writeFile(stateFilePath(home), JSON.stringify({ port: managed.port, pid: 123, version: 'v0.31.1' }), 'utf8');
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
    await writeFile(stateFilePath(home), JSON.stringify({ port: managed.port, pid: 456, version: 'v0.31.1' }), 'utf8');
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
    expect(JSON.parse(stateRaw)).toEqual({ port: 9786, pid: 4321, version: 'v0.31.1' });
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

  spawn(command: string, args: readonly string[], options: RuntimeSpawnOptions): RuntimeProcess {
    const host = options.env.OLLAMA_HOST ?? null;
    const models = options.env.OLLAMA_MODELS ?? null;
    this.spawnCalls.push({ command, args: [...args], host, models, detached: options.detached });
    if (host !== null) {
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
      pid: 4321,
      unref: () => undefined,
    };
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

  spawn(): RuntimeProcess {
    return {
      pid: 1,
      unref: () => undefined,
    };
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
