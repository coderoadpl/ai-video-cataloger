import { describe, expect, it } from 'vitest';

import type { AnalyzerProviderConfig } from '@core/domain/index.js';

import {
  dependency,
  InMemoryAnalyzer,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryTranscriber,
} from '../../../test/server/usecases/test-fakes.js';
import { getReadiness, ReadinessCache } from './readiness.js';
import { setConfig } from './config.js';

const providers: AnalyzerProviderConfig[] = [
  {
    family: 'api',
    providerId: 'compatible',
    baseUrl: 'https://example.test/v1',
    apiKeyRef: 'compatible',
    model: 'vision-model',
    maxImageDetail: 'auto',
  },
  {
    family: 'harness',
    providerId: 'custom-agent',
    command: 'custom-agent',
    argsTemplate: ['run', '{prompt}'],
    promptStyle: 'dir-access',
  },
  {
    family: 'local',
    providerId: 'local',
    modelTag: 'gemma3:12b',
  },
];

const configuredDeps = async (provider: AnalyzerProviderConfig, available: boolean) => {
  const config = new InMemoryConfig();
  await config.set(
    { kind: 'folder', folder: '/work' },
    'analyzer_provider',
    JSON.stringify(provider),
  );
  const analyzer = new InMemoryAnalyzer();
  analyzer.dependencyValue = dependency(provider.providerId, available);
  const transcriber = new InMemoryTranscriber();
  transcriber.dependencyValue = dependency('whisper', true);
  return {
    config,
    fs: new InMemoryFileSystem(),
    analyzer,
    transcriber,
    readiness: new ReadinessCache(),
  };
};

describe('configured readiness', () => {
  it.each(providers)('passes through a ready $family analyzer', async (provider) => {
    const result = await getReadiness(await configuredDeps(provider, true));

    expect(result).toMatchObject({
      ok: true,
      value: {
        ready: true,
        analyzer: { family: provider.family, providerId: provider.providerId, available: true },
        missingPieces: [],
        suggestedAction: null,
      },
    });
  });

  it.each(providers)('guides setup for an unavailable $family analyzer', async (provider) => {
    const result = await getReadiness(await configuredDeps(provider, false));

    expect(result).toMatchObject({
      ok: true,
      value: {
        ready: false,
        analyzer: { family: provider.family, providerId: provider.providerId, available: false },
        missingPieces: [{ kind: 'analyzer', name: provider.providerId }],
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.suggestedAction).toContain('ai-video-cataloger setup');
  });

  it('uses wizard home defaults for readiness in a fresh folder', async () => {
    const provider = providers.find((candidate) => candidate.family === 'harness');
    if (provider === undefined) throw new Error('Expected harness provider fixture');
    const config = new InMemoryConfig();
    const fs = new InMemoryFileSystem('/fresh-videos');
    await setConfig({ config, fs }, { key: 'analyzer_provider', value: JSON.stringify(provider) });
    await setConfig({ config, fs }, { key: 'whisper_mode', value: 'skip' });
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency(provider.providerId, true);
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = dependency('transcription-skip', true);

    const result = await getReadiness({
      config,
      fs,
      analyzer,
      transcriber,
      readiness: new ReadinessCache(),
    }, { folder: '/fresh-videos', refresh: true });

    expect(result).toMatchObject({
      ok: true,
      value: {
        ready: true,
        analyzer: { providerId: 'custom-agent' },
        transcriber: { mode: 'skip' },
      },
    });
    expect(transcriber.dependencyInputs[0]).toMatchObject({ mode: 'skip', model: 'base', binaryPath: '' });
  });

  it('does not resolve a home-scoped readiness request through cwd folder config', async () => {
    const homeProvider = providers.find((candidate) => candidate.family === 'local');
    if (homeProvider === undefined) throw new Error('Expected local provider fixture');
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'analyzer_provider', JSON.stringify({ ...homeProvider, modelTag: 'gemma3:4b' }));
    await config.set({ kind: 'home' }, 'local_model', 'gemma3:4b');
    await config.set({ kind: 'home' }, 'whisper_mode', 'skip');
    await config.set({ kind: 'folder', folder: '/home-alias' }, 'local_model', 'gemma3:12b');
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency('local', true);
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = dependency('transcription-skip', true);

    const result = await getReadiness({
      config,
      fs: new InMemoryFileSystem('/home-alias'),
      analyzer,
      transcriber,
      readiness: new ReadinessCache(),
    }, { scope: 'home', refresh: true });

    expect(result).toMatchObject({ ok: true, value: { ready: true } });
    expect(analyzer.dependencyProviders[0]).toMatchObject({ family: 'local', modelTag: 'gemma3:4b' });
  });

  it('lets folder readiness settings override home defaults point-wise', async () => {
    const homeProvider = providers.find((candidate) => candidate.family === 'harness');
    const folderProvider = providers.find((candidate) => candidate.family === 'api');
    if (homeProvider === undefined || folderProvider === undefined) throw new Error('Expected provider fixtures');
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'analyzer_provider', JSON.stringify(homeProvider));
    await config.set({ kind: 'home' }, 'whisper_mode', 'skip');
    await config.set({ kind: 'folder', folder: '/work' }, 'analyzer_provider', JSON.stringify(folderProvider));
    await config.set({ kind: 'folder', folder: '/work' }, 'whisper_mode', 'api');
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency(folderProvider.providerId, true);
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = dependency('openai-whisper-api', true);

    const result = await getReadiness({
      config,
      fs: new InMemoryFileSystem('/work'),
      analyzer,
      transcriber,
      readiness: new ReadinessCache(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        analyzer: { providerId: 'compatible' },
        transcriber: { mode: 'api' },
      },
    });
  });

  it('names the resolved whisper binary and engine on the transcriber component', async () => {
    const provider = providers.find((candidate) => candidate.family === 'harness');
    if (provider === undefined) throw new Error('Expected harness provider fixture');
    const deps = await configuredDeps(provider, true);
    deps.transcriber.dependencyValue = {
      ...dependency('whisper', true),
      path: '/opt/homebrew/bin/whisper',
      engine: 'openai-whisper',
    };

    const result = await getReadiness(deps);

    expect(result).toMatchObject({
      ok: true,
      value: { transcriber: { engine: 'openai-whisper', binaryPath: '/opt/homebrew/bin/whisper' } },
    });
  });

  it('leaves the transcriber engine unnamed when the dependency is not a whisper binary', async () => {
    const provider = providers.find((candidate) => candidate.family === 'harness');
    if (provider === undefined) throw new Error('Expected harness provider fixture');
    const deps = await configuredDeps(provider, true);
    deps.transcriber.dependencyValue = { ...dependency('whisper-base', false), path: '/models/ggml-base.bin' };

    const result = await getReadiness(deps);

    expect(result).toMatchObject({
      ok: true,
      value: { transcriber: { engine: null, binaryPath: null } },
    });
  });

  it('carries a degraded transcriber warning instead of reporting a plain available runtime', async () => {
    const provider = providers.find((candidate) => candidate.family === 'harness');
    if (provider === undefined) throw new Error('Expected harness provider fixture');
    const deps = await configuredDeps(provider, true);
    deps.transcriber.dependencyValue = {
      ...dependency('whisper', true),
      engine: 'openai-whisper',
      warning: 'The managed whisper.cpp runtime is present but incomplete',
    };

    const result = await getReadiness(deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        ready: true,
        transcriber: { warning: 'The managed whisper.cpp runtime is present but incomplete' },
      },
    });
  });

  it('caches by folder and refreshes on demand', async () => {
    const provider = providers.find((candidate) => candidate.family === 'harness');
    if (provider === undefined) throw new Error('Expected harness provider fixture');
    const deps = await configuredDeps(provider, false);
    const first = await getReadiness(deps);
    deps.analyzer.dependencyValue = dependency('custom-agent', true);
    const cached = await getReadiness(deps);
    const refreshed = await getReadiness(deps, { refresh: true });

    expect(first).toMatchObject({ ok: true, value: { ready: false } });
    expect(cached).toMatchObject({ ok: true, value: { ready: false } });
    expect(refreshed).toMatchObject({ ok: true, value: { ready: true } });
  });

  it('retries a loader after a cached readiness promise rejects', async () => {
    const cache = new ReadinessCache();
    let attempts = 0;
    const load = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('temporary failure'));
      return Promise.resolve({ ok: false, error: { code: 'internal', message: 'recovered loader' } } as const);
    };

    await expect(cache.read('/work', false, load)).rejects.toThrow('temporary failure');
    await expect(cache.read('/work', false, load)).resolves.toMatchObject({
      ok: false,
      error: { message: 'recovered loader' },
    });
    expect(attempts).toBe(2);
  });

  it('retries a loader after a resolved error result', async () => {
    const cache = new ReadinessCache();
    let attempts = 0;
    const load = () => {
      attempts += 1;
      return Promise.resolve({ ok: false, error: { code: 'internal', message: `failure ${attempts}` } } as const);
    };

    await expect(cache.read('/work', false, load)).resolves.toMatchObject({ error: { message: 'failure 1' } });
    await expect(cache.read('/work', false, load)).resolves.toMatchObject({ error: { message: 'failure 2' } });
    expect(attempts).toBe(2);
  });
});
