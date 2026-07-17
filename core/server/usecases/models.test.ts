import { describe, expect, it } from 'vitest';

import {
  deleteWhisperModel,
  downloadWhisperModel,
  installWhisperRuntime,
  listWhisperModels,
  localAiRequirements,
  pullLocalAiModel,
  removeLocalAiModel,
  stopLocalAiDaemon,
  useWhisperModel,
} from './models.js';
import { InMemoryConfig, InMemoryDownloads, InMemoryJobs, InMemoryLocalAi } from '../../../test/server/usecases/test-fakes.js';
import { ok } from '@core/domain/index.js';

describe('model use-cases', () => {
  it('lists whisper models with downloaded and active flags', async () => {
    const config = new InMemoryConfig();
    const downloads = new InMemoryDownloads();
    downloads.downloaded.add('small');
    await config.set({ kind: 'home' }, 'whisper_model', 'small');

    const result = await listWhisperModels({ config, downloads, jobs: new InMemoryJobs(), localAi: new InMemoryLocalAi() });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.models).toEqual(
      expect.arrayContaining([{ name: 'small', size: '466MB', downloaded: true, active: true }]),
    );
  });

  it('uses jobs for long-running downloads and local model pulls', async () => {
    const deps = {
      config: new InMemoryConfig(),
      downloads: new InMemoryDownloads(),
      jobs: new InMemoryJobs(),
      localAi: new InMemoryLocalAi(),
    };

    const whisper = await downloadWhisperModel(deps, { modelName: 'base', force: false });
    const local = await pullLocalAiModel(deps, { tag: 'gemma3:12b' });
    const runtime = await installWhisperRuntime({
      ...deps,
      whisperRuntime: {
        status: () => Promise.resolve(ok({
          available: false,
          path: null,
          source: null,
          version: null,
          managedInstalled: false,
          buildToolsAvailable: true,
          missingBuildTools: [],
        })),
        install: () => Promise.resolve(ok({ path: '/bin/whisper', version: 'v1.9.1', installed: true })),
      },
    });
    const listed = await deps.jobs.list();

    expect(whisper).toEqual({ ok: true, value: { jobId: 'job-1' } });
    expect(local).toEqual({ ok: true, value: { jobId: 'job-2' } });
    expect(runtime).toEqual({ ok: true, value: { jobId: 'job-3' } });
    expect(listed).toMatchObject({
      ok: true,
      value: [
        { resourceKey: 'whisper-model:base' },
        { resourceKey: 'local-ai:gemma3:12b' },
        { resourceKey: 'whisper-runtime-install' },
      ],
    });
  });

  it('rejects duplicate jobs that target the same model or runtime resource', async () => {
    const jobs = new InMemoryJobs();
    for (const [jobId, kind, resourceKey] of [
      ['existing-whisper', 'whisper_download', 'whisper-model:base'],
      ['existing-local', 'local_ai_pull', 'local-ai:gemma3:12b'],
      ['existing-runtime', 'whisper_runtime_install', 'whisper-runtime-install'],
    ] as const) {
      jobs.addJob({
        jobId,
        kind,
        resourceKey,
        status: 'running',
        progress: null,
        progressEvents: [],
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    const deps = {
      config: new InMemoryConfig(),
      downloads: new InMemoryDownloads(),
      jobs,
      localAi: new InMemoryLocalAi(),
    };
    const whisperRuntime = {
      status: () => Promise.resolve(ok({
        available: false,
        path: null,
        source: null,
        version: null,
        managedInstalled: false,
        buildToolsAvailable: true,
        missingBuildTools: [],
      })),
      install: () => Promise.resolve(ok({ path: '/bin/whisper', version: 'v1.9.1', installed: true })),
    };

    const whisper = await downloadWhisperModel(deps, { modelName: 'base', force: false });
    const local = await pullLocalAiModel(deps, { tag: 'gemma3:12b' });
    const runtime = await installWhisperRuntime({ ...deps, whisperRuntime });

    expect(whisper).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(local).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(runtime).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('sets the active whisper model and reports whether it is downloaded', async () => {
    const downloads = new InMemoryDownloads();
    downloads.downloaded.add('base');
    const deps = { config: new InMemoryConfig(), downloads, jobs: new InMemoryJobs(), localAi: new InMemoryLocalAi() };

    const result = await useWhisperModel(deps, { modelName: 'base' });

    expect(result).toEqual({ ok: true, value: { model: 'base', size: '142MB', downloaded: true } });
  });

  it('requires force before deleting whisper models', async () => {
    const deps = {
      config: new InMemoryConfig(),
      downloads: new InMemoryDownloads(),
      jobs: new InMemoryJobs(),
      localAi: new InMemoryLocalAi(),
    };

    const result = await deleteWhisperModel(deps, { modelName: 'base', force: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'confirmation_required' } });
  });

  it('reports local AI requirements and daemon actions', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.statusValue = { runtimeUp: true, runtimeVersion: '2.0.0', installedModels: ['gemma3:12b'] };
    const deps = { config: new InMemoryConfig(), downloads: new InMemoryDownloads(), jobs: new InMemoryJobs(), localAi };

    const requirements = await localAiRequirements(deps);
    const removed = await removeLocalAiModel(deps, { tag: 'gemma3:12b' });
    const stopped = await stopLocalAiDaemon(deps);

    expect(requirements.ok).toBe(true);
    if (!requirements.ok) throw new Error(requirements.error.message);
    expect(requirements.value.runtimeVersion).toBe('2.0.0');
    expect(requirements.value.tiers).toEqual(
      expect.arrayContaining([
        {
          tag: 'gemma3:12b',
          label: 'Gemma 3 12B standard',
          downloadGB: 8.1,
          minTotalMemGB: 16,
          supportLevel: 'ok',
          installed: true,
          recommended: true,
        },
      ]),
    );
    expect(removed).toEqual({ ok: true, value: { tag: 'gemma3:12b', status: 'removed' } });
    expect(stopped).toEqual({ ok: true, value: { stopped: true } });
  });

  it('does not report stale model data as installed while the runtime is unreachable', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.statusValue = { runtimeUp: false, runtimeVersion: '2.0.0', installedModels: ['gemma3:12b'] };
    const deps = { config: new InMemoryConfig(), downloads: new InMemoryDownloads(), jobs: new InMemoryJobs(), localAi };

    const requirements = await localAiRequirements(deps);

    expect(requirements.ok).toBe(true);
    if (!requirements.ok) throw new Error(requirements.error.message);
    expect(requirements.value.runtimeUp).toBe(false);
    expect(requirements.value.tiers.find((tier) => tier.tag === 'gemma3:12b')).toMatchObject({ installed: false });
  });

  it('blocks known local model pulls when hardware is insufficient', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.machineValue = { platform: 'darwin', arch: 'arm64', ramGb: 8 };
    const deps = { config: new InMemoryConfig(), downloads: new InMemoryDownloads(), jobs: new InMemoryJobs(), localAi };

    const result = await pullLocalAiModel(deps, { tag: 'gemma3:12b' });

    expect(result).toMatchObject({ ok: false, error: { code: 'hw_requirements_not_met' } });
  });

  it('does not begin model download progress until the runtime is ready', async () => {
    const jobs = new InMemoryJobs();
    const localAi = new InMemoryLocalAi();
    let stepsBeforeRuntimeReady: string[] = [];
    localAi.beforeRuntimeReady = () => {
      stepsBeforeRuntimeReady = jobs.progressEvents.map((event) => event.step);
    };
    const deps = { config: new InMemoryConfig(), downloads: new InMemoryDownloads(), jobs, localAi };

    await pullLocalAiModel(deps, { tag: 'gemma3:12b' });

    expect(stepsBeforeRuntimeReady).toEqual(['runtime_setup']);
    expect(jobs.progressEvents.map((event) => event.step)).toEqual([
      'runtime_setup',
      'model_download',
      'model_download',
      'model_download',
    ]);
  });
});
