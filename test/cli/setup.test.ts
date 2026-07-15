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
    const config = z.record(z.string()).parse(
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
    const folderConfig = z.record(z.string()).parse(
      JSON.parse(readFileSync(join(folder, '.ai-video-cataloger', 'config.json'), 'utf8')),
    );
    expect(folderConfig).toMatchObject({
      analyzer_backend: 'local',
      local_model: 'gemma3:12b',
      whisper_mode: 'local',
      whisper_model: 'base',
    });
    expect(analyzerProviderConfigSchema.parse(JSON.parse(folderConfig.analyzer_provider ?? ''))).toEqual({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
    });
    expect(z.record(z.string()).parse(
      JSON.parse(readFileSync(join(home, '.ai-video-cataloger', 'config.json'), 'utf8')),
    )).toEqual({
      whisper_binary_path: '',
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
});
