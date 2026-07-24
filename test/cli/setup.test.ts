import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApiClient } from '@core/client/index.js';
import { analyzerProviderConfigSchema, ok, type AppError, type Result } from '@core/domain/index.js';
import type { WhisperRuntimePort, WhisperRuntimeStatus } from '@core/server/index.js';
import { buildApp } from '@server/src/app.js';
import { createDeps } from '@server/src/composition.js';
import { executeSetup, type SetupOutput } from '../../apps/cli/src/setup.js';
import {
  dependency,
  InMemoryAnalyzer,
  InMemoryDownloads,
  InMemoryJobs,
  InMemoryLocalAi,
  InMemoryTranscriber,
} from '../server/usecases/test-fakes.js';
import { cleanupTestDir, createTestDir } from '../setup.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';

class FakeWhisperRuntime implements WhisperRuntimePort {
  installed = false;

  status(): Promise<Result<WhisperRuntimeStatus, AppError>> {
    return Promise.resolve(ok({
      available: this.installed,
      path: this.installed ? '/fake/bin/whisper' : null,
      source: this.installed ? 'managed' : null,
      version: this.installed ? 'v1.9.1' : null,
      managedInstalled: this.installed,
      buildToolsAvailable: true,
      missingBuildTools: [],
    }));
  }

  install(): Promise<Result<{ path: string; version: string; installed: boolean }, AppError>> {
    this.installed = true;
    return Promise.resolve(ok({ path: '/fake/bin/whisper', version: 'v1.9.1', installed: true }));
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) cleanupTestDir(root);
  roots.length = 0;
});

describe('setup command workflow', () => {
  it('registers and runs the scripted command without a network dependency', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    const bin = join(home, 'bin');
    roots.push(home, folder);
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, 'claude');
    writeFileSync(claude, '#!/bin/sh\nprintf "fake-claude 1.0\\n"\n');
    chmodSync(claude, 0o755);

    const result = await runCli([
      'setup',
      '--analyzer',
      'harness',
      '--harness',
      'claude-code',
      '--transcription',
      'skip',
      '--yes',
      '--json',
    ], {
      cwd: folder,
      env: { HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
    });

    expect(result.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(result.stdout), 'started')).toMatchObject({ command: 'setup' });
    expect(findEvent(parseJsonEvents(result.stdout), 'completed')?.data).toMatchObject({ ready: true });
    expect(result.stderr).not.toContain('API key');
    const config = z.record(z.string(), z.string()).parse(
      JSON.parse(readFileSync(join(folder, '.ai-video-cataloger', 'config.json'), 'utf8')),
    );
    expect(config.analyzer_backend).toBe('claude');
    expect(config.whisper_mode).toBe('skip');
  });

  it('drives non-interactive local setup on a temporary HOME with fake download ports', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    mkdirSync(join(folder, '.ai-video-cataloger'), { recursive: true });
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    const downloads = new InMemoryDownloads();
    const localAi = new InMemoryLocalAi();
    const whisperRuntime = new FakeWhisperRuntime();
    deps.downloads = downloads;
    deps.localAi = localAi;
    deps.whisperRuntime = whisperRuntime;
    deps.jobs = new InMemoryJobs();
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const progress: string[] = [];
    const completions: unknown[] = [];
    const errors: AppError[] = [];
    const output: SetupOutput = {
      started: () => undefined,
      progress: (event) => progress.push(event.step),
      completed: (data) => completions.push(data),
      error: (error) => errors.push(error),
      write: () => undefined,
    };

    const first = await executeSetup({
      api,
      folder,
      options: {
        analyzer: 'local',
        localModel: 'gemma3:12b',
        transcription: 'managed',
        whisperModel: 'base',
        yes: true,
        json: true,
      },
      output,
      environment: { HOME: home },
    });

    expect(first).toBe(true);
    expect(errors).toEqual([]);
    expect(localAi.pulled).toEqual(['gemma3:12b']);
    expect(whisperRuntime.installed).toBe(true);
    expect(downloads.downloaded).toContain('base');
    expect(progress).toEqual(expect.arrayContaining(['runtime_setup', 'model_download', 'downloading']));
    expect(completions).toHaveLength(1);
    const folderConfig = z.record(z.string(), z.string()).parse(
      JSON.parse(readFileSync(join(folder, '.ai-video-cataloger', 'config.json'), 'utf8')),
    );
    expect(folderConfig).toMatchObject({
      analyzer_backend: 'local',
      local_model: 'gemma3:12b',
      whisper_mode: 'local',
      whisper_model: 'base',
      whisper_binary_path: '',
    });
    expect(analyzerProviderConfigSchema.parse(JSON.parse(folderConfig.analyzer_provider ?? ''))).toEqual({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
    });
    localAi.statusValue.installedModels = ['gemma3:12b'];
    const second = await executeSetup({
      api,
      folder,
      options: { analyzer: 'local', localModel: 'gemma3:12b', transcription: 'managed', yes: true, json: true },
      output,
      environment: { HOME: home },
    });

    expect(second).toBe(true);
    expect(localAi.pulled).toEqual(['gemma3:12b']);
    expect(errors).toEqual([]);
  });

  it('stores compatible API credentials under the endpoint hostname', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    deps.providers = {
      test: (provider) => Promise.resolve(ok({
        family: 'api',
        providerId: provider.providerId,
        reachable: true,
        authenticated: true,
        latencyMs: 1,
        message: 'Available',
      })),
    };
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const errors: AppError[] = [];

    const completed = await executeSetup({
      api,
      folder,
      options: {
        analyzer: 'api',
        apiBaseUrl: 'https://openrouter.ai/api/v1',
        apiModel: 'vision-model',
        apiKeyEnv: 'ROUTER_KEY',
        transcription: 'skip',
        yes: true,
      },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: () => undefined,
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home, ROUTER_KEY: 'router-secret' },
    });
    const credential = await deps.credentials.get('openrouter.ai');
    const config = await deps.config.get({ kind: 'folder', folder }, 'analyzer_provider');

    expect(completed).toBe(true);
    expect(errors).toEqual([]);
    expect(credential).toEqual(ok('router-secret'));
    expect(config).toMatchObject({
      ok: true,
      value: expect.stringContaining('"apiKeyRef":"openrouter.ai"'),
    });
  });

  it('never probes local AI requirements when the analyzer is api', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    deps.providers = {
      test: (provider) => Promise.resolve(ok({
        family: 'api',
        providerId: provider.providerId,
        reachable: true,
        authenticated: true,
        latencyMs: 1,
        message: 'Available',
      })),
    };
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    let localRequirementsCalls = 0;
    const guardedApi = {
      ...api,
      localAiRequirements: (): ReturnType<typeof api.localAiRequirements> => {
        localRequirementsCalls += 1;
        return new Promise(() => undefined);
      },
    };
    const errors: AppError[] = [];

    const completed = await executeSetup({
      api: guardedApi,
      folder,
      options: {
        analyzer: 'api',
        apiBaseUrl: 'https://openrouter.ai/api/v1',
        apiModel: 'vision-model',
        apiKeyEnv: 'ROUTER_KEY',
        transcription: 'skip',
        yes: true,
      },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: () => undefined,
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home, ROUTER_KEY: 'router-secret' },
    });

    expect(completed).toBe(true);
    expect(errors).toEqual([]);
    expect(localRequirementsCalls).toBe(0);
  });

  it('stores harness model and effort plus Whisper API endpoint settings', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    deps.providers = {
      test: (provider) => provider.family === 'harness'
        ? Promise.resolve(ok({
            family: 'harness',
            providerId: provider.providerId,
            available: true,
            version: 'fake 1.0',
            latencyMs: 1,
            message: 'Available',
          }))
        : Promise.resolve(ok({
            family: 'api',
            providerId: provider.providerId,
            reachable: true,
            authenticated: true,
            latencyMs: 1,
            message: 'Available',
          })),
    };
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const errors: AppError[] = [];

    const completed = await executeSetup({
      api,
      folder,
      options: {
        analyzer: 'harness',
        harness: 'codex',
        harnessModel: 'gpt-5-codex',
        harnessEffort: 'high',
        transcription: 'api',
        whisperApiBaseUrl: 'https://transcribe.example.com/v1',
        whisperApiModel: 'whisper-large-v3',
        yes: true,
      },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: () => undefined,
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home, OPENAI_API_KEY: 'whisper-secret' },
    });
    const provider = await deps.config.get({ kind: 'folder', folder }, 'analyzer_provider');
    const whisperBaseUrl = await deps.config.get({ kind: 'folder', folder }, 'whisper_api_base_url');
    const whisperModel = await deps.config.get({ kind: 'folder', folder }, 'whisper_api_model');
    const credential = await deps.credentials.get('transcribe.example.com');

    expect(completed).toBe(true);
    expect(errors).toEqual([]);
    expect(provider).toMatchObject({
      ok: true,
      value: expect.stringContaining('"model":"gpt-5-codex"'),
    });
    expect(provider).toMatchObject({
      ok: true,
      value: expect.stringContaining('"reasoningEffort":"high"'),
    });
    expect(whisperBaseUrl).toEqual(ok('https://transcribe.example.com/v1'));
    expect(whisperModel).toEqual(ok('whisper-large-v3'));
    expect(credential).toEqual(ok('whisper-secret'));
  });

  it('scopes the harness model per harness so switching harnesses drops the previous model id', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    deps.providers = {
      test: (provider) => provider.family === 'harness'
        ? Promise.resolve(ok({
            family: 'harness',
            providerId: provider.providerId,
            available: true,
            version: 'fake 1.0',
            latencyMs: 1,
            message: 'Available',
          }))
        : Promise.resolve(ok({
            family: 'api',
            providerId: provider.providerId,
            reachable: true,
            authenticated: true,
            latencyMs: 1,
            message: 'Available',
          })),
    };
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const output: SetupOutput = {
      started: () => undefined,
      progress: () => undefined,
      completed: () => undefined,
      error: () => undefined,
      write: () => undefined,
    };

    expect(await executeSetup({
      api,
      folder,
      options: { analyzer: 'harness', harness: 'claude-code', harnessModel: 'claude-fable-5', transcription: 'skip', yes: true },
      output,
      environment: { HOME: home },
    })).toBe(true);

    expect(await executeSetup({
      api,
      folder,
      options: { analyzer: 'harness', harness: 'codex', transcription: 'skip', yes: true },
      output,
      environment: { HOME: home },
    })).toBe(true);

    const stored = await deps.config.get({ kind: 'folder', folder }, 'analyzer_provider');
    if (!stored.ok || stored.value === null) throw new Error('Expected a stored analyzer provider');
    const parsed = analyzerProviderConfigSchema.parse(JSON.parse(stored.value));
    expect(parsed).toMatchObject({ family: 'harness', providerId: 'codex' });
    expect(parsed.family === 'harness' ? parsed.model : 'set').toBeUndefined();
  });

  it('rejects setup flags scoped to the wrong family', async () => {
    const folder = createTestDir();
    roots.push(folder);
    const deps = createDeps({ workingDirectory: folder });
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const errors: AppError[] = [];
    const output: SetupOutput = {
      started: () => undefined,
      progress: () => undefined,
      completed: () => undefined,
      error: (error) => errors.push(error),
      write: () => undefined,
    };

    expect(await executeSetup({
      api,
      folder,
      options: { analyzer: 'local', harnessModel: 'ignored', transcription: 'skip', yes: true },
      output,
      environment: {},
    })).toBe(false);
    expect(await executeSetup({
      api,
      folder,
      options: { analyzer: 'local', transcription: 'skip', whisperApiModel: 'custom', yes: true },
      output,
      environment: {},
    })).toBe(false);
    expect(errors.map((error) => error.code)).toEqual(['invalid_config_value', 'invalid_config_value']);
  });

  it('keeps non-interactive local setup not ready when the runtime is unreachable', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    const localAi = new InMemoryLocalAi();
    localAi.statusValue = {
      runtimeUp: false,
      runtimeVersion: '1.0.0',
      installedModels: [],
    };
    deps.localAi = localAi;
    deps.jobs = new InMemoryJobs();
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency('gemma3:12b', false);
    deps.analyzer = analyzer;
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const completions: Array<{ data: unknown; human: string }> = [];
    const errors: AppError[] = [];

    const completed = await executeSetup({
      api,
      folder,
      options: { analyzer: 'local', localModel: 'gemma3:12b', transcription: 'skip', yes: true, json: true },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: (data, human) => completions.push({ data, human }),
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home },
    });

    expect(completed).toBe(true);
    expect(localAi.pulled).toEqual(['gemma3:12b']);
    expect(errors).toEqual([]);
    expect(completions).toMatchObject([{
      data: {
        ready: false,
        analyzer: { available: false },
        suggestedAction: expect.stringContaining('setup'),
      },
      human: expect.stringContaining('processing is not ready'),
    }]);
  });

  it('downloads the whisper model for an own binary setup', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    const downloads = new InMemoryDownloads();
    const localAi = new InMemoryLocalAi();
    const whisperPath = join(home, 'whisper');
    writeFileSync(whisperPath, '#!/bin/sh\n');
    chmodSync(whisperPath, 0o755);
    localAi.statusValue.installedModels = ['gemma3:12b'];
    deps.downloads = downloads;
    deps.localAi = localAi;
    deps.jobs = new InMemoryJobs();
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const errors: AppError[] = [];

    const completed = await executeSetup({
      api,
      folder,
      options: {
        analyzer: 'local',
        localModel: 'gemma3:12b',
        transcription: 'own',
        whisperPath,
        whisperModel: 'base',
        yes: true,
      },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: () => undefined,
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home },
    });

    expect(completed).toBe(true);
    expect(errors).toEqual([]);
    expect(downloads.downloaded).toContain('base');
  });

  it('rejects a non-executable own Whisper path before persisting it', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const deps = createDeps({ homeDirectory: home, workingDirectory: folder });
    deps.analyzer = new InMemoryAnalyzer();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });
    const errors: AppError[] = [];
    const missingPath = join(home, 'missing-whisper');

    const completed = await executeSetup({
      api,
      folder,
      options: {
        analyzer: 'local',
        localModel: 'gemma3:12b',
        transcription: 'own',
        whisperPath: missingPath,
        yes: true,
      },
      output: {
        started: () => undefined,
        progress: () => undefined,
        completed: () => undefined,
        error: (error) => errors.push(error),
        write: () => undefined,
      },
      environment: { HOME: home },
    });
    const stored = await deps.config.get({ kind: 'home' }, 'whisper_binary_path');

    expect(completed).toBe(false);
    expect(errors).toMatchObject([{ code: 'invalid_config_value', message: expect.stringContaining(missingPath) }]);
    expect(stored).toEqual(ok(null));
  });
});
