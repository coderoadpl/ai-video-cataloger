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
});
