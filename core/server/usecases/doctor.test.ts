import { describe, expect, it } from 'vitest';

import { ok } from '@core/domain/index.js';

import { runDoctor } from './doctor.js';
import { ReadinessCache } from './readiness.js';
import {
  dependency,
  InMemoryAnalyzer,
  InMemoryLocalAi,
  InMemoryMedia,
  InMemoryProviders,
  InMemoryTranscriber,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryFaceEngine,
} from '../../../test/server/usecases/test-fakes.js';

describe('runDoctor', () => {
  it('combines dependency status with machine recommendation', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.machineValue = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi,
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
    };

    const result = await runDoctor(deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true },
        recommendedLocalModel: 'gemma3:12b',
        allAvailable: true,
        harnesses: [
          { providerId: 'claude-code', available: true },
          { providerId: 'codex', available: true },
          { providerId: 'cursor-agent', available: true },
        ],
      },
    });
    expect(deps.providers.tested).toHaveLength(3);
  });

  it('marks allAvailable false when one dependency is unavailable', async () => {
    const media = new InMemoryMedia();
    media.dependenciesValue = [dependency('ffmpeg', false)];
    const deps = {
      media,
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
    };

    const result = await runDoctor(deps);

    expect(result).toMatchObject({ ok: true, value: { allAvailable: false } });
  });

  it('surfaces a dependency warning as a doctor warning', async () => {
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = {
      ...dependency('whisper', true),
      warning: 'Transcription is running on a slow CPU implementation',
    };
    const deps = {
      media: new InMemoryMedia(),
      transcriber,
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.warnings).toEqual([
      { code: 'whisper_warning', message: 'Transcription is running on a slow CPU implementation' },
    ]);
  });

  it('warns and names the shadowing paths when a stale CLI wins on PATH', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      version: '0.6.0',
      cliPath: {
        commandName: 'ai-video-cataloger',
        ownedInstallPaths: ['/usr/local/bin/ai-video-cataloger'],
        resolveOnPath: () => Promise.resolve(ok([
          { path: '/opt/homebrew/bin/ai-video-cataloger', version: '0.4.1', isSymlink: false, symlinkTarget: null },
          { path: '/usr/local/bin/ai-video-cataloger', version: '0.6.0', isSymlink: true, symlinkTarget: '/app' },
        ])),
      },
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    const warning = result.ok ? result.value.warnings.find((entry) => entry.code === 'stale_cli') : undefined;
    expect(warning?.message).toContain('/opt/homebrew/bin/ai-video-cataloger');
    expect(warning?.message).toContain('version 0.4.1');
    expect(warning?.message).toContain('0.6.0');
  });

  it('emits no stale-CLI warning when PATH already runs the current version', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      version: '0.6.0',
      cliPath: {
        commandName: 'ai-video-cataloger',
        ownedInstallPaths: ['/usr/local/bin/ai-video-cataloger'],
        resolveOnPath: () => Promise.resolve(ok([
          { path: '/usr/local/bin/ai-video-cataloger', version: '0.6.0', isSymlink: true, symlinkTarget: '/app' },
        ])),
      },
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.warnings.some((entry) => entry.code === 'stale_cli')).toBe(false);
  });

  it('warns when a plaintext credential can be migrated to the keychain', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      credentials: {
        get: () => Promise.resolve(ok(null)),
        set: () => Promise.resolve(ok(undefined)),
        legacyPlaintextProviders: () => Promise.resolve(ok(['openai'])),
      },
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.warnings).toContainEqual({
      code: 'secret_migration',
      message: 'The API key for "openai" could not be moved out of the plaintext file ~/.ai-video-cataloger/credentials.json into the macOS Keychain. Unlock the login keychain and run doctor again.',
    });
  });

  it('names the keychain as the credentials backend without a fallback warning', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      credentials: {
        get: () => Promise.resolve(ok(null)),
        set: () => Promise.resolve(ok(undefined)),
        backend: () => Promise.resolve({ backend: 'keychain' as const, reason: 'ok' as const }),
      },
    };

    const result = await runDoctor(deps);

    expect(result.ok && result.value.credentials).toEqual({ backend: 'keychain', reason: 'ok' });
    expect(result.ok && result.value.warnings.some((entry) => entry.code === 'credentials_backend_fallback')).toBe(false);
  });

  it('warns when the keychain is unreachable and credentials fall back to the file store', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      credentials: {
        get: () => Promise.resolve(ok(null)),
        set: () => Promise.resolve(ok(undefined)),
        backend: () => Promise.resolve({ backend: 'file' as const, reason: 'degraded' as const }),
      },
    };

    const result = await runDoctor(deps);

    expect(result.ok && result.value.credentials).toEqual({ backend: 'file', reason: 'degraded' });
    expect(result.ok && result.value.warnings.some((entry) => entry.code === 'credentials_backend_fallback')).toBe(true);
  });

  it('reports the file backend without a warning when the keychain is switched off', async () => {
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      credentials: {
        get: () => Promise.resolve(ok(null)),
        set: () => Promise.resolve(ok(undefined)),
        backend: () => Promise.resolve({ backend: 'file' as const, reason: 'disabled' as const }),
      },
    };

    const result = await runDoctor(deps);

    expect(result.ok && result.value.warnings.some((entry) => entry.code === 'credentials_backend_fallback')).toBe(false);
  });

  it('keeps doctor successful on Apple Silicon when local AI starts on demand', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.machineValue = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
    localAi.statusValue = { runtimeUp: false, runtimeVersion: 'v0.31.1', installedModels: [] };
    localAi.dependencyValue = dependency('local-ai', false);
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi,
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const cliExitCode = result.value.allAvailable ? 0 : 1;
    expect(cliExitCode).toBe(0);
    expect(result.value.allAvailable).toBe(true);
    expect(result.value.dependencies.find((item) => item.name === 'local-ai')).toMatchObject({
      available: true,
      version: expect.stringContaining('starts when needed'),
    });
  });

  it('marks local AI unavailable off Apple Silicon even if a runtime responds', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.machineValue = { platform: 'linux', arch: 'x64', ramGb: 16 };
    localAi.dependencyValue = dependency('local-ai', true);
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi,
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.allAvailable).toBe(false);
    expect(result.value.dependencies.find((item) => item.name === 'local-ai')).toMatchObject({
      available: false,
      installHint: expect.stringContaining('Apple Silicon'),
    });
  });

  it('does not report faces while faces_enabled is disabled', async () => {
    const faceEngine = new InMemoryFaceEngine();
    faceEngine.dependencyValue = dependency('faces', false);
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config: new InMemoryConfig(),
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      faceEngine,
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.dependencies.some((item) => item.name === 'faces')).toBe(false);
    expect(result.value.allAvailable).toBe(true);
  });

  it('reports missing face artifacts as an optional warning when faces are enabled', async () => {
    const faceEngine = new InMemoryFaceEngine();
    faceEngine.dependencyValue = {
      ...dependency('faces', false),
      installHint: 'Run: ai-video-cataloger models faces install',
    };
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'faces_enabled', 'true');
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      providers: new InMemoryProviders(),
      localAi: new InMemoryLocalAi(),
      config,
      fs: new InMemoryFileSystem(),
      readiness: new ReadinessCache(),
      faceEngine,
    };

    const result = await runDoctor(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.allAvailable).toBe(true);
    expect(result.value.dependencies.find((item) => item.name === 'faces')).toMatchObject({
      available: true,
      warning: 'Run: ai-video-cataloger models faces install',
    });
    expect(result.value.warnings).toContainEqual({
      code: 'faces_warning',
      message: 'Run: ai-video-cataloger models faces install',
    });
  });
});
