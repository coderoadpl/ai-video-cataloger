import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import { InMemoryConfig } from '../../test/server/usecases/test-fakes.js';

import {
  ManagedWhisperRuntimeAdapter,
  managedWhisperBinaryPath,
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
    const runner = new FakeRunner();
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
    const runner = new FakeRunner();
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

  it('rejects a checksum mismatch and removes the download temp file', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const runner = new FakeRunner();
    const adapter = new ManagedWhisperRuntimeAdapter({
      config,
      homeDirectory: home,
      commandRunner: runner,
      expectedSha256: '0'.repeat(64),
      fetchImpl: () => Promise.resolve(new Response('wrong archive')),
    });

    const installed = await adapter.install();

    expect(installed).toMatchObject({ ok: false, error: { code: 'download_error', message: expect.stringContaining('checksum') } });
    expect(await exists(managedWhisperBinaryPath(home))).toBe(false);
    expect(await exists(path.join(home, '.ai-video-cataloger', 'bin', 'whisper-v1.9.1.download.tmp'))).toBe(false);
    expect(runner.commands.some((entry) => entry.command === 'make')).toBe(false);
  });

  it('builds into a temporary path and atomically renames the executable', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const archive = Buffer.from('official source fixture');
    const runner = new FakeRunner();
    const finalPath = managedWhisperBinaryPath(home);
    runner.onMake = async (options) => {
      expect(await exists(finalPath)).toBe(false);
      if (options?.cwd === undefined) throw new Error('missing source cwd');
      await executable(path.join(options.cwd, 'build', 'bin', 'whisper-cli'), 'built whisper');
    };
    const adapter = new ManagedWhisperRuntimeAdapter({
      config,
      homeDirectory: home,
      commandRunner: runner,
      expectedSha256: createHash('sha256').update(archive).digest('hex'),
      fetchImpl: () => Promise.resolve(new Response(archive)),
    });

    const installed = await adapter.install();

    expect(installed).toEqual(ok({ path: finalPath, version: 'v1.9.1', installed: true }));
    expect(await readFile(finalPath, 'utf8')).toBe('built whisper');
    expect(await exists(`${finalPath}.install.tmp`)).toBe(false);
  });

  it('reports missing CMake or Clang instead of starting a managed build', async () => {
    const home = await tempHome();
    const config = new InMemoryConfig();
    const runner = new FakeRunner();
    runner.missingTools.add('cmake');
    const adapter = new ManagedWhisperRuntimeAdapter({ config, homeDirectory: home, commandRunner: runner });

    const installed = await adapter.install();

    expect(installed).toMatchObject({
      ok: false,
      error: { code: 'prerequisites_failed', details: { missingBuildTools: ['CMake'] } },
    });
    expect(runner.commands.some((entry) => entry.command === 'make')).toBe(false);
  });
});

class FakeRunner implements WhisperRuntimeCommandRunner {
  readonly commands: Array<{ command: string; args: readonly string[]; options?: WhisperRuntimeCommandOptions | undefined }> = [];
  readonly missingTools = new Set<string>();
  systemWhisperAvailable = false;
  onMake: ((options: WhisperRuntimeCommandOptions | undefined) => Promise<void>) | undefined;

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
    if (command === 'make') await this.onMake?.(options);
    return ok({ stdout: command.includes('whisper') ? 'whisper.cpp 1.9.1' : `${command} installed`, stderr: '' });
  }
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
