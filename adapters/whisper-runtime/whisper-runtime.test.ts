import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

import {
  ManagedWhisperRuntimeAdapter,
  MANAGED_WHISPER_INCOMPLETE_MESSAGE,
  SLOW_CPU_WHISPER_WARNING,
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

describe('ManagedWhisperRuntimeAdapter', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
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

  it('reports a broken configured path without falling back to managed or system runtimes', async () => {
    const home = await tempHome();
    const configuredPath = path.join(home, 'missing', 'whisper-fast');
    await executable(managedWhisperBinaryPath(home), 'managed');
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'whisper_binary_path', configuredPath);
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.systemWhisperAvailable = true;
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: {
        available: false,
        path: configuredPath,
        source: 'configured',
        managedInstalled: true,
        message: expect.stringContaining(configuredPath),
      },
    });
    expect(runner.commands.some((entry) => entry.command === 'whisper')).toBe(false);
  });

  it('uses a resolved folder path instead of the home configured path', async () => {
    const home = await tempHome();
    const homePath = path.join(home, 'home-whisper');
    const folderPath = path.join(home, 'folder-whisper');
    await executable(homePath, 'home');
    await executable(folderPath, 'folder');
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'whisper_binary_path', homePath);
    const adapter = new ManagedWhisperRuntimeAdapter({
      config,
      homeDirectory: home,
      commandRunner: new FakeRunner(WHISPER_BOTTLE_SPECS),
    });

    const status = await adapter.status({ configuredPath: folderPath });

    expect(status).toMatchObject({ ok: true, value: { path: folderPath, source: 'configured' } });
  });

  it('detects managed before system and prefers whisper-cli when managed is absent', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.systemWhisperAvailable = true;
    const managedPath = managedWhisperBinaryPath(home);
    await executable(managedPath, 'managed');
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const managed = await adapter.status();
    await rm(path.dirname(managedPath), { recursive: true, force: true });
    const system = await adapter.status();

    expect(managed).toMatchObject({ ok: true, value: { source: 'managed', path: managedPath, engine: 'whisper-cli' } });
    expect(system).toMatchObject({ ok: true, value: { source: 'system', path: 'whisper-cli', engine: 'whisper-cli' } });
    expect(system.ok && system.value.warning).toBeUndefined();
  });

  it('falls back to the CPU-only python whisper as a last resort with a slow-CPU warning', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.systemWhisperAvailable = true;
    runner.missingTools.add('whisper-cli');
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: {
        available: true,
        source: 'system',
        path: 'whisper',
        engine: 'openai-whisper',
        warning: SLOW_CPU_WHISPER_WARNING,
      },
    });
    const whisperCliProbe = runner.commands.findIndex((entry) => entry.command === 'whisper-cli');
    const whisperProbe = runner.commands.findIndex((entry) => entry.command === 'whisper');
    expect(whisperCliProbe).toBeGreaterThanOrEqual(0);
    expect(whisperCliProbe).toBeLessThan(whisperProbe);
  });

  it('treats an empty managed binary as not installed and explains the incomplete runtime', async () => {
    const home = await tempHome();
    const managedPath = managedWhisperBinaryPath(home);
    await mkdir(path.dirname(managedPath), { recursive: true });
    await writeFile(managedPath, '', 'utf8');
    await chmod(managedPath, 0o755);
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.missingTools.add('whisper-cli');
    const adapter = new ManagedWhisperRuntimeAdapter({ config: new InMemoryConfig(), homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: {
        available: false,
        source: null,
        managedInstalled: false,
        message: MANAGED_WHISPER_INCOMPLETE_MESSAGE,
      },
    });
  });

  it.each([
    {
      state: 'an empty managed bin directory',
      prepare: async (managedPath: string) => {
        await mkdir(path.dirname(managedPath), { recursive: true });
      },
    },
    {
      state: 'a non-executable managed binary',
      prepare: async (managedPath: string) => {
        await mkdir(path.dirname(managedPath), { recursive: true });
        await writeFile(managedPath, 'wrapper', 'utf8');
        await chmod(managedPath, 0o644);
      },
    },
  ])('reports $state as an incomplete managed install', async ({ prepare }) => {
    const home = await tempHome();
    await prepare(managedWhisperBinaryPath(home));
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.missingTools.add('whisper-cli');
    const adapter = new ManagedWhisperRuntimeAdapter({ config: new InMemoryConfig(), homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: { available: false, managedInstalled: false, message: MANAGED_WHISPER_INCOMPLETE_MESSAGE },
    });
  });

  it('reports a healthy managed install without an incomplete message', async () => {
    const home = await tempHome();
    await executable(managedWhisperBinaryPath(home), 'wrapper');
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: new FakeRunner(WHISPER_BOTTLE_SPECS),
    });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: { available: true, source: 'managed', managedInstalled: true, engine: 'whisper-cli' },
    });
    expect(status.ok && status.value.message).toBeUndefined();
  });

  it('leaves an absent managed install absent when the bin directory holds other runtimes', async () => {
    const home = await tempHome();
    const managedPath = managedWhisperBinaryPath(home);
    await executable(path.join(path.dirname(managedPath), 'ollama'), 'ollama');
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.missingTools.add('whisper-cli');
    const adapter = new ManagedWhisperRuntimeAdapter({ config: new InMemoryConfig(), homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({ ok: true, value: { available: false, managedInstalled: false } });
    expect(status.ok && status.value.message).toBeUndefined();
  });

  it('surfaces the incomplete managed runtime as a warning when system whisper-cli is present', async () => {
    const home = await tempHome();
    const managedPath = managedWhisperBinaryPath(home);
    await mkdir(path.dirname(managedPath), { recursive: true });
    await writeFile(managedPath, '', 'utf8');
    await chmod(managedPath, 0o755);
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    const adapter = new ManagedWhisperRuntimeAdapter({ config: new InMemoryConfig(), homeDirectory: home, commandRunner: runner });

    const status = await adapter.status();

    expect(status).toMatchObject({
      ok: true,
      value: {
        available: true,
        source: 'system',
        path: 'whisper-cli',
        managedInstalled: false,
        warning: MANAGED_WHISPER_INCOMPLETE_MESSAGE,
      },
    });
  });

  it('installs through token, manifest, and blob requests against an HTTP server', async () => {
    const home = await tempHome();
    const fixtures = bottleFixtures();
    const requests: RequestRecord[] = [];
    const fetchImpl = bottleFetch(fixtures.specs, fixtures.bodies, requests);
    const runner = new FakeRunner(fixtures.specs);
    const progress: string[] = [];
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      fetchImpl,
      registryUrl: 'https://registry.test',
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
  }, scaledTimeout(30_000));

  it('rejects a blob checksum mismatch and removes staged files', async () => {
    const home = await tempHome();
    const fixtures = bottleFixtures();
    const wrongBodies = new Map(fixtures.bodies);
    wrongBodies.set(fixtures.specs[0]?.repository ?? '', Buffer.from('wrong archive'));
    const fetchImpl = bottleFetch(fixtures.specs, wrongBodies, []);
    const runner = new FakeRunner(fixtures.specs);
    runner.missingTools.add('cmake');
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      fetchImpl,
      registryUrl: 'https://registry.test',
      bottleSpecs: fixtures.specs,
    });

    const installed = await adapter.install();

    expect(installed).toMatchObject({ ok: false, error: { code: 'download_error', message: expect.stringContaining('checksum') } });
    expect(await exists(managedWhisperBinaryPath(home))).toBe(false);
    expect(await exists(path.join(home, '.ai-video-cataloger', 'bin', 'whisper-runtime', 'v1.9.1.install.tmp'))).toBe(false);
    expect(runner.commands.some((entry) => entry.command === 'make')).toBe(false);
  }, scaledTimeout(30_000));

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
    const fetchImpl: typeof fetch = (input) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(requestUrl.pathname === '/source'
        ? new Response(responseBody(source))
        : new Response(null, { status: 503 }));
    };
    const runner = new FakeRunner(WHISPER_BOTTLE_SPECS);
    runner.sourceBuild = true;
    const progress: string[] = [];
    const adapter = new ManagedWhisperRuntimeAdapter({
      config: new InMemoryConfig(),
      homeDirectory: home,
      commandRunner: runner,
      fetchImpl,
      registryUrl: 'https://registry.test',
      sourceUrl: 'https://registry.test/source',
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
  }, scaledTimeout(30_000));
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

const bottleFetch = (
  specs: readonly WhisperBottleSpec[],
  bodies: ReadonlyMap<string, Buffer>,
  requests: RequestRecord[],
): typeof fetch =>
  (input, init) => {
    const request = new Request(input, init);
    const requestUrl = new URL(request.url);
    requests.push({
      path: requestUrl.pathname,
      service: requestUrl.searchParams.get('service'),
      scope: requestUrl.searchParams.get('scope'),
      authorization: request.headers.get('authorization') ?? undefined,
    });
    if (requestUrl.pathname === '/token') {
      return Promise.resolve(Response.json({ token: 'test-token' }));
    }
    const spec = specs.find((candidate) => requestUrl.pathname.includes(`/v2/${candidate.repository}/`));
    if (spec === undefined) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    if (requestUrl.pathname.endsWith(`/manifests/${spec.version}`)) {
      return Promise.resolve(Response.json({
        schemaVersion: 2,
        manifests: [{
          digest: `sha256:${spec.manifestSha256}`,
          annotations: {
            'org.opencontainers.image.ref.name': `${spec.version}.arm64_sequoia`,
            'sh.brew.bottle.digest': spec.sha256,
          },
        }],
      }));
    }
    const body = bodies.get(spec.repository);
    if (body === undefined) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(new Response(responseBody(body)));
  };

interface RequestRecord {
  path: string;
  service: string | null;
  scope: string | null;
  authorization: string | undefined;
}

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

const responseBody = (value: Buffer): ArrayBuffer =>
  Uint8Array.from(value).buffer;
