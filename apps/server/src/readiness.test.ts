import { describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerPort,
  DependencyStatus,
  TranscribeInput,
  TranscriberPort,
} from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';

class ToggleAnalyzer implements AnalyzerPort {
  available = false;

  analyze(): Promise<Result<AnalysisOutput, AppError>> {
    return Promise.resolve(ok({ rawResponse: '' }));
  }

  dependency(input?: { backend: AnalyzeInput['backend']; provider?: AnalyzeInput['provider'] }): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({
      name: input?.provider?.providerId ?? 'analyzer',
      available: this.available,
      version: null,
      source: null,
      path: null,
      installHint: 'Configure analyzer',
    }));
  }
}

class ReadyTranscriber implements TranscriberPort {
  transcribe(input: TranscribeInput): Promise<Result<{ transcriptPath: string; content: string }, AppError>> {
    return Promise.resolve(ok({ transcriptPath: input.transcriptPath, content: '' }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({
      name: 'whisper',
      available: true,
      version: null,
      source: 'managed',
      path: '/whisper',
      installHint: '',
    }));
  }
}

describe('readiness route cache invalidation', () => {
  it('invalidates cached readiness after credential writes', async () => {
    const deps = createDeps({ dbDriver: 'memory', workingDirectory: '/work' });
    const analyzer = new ToggleAnalyzer();
    deps.analyzer = analyzer;
    deps.transcriber = new ReadyTranscriber();
    const app = buildApp(deps);

    const first = await app.request('/api/readiness');
    analyzer.available = true;
    const cached = await app.request('/api/readiness');
    await app.request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai', credential: 'never-return-this' }),
    });
    const invalidated = await app.request('/api/readiness');

    expect(await first.json()).toMatchObject({ ok: true, data: { analyzer: { available: false } } });
    expect(await cached.json()).toMatchObject({ ok: true, data: { analyzer: { available: false } } });
    expect(await invalidated.json()).toMatchObject({ ok: true, data: { analyzer: { available: true } } });
  });

  it('invalidates cached readiness after config writes', async () => {
    const deps = createDeps({ dbDriver: 'memory', workingDirectory: '/work' });
    deps.transcriber = new ReadyTranscriber();
    const app = buildApp(deps);

    const first = await app.request('/api/readiness');
    await app.request('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: '/work', key: 'analyzer_backend', value: 'local' }),
    });
    const invalidated = await app.request('/api/readiness');

    expect(await first.json()).toMatchObject({ ok: true, data: { analyzer: { providerId: 'claude-code' } } });
    expect(await invalidated.json()).toMatchObject({ ok: true, data: { analyzer: { providerId: 'local' } } });
  });
});
