import { describe, expect, it } from 'vitest';

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
});
