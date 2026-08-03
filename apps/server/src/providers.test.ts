import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok, type AnalyzerProviderConfig, type AppError, type Result } from '@core/domain/index.js';
import type { ProvidersPort, ProviderTestResult } from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppDeps } from './composition.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';
import { scaledTimeout } from '../../../test/helpers/gate-timeout.js';

class FakeProvidersPort implements ProvidersPort {
  readonly tested: AnalyzerProviderConfig[] = [];

  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    this.tested.push(config);
    return Promise.resolve(ok({
      family: 'api',
      providerId: config.providerId,
      reachable: true,
      authenticated: true,
      latencyMs: 12,
      message: 'Connected',
    }));
  }
}

describe('provider routes', () => {
  it('lists the closed provider registry without credentials', async () => {
    const response = await buildApp(createInMemoryDeps()).request('/api/providers');
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        providers: [
          { family: 'api', providerId: 'openai' },
          { family: 'harness', providerId: 'claude-code' },
          { family: 'harness', providerId: 'codex' },
          { family: 'harness', providerId: 'cursor-agent' },
          { family: 'local', providerId: 'local' },
          { family: 'gemini-native', providerId: 'gemini' },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('apiKey');
  });

  it('validates and delegates provider connectivity tests to ProvidersPort', async () => {
    const deps: AppDeps = createInMemoryDeps();
    const providers = new FakeProvidersPort();
    deps.providers = providers;
    const input = {
      family: 'api',
      providerId: 'compatible',
      baseUrl: 'https://provider.example/v1',
      apiKeyRef: 'compatible-main',
      model: 'vision-model',
      maxImageDetail: 'low',
    } as const;

    const response = await buildApp(deps).request('/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        family: 'api',
        providerId: 'compatible',
        reachable: true,
        authenticated: true,
        latencyMs: 12,
        message: 'Connected',
      },
    });
    expect(providers.tested).toEqual([input]);
  });

  it('returns the temporary internal error until provider adapters land', async () => {
    const input = {
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
    } as const;
    const response = await buildApp(createInMemoryDeps()).request('/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests an API-family provider through the real composition without the harness path', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'providers-api-'));
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const deps = createDeps({ homeDirectory: home });
      const stored = await deps.credentials.set('openai-main', 'top-secret-key');
      expect(stored.ok).toBe(true);
      const input = {
        family: 'api',
        providerId: 'openai',
        baseUrl: 'https://provider.example/v1',
        apiKeyRef: 'openai-main',
        model: 'gpt-4.1-mini',
        maxImageDetail: 'auto',
      } as const;

      const response = await buildApp(deps).request('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        data: { family: 'api', providerId: 'openai', reachable: true, authenticated: true },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://provider.example/v1/models',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('validates a custom harness command and reports its version through the real composition', async () => {
    const input = {
      family: 'harness',
      providerId: 'custom-node',
      command: process.execPath,
      argsTemplate: ['-e', '{prompt}'],
      promptStyle: 'dir-access',
    } as const;

    const response = await buildApp(createDeps()).request('/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        family: 'harness',
        providerId: 'custom-node',
        available: true,
        version: process.version,
      },
    });
  }, scaledTimeout(30_000));

  it('reports why a custom harness command is unavailable', async () => {
    const input = {
      family: 'harness',
      providerId: 'missing-agent',
      command: 'definitely-not-an-installed-agent-command',
      argsTemplate: ['{prompt}'],
      promptStyle: 'file-urls',
    } as const;

    const response = await buildApp(createDeps()).request('/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        family: 'harness',
        providerId: 'missing-agent',
        available: false,
        version: null,
        message: 'Command not found.',
      },
    });
  }, scaledTimeout(30_000));
});
