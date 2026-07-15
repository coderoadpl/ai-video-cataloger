import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import {
  ManagedWhisperRuntimeAdapter,
  WHISPER_BOTTLE_SPECS,
  managedWhisperBinaryPath,
  whisperInstallNamePatches,
  whisperRuntimeDirectory,
  whisperRuntimeStagingDirectory,
  type WhisperBottleSpec,
  type WhisperRuntimeCommandOptions,
  type WhisperRuntimeCommandRunner,
} from './index.js';

const roots: string[] = [];
const servers: Server[] = [];

describe('ManagedWhisperRuntimeAdapter', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    await Promise.all(servers.map(closeServer));
    roots.length = 0;
    servers.length = 0;
  });

  it('resolves configured path before managed and system runtimes', async () => {
    const home = await tempHome();
    const configuredPath = path.join(home, 'custom', 'whisper-fast');
    const managedPath = managedWhisperBinaryPath(home);
    await executable(configuredPath, 'configured');
    await executable(managedPath, 'managed');
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'whisper_binary_path', configuredPath);
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: { available: true, path: configuredPath, source: 'configured', managedInstalled: true },
    });
    expect(runner.commands.some((entry) => entry.command === 'whisper')).toBe(false);
  });

  it('detects managed before system and detects system when managed is absent', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.systemWhisperAvailable = true;
    const managedPath = managedWhisperBinaryPath(home);
    await executable(managedPath, 'managed');
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const managed = await adapter.status();
    await rm(managedPath, { force: true });
    const system = await adapter.status();

    expect(managed).toMatchObject({ ok: true, value: { source: 'managed', path: managedPath } });
    expect(system).toMatchObject({ ok: true, value: { source: 'system', path: 'whisper' } });
  });

  it('installs through token, manifest, and blob requests against an HTTP server', async () => {
    const home = await tempHome();
    const fixtures = bottleFixtures();
    const requests: RequestRecord[] = [];
    const server = await bottleServer(fixtures.specs, fixtures.bodies, requests);
    const runner = new FakeRunner(fixtures.specs);
    const progress: string[] = [];
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      registryUrl: server.url,
      bottleSpecs: fixtures.specs,
    });

    const installed = await adapter.install({
      onProgress: (event) => {
        progress.push(event.phase);
        return Promise.resolve(ok(undefined));
      },
    });

    expect(installed).toEqual(ok({ path: managedWhisperBinaryPath(home), version: 'v1.9.1', installed: true }));
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(3);
    expect(requests.filter((request) => request.path === '/token').map((request) => request.service)).toEqual([
      'ghcr.io',
      'ghcr.io',
      'ghcr.io',
    ]);
    expect(requests.filter((request) => request.path === '/token').map((request) => request.scope)).toEqual(
      fixtures.specs.map((spec) => `repository:${spec.repository}:pull`),
    );
    expect(requests.filter((request) => request.path.includes('/manifests/'))).toHaveLength(3);
    expect(requests.filter((request) => request.path.includes('/blobs/sha256:'))).toHaveLength(3);
    expect(requests.filter((request) => request.path.includes('/v2/')).every((request) => request.authorization === 'Bearer test-token')).toBe(true);
    expect(progress).toEqual(expect.arrayContaining(['authenticating', 'downloading', 'patching']));
    expect(await readFile(managedWhisperBinaryPath(home), 'utf8')).toContain('GGML_BACKEND_PATH');
    expect(await readFile(path.join(whisperRuntimeDirectory(home), 'whisper-cli'), 'utf8')).toBe('whisper-cli');
    for (const patch of whisperInstallNamePatches()) {
      expect(runner.commands).toContainEqual({
        command: 'install_name_tool',
        args: [...patch.args, path.join(whisperRuntimeStagingDirectory(home), patch.fileName)],
        options: {},
      });
    }
  });

  it('rejects a blob checksum mismatch and removes staged files', async () => {
    const home = await tempHome();
    const fixtures = bottleFixtures();
    const wrongBodies = new Map(fixtures.bodies);
    wrongBodies.set(fixtures.specs[0]?.repository ?? '', Buffer.from('wrong archive'));
    const server = await bottleServer(fixtures.specs, wrongBodies, []);
    const runner = new FakeRunner(fixtures.specs);
    runner.missingTools.add('cmake');
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      registryUrl: server.url,
      bottleSpecs: fixtures.specs,
    });

    const installed = await adapter.install();

    expect(installed).toMatchObject({ ok: false, error: { code: 'download_error', message: expect.stringContaining('checksum') } });
    expect(await exists(managedWhisperBinaryPath(home))).toBe(false);
    expect(await exists(path.join(home, '.ai-video-cataloger', 'bin', 'whisper-runtime', 'v1.9.1.install.tmp'))).toBe(false);
    expect(runner.commands.some((entry) => entry.command === 'make')).toBe(false);
  });

  it('constructs install-name patch commands as argument vectors', () => {
    expect(whisperInstallNamePatches()).toContainEqual({
      fileName: 'whisper-cli',
      args: ['-change', '@rpath/libwhisper.1.dylib', '@loader_path/libwhisper.1.dylib'],
    });
    expect(whisperInstallNamePatches()).toContainEqual({
      fileName: 'libggml-base.0.dylib',
      args: ['-change', '@@HOMEBREW_PREFIX@@/opt/libomp/lib/libomp.dylib', '@loader_path/libomp.dylib'],
    });
    expect(whisperInstallNamePatches().every((patch) => patch.args[0] === '-change' || patch.args[0] === '-id')).toBe(true);
  });

  it('falls back to the source build only when bottle installation fails and build tools exist', async () => {
    const home = await tempHome();
    const source = Buffer.from('source archive');
    const sourceSha256 = digest(source);
    const server = createServer((request, response) => {
      if (request.url === '/source') {
        response.end(source);
        return;
      }
      response.statusCode = 503;
      response.end();
    });
    const url = await listen(server);
    servers.push(server);
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.sourceBuild = true;
    const progress: string[] = [];
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      registryUrl: url,
      sourceUrl: `${url}/source`,
      sourceSha256,
    });

    const installed = await adapter.install({
      onProgress: (event) => {
        progress.push(event.phase);
        return Promise.resolve(ok(undefined));
      },
    });

    expect(installed).toEqual(ok({ path: managedWhisperBinaryPath(home), version: 'v1.9.1', installed: true }));
    expect(runner.commands.some((entry) => entry.command === 'make')).toBe(true);
    expect(progress).toContain('source_fallback');
  });
});

class FakeRunner implements WhisperRuntimeCommandRunner {
  readonly commands: Array<{ command: string; args: readonly string[]; options?: WhisperRuntimeCommandOptions | undefined }> = [];
  readonly missingTools = new Set<string>();
  systemWhisperAvailable = false;
  sourceBuild = false;

  constructor(private readonly specs: readonly WhisperBottleSpec[]) {}

  async run(
    command: string,
    args: readonly string[],
    options?: WhisperRuntimeCommandOptions,
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>> {
    this.commands.push({ command, args, options });
    if (this.missingTools.has(command)) {
      return { ok: false, error: appError('processing_error', `${command} missing`) };
    }
    if (command === 'whisper' && !this.systemWhisperAvailable) {
      return { ok: false, error: appError('processing_error', 'whisper missing') };
    }
    if (command === 'tar') await this.extract(args);
    if (command === 'make' && this.sourceBuild) await this.build(options);
    return ok({ stdout: command.includes('whisper') ? 'whisper.cpp 1.9.1' : `${command} complete`, stderr: '' });
  }

  private async extract(args: readonly string[]): Promise<void> {
    const destination = args[args.indexOf('-C') + 1];
    if (destination === undefined) throw new Error('missing extraction directory');
    if (path.basename(destination).startsWith('extracted-')) {
      const index = Number(path.basename(destination).slice('extracted-'.length));
      const spec = this.specs[index];
      if (spec === undefined) throw new Error('missing bottle spec');
      await Promise.all(spec.files.map((file) => executable(path.join(destination, file.sourcePath), file.destinationName)));
      return;
    }
    if (this.sourceBuild) await mkdir(path.join(destination, 'whisper.cpp-1.9.1'), { recursive: true });
  }

  private async build(options: WhisperRuntimeCommandOptions | undefined): Promise<void> {
    if (options?.cwd === undefined) throw new Error('missing source cwd');
    await executable(path.join(options.cwd, 'build', 'bin', 'whisper-cli'), 'source whisper-cli');
  }
}

const bottleFixtures = (): { specs: readonly WhisperBottleSpec[]; bodies: ReadonlyMap<string, Buffer> } => {
  const bodies = new Map<string, Buffer>();
  const specs = WHISPER_BOTTLE_SPECS.map((spec, index) => {
    const body = Buffer.from(`bottle-${spec.repository}`);
    bodies.set(spec.repository, body);
    return {
      ...spec,
      sha256: digest(body),
      manifestSha256: digest(Buffer.from(`manifest-${String(index)}`)),
    };
  });
  return { specs, bodies };
};

const bottleServer = async (
  specs: readonly WhisperBottleSpec[],
  bodies: ReadonlyMap<string, Buffer>,
  requests: RequestRecord[],
): Promise<{ url: string }> => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push({
      path: requestUrl.pathname,
      service: requestUrl.searchParams.get('service'),
      scope: requestUrl.searchParams.get('scope'),
      authorization: request.headers.authorization,
    });
    if (requestUrl.pathname === '/token') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ token: 'test-token' }));
      return;
    }
    const spec = specs.find((candidate) => requestUrl.pathname.includes(`/v2/${candidate.repository}/`));
    if (spec === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (requestUrl.pathname.endsWith(`/manifests/${spec.version}`)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        schemaVersion: 2,
        manifests: [{
          digest: `sha256:${spec.manifestSha256}`,
          annotations: {
            'org.opencontainers.image.ref.name': `${spec.version}.arm64_sequoia`,
            'sh.brew.bottle.digest': spec.sha256,
          },
        }],
      }));
      return;
    }
    const body = bodies.get(spec.repository);
    if (body === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.end(body);
  });
  const url = await listen(server);
  servers.push(server);
  return { url };
};

interface RequestRecord {
  path: string;
  service: string | null;
  scope: string | null;
  authorization: string | undefined;
}

const listen = (server: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('HTTP test server has no TCP address'));
        return;
      }
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
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

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'managed-whisper-runtime-'));
  roots.push(root);
  return root;
};

const executable = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
};

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
};

const digest = (value: Buffer): string =>
  createHash('sha256').update(value).digest('hex');
