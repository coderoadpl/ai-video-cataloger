import {
  LOCAL_AI_HARDWARE_TIERS,
  WHISPER_MODELS,
  appError,
  getLocalAiSupportLevel,
  ok,
  type AppError,
  type ConfigKey,
  type LocalAiHardwareTier,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';

import { JOB_CANCELLED_ERROR_MESSAGE } from '../ports.js';
import type {
  ConfigStore,
  JobsPort,
  LocalAiRuntimePort,
  ModelDownloadPort,
  WhisperRuntimePort,
  WhisperRuntimeStatus,
} from '../ports.js';

export interface ModelsDeps {
  config: ConfigStore;
  downloads: ModelDownloadPort;
  jobs: JobsPort;
  localAi: LocalAiRuntimePort;
}

type WhisperRuntimeDeps = ModelsDeps & { whisperRuntime: WhisperRuntimePort };

export interface WhisperModelListEntry {
  name: WhisperModelName;
  size: string;
  downloaded: boolean;
  active: boolean;
}

export interface WhisperModelsListOutput {
  models: WhisperModelListEntry[];
}

export interface JobAcceptedOutput {
  jobId: string;
}

export const whisperRuntimeStatus = (deps: WhisperRuntimeDeps): Promise<Result<WhisperRuntimeStatus, AppError>> =>
  deps.whisperRuntime.status();

export const installWhisperRuntime = (
  deps: WhisperRuntimeDeps,
): Promise<Result<JobAcceptedOutput, AppError>> =>
  deps.jobs.enqueue({
    kind: 'whisper_runtime_install',
    payload: {},
    resourceKey: 'whisper-runtime-install',
    run: async (context) => {
      const started = await context.reportProgress({ step: 'runtime_setup', percentage: 0 });
      if (!started.ok) return started;
      const installed = await deps.whisperRuntime.install({
        signal: context.signal,
        onProgress: (progress) => context.reportProgress({
          step: 'runtime_setup',
          percentage: progress.percentage,
          data: {
            phase: progress.phase,
            ...(progress.artifact === undefined ? {} : { artifact: progress.artifact }),
          },
        }),
      });
      if (context.signal.aborted) return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
      if (!installed.ok) return installed;
      const completed = await context.reportProgress({ step: 'runtime_setup', percentage: 100 });
      if (!completed.ok) return completed;
      return ok(installed.value);
    },
  });

export interface WhisperModelDeleteOutput {
  model: WhisperModelName;
  path: string;
  deleted: boolean;
}

export interface WhisperModelUseOutput {
  model: WhisperModelName;
  size?: string;
  downloaded: boolean;
}

export interface LocalAiRequirementsOutput {
  machine: {
    platform: string;
    arch: string;
    totalMemGB: number;
    appleSilicon: boolean;
  };
  runtimeUp: boolean;
  runtimeVersion: string;
  tiers: {
    tag: string;
    label: string;
    downloadGB: number;
    minTotalMemGB: number;
    supportLevel: 'ok' | 'insufficient-ram' | 'unsupported-platform';
    installed: boolean;
    recommended: boolean;
  }[];
}

export const listWhisperModels = async (deps: ModelsDeps): Promise<Result<WhisperModelsListOutput, AppError>> => {
  const activeKey: ConfigKey = 'whisper_model';
  const active = await deps.config.get({ kind: 'home' }, activeKey);
  if (!active.ok) return active;
  const activeModel = normalizeActiveModel(active.value);

  const models: WhisperModelListEntry[] = [];
  for (const model of Object.values(WHISPER_MODELS)) {
    const downloaded = await deps.downloads.isWhisperModelDownloaded(model.name);
    if (!downloaded.ok) return downloaded;
    models.push({
      name: model.name,
      size: model.size,
      downloaded: downloaded.value,
      active: model.name === activeModel,
    });
  }

  return ok({ models });
};

export const downloadWhisperModel = async (
  deps: ModelsDeps,
  input: { modelName: WhisperModelName; force: boolean },
): Promise<Result<JobAcceptedOutput, AppError>> =>
  deps.jobs.enqueue({
    kind: 'whisper_download',
    payload: { modelName: input.modelName, force: input.force },
    resourceKey: `whisper-model:${input.modelName}`,
    run: async (context) => {
      const started = await context.reportProgress({ step: 'downloading', percentage: 0 });
      if (!started.ok) return started;
      const downloaded = await deps.downloads.downloadWhisperModel(input.modelName, {
        force: input.force,
        signal: context.signal,
        onProgress: (progress) => {
          void context.reportProgress({
            step: 'downloading',
            ...(progress.percentage === null ? {} : { percentage: progress.percentage }),
            data: {
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speed: progress.speed,
            },
          });
        },
      });
      if (context.signal.aborted) return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
      if (!downloaded.ok) return downloaded;
      const completed = await context.reportProgress({ step: 'downloading', percentage: 100 });
      if (!completed.ok) return completed;
      return ok(downloaded.value);
    },
  });

export const deleteWhisperModel = async (
  deps: ModelsDeps,
  input: { modelName: WhisperModelName; force: boolean },
): Promise<Result<WhisperModelDeleteOutput, AppError>> => {
  if (!input.force) {
    return { ok: false, error: appError('confirmation_required', 'Deletion requires --force flag') };
  }
  const deleted = await deps.downloads.deleteWhisperModel(input.modelName, { force: input.force });
  if (!deleted.ok) return deleted;
  return ok(deleted.value);
};

export const useWhisperModel = async (
  deps: ModelsDeps,
  input: { modelName: WhisperModelName },
): Promise<Result<WhisperModelUseOutput, AppError>> => {
  const activeKey: ConfigKey = 'whisper_model';
  const saved = await deps.config.set({ kind: 'home' }, activeKey, input.modelName);
  if (!saved.ok) return saved;
  const downloaded = await deps.downloads.isWhisperModelDownloaded(input.modelName);
  if (!downloaded.ok) return downloaded;
  return ok({
    model: input.modelName,
    size: WHISPER_MODELS[input.modelName].size,
    downloaded: downloaded.value,
  });
};

export const localAiRequirements = async (
  deps: ModelsDeps,
): Promise<Result<LocalAiRequirementsOutput, AppError>> => {
  const machine = await deps.localAi.machine();
  if (!machine.ok) return machine;
  const status = await deps.localAi.status();
  if (!status.ok) return status;
  const recommended = recommendTier(machine.value);
  const appleSilicon = machine.value.platform === 'darwin' && machine.value.arch === 'arm64';

  return ok({
    machine: {
      platform: machine.value.platform,
      arch: machine.value.arch,
      totalMemGB: machine.value.ramGb,
      appleSilicon,
    },
    runtimeUp: status.value.runtimeUp,
    runtimeVersion: status.value.runtimeVersion,
    tiers: Object.values(LOCAL_AI_HARDWARE_TIERS).map((tier) => ({
      tag: tier.tag,
      label: tier.label,
      downloadGB: tier.downloadGb,
      minTotalMemGB: tier.minimumRamGb,
      supportLevel: getLocalAiSupportLevel(tier, machine.value),
      installed: status.value.runtimeUp && isInstalled(status.value.installedModels, tier.tag),
      recommended: recommended?.tag === tier.tag,
    })),
  });
};

export const pullLocalAiModel = async (
  deps: ModelsDeps,
  input: { tag: string },
): Promise<Result<JobAcceptedOutput, AppError>> => {
  const machine = await deps.localAi.machine();
  if (!machine.ok) return machine;
  const tier = findTier(input.tag);
  if (tier !== null && getLocalAiSupportLevel(tier, machine.value) !== 'ok') {
    return {
      ok: false,
      error: appError('hw_requirements_not_met', `Hardware requirements not met for ${input.tag}`, {
        tag: input.tag,
        machine: machine.value,
      }),
    };
  }
  return deps.jobs.enqueue({
    kind: 'local_ai_pull',
    payload: { tag: input.tag },
    resourceKey: `local-ai:${input.tag}`,
    run: async (context) => {
      const runtime = await context.reportProgress({ step: 'runtime_setup', percentage: 0 });
      if (!runtime.ok) return runtime;
      let lastPercent = -1;
      const pulled = await deps.localAi.pull(input.tag, {
        signal: context.signal,
        onRuntimeReady: () => context.reportProgress({ step: 'model_download', percentage: 0 }),
        onProgress: (progress) => {
          if (progress.percentage === null || progress.percentage === lastPercent) return;
          lastPercent = progress.percentage;
          void context.reportProgress({
            step: 'model_download',
            percentage: progress.percentage,
            data: { tag: progress.tag, status: progress.status },
          });
        },
      });
      if (context.signal.aborted) return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
      if (!pulled.ok) return pulled;
      const completed = await context.reportProgress({ step: 'model_download', percentage: 100 });
      if (!completed.ok) return completed;
      return ok(pulled.value);
    },
  });
};

export const removeLocalAiModel = async (
  deps: ModelsDeps,
  input: { tag: string },
): Promise<Result<{ tag: string; status: 'removed' }, AppError>> =>
  deps.localAi.rm(input.tag);

export const stopLocalAiDaemon = async (
  deps: ModelsDeps,
): Promise<Result<{ stopped: boolean }, AppError>> =>
  deps.localAi.stopManagedDaemon();

const normalizeActiveModel = (value: string | null): WhisperModelName => {
  if (value === 'tiny' || value === 'base' || value === 'small' || value === 'medium' || value === 'large-v3') {
    return value;
  }
  return 'base';
};

const isInstalled = (installedModels: string[], tag: string): boolean =>
  installedModels.some((installed) => installed === tag || installed === `${tag}:latest`);

const findTier = (tag: string): LocalAiHardwareTier | null =>
  Object.values(LOCAL_AI_HARDWARE_TIERS).find((tier) => tier.tag === tag) ?? null;

const recommendTier = (machine: { platform: string; arch: string; ramGb: number }): LocalAiHardwareTier | null => {
  const supported = Object.values(LOCAL_AI_HARDWARE_TIERS).filter(
    (tier) => getLocalAiSupportLevel(tier, machine) === 'ok',
  );
  if (supported.length === 0) return null;
  const preferred = supported.find((tier) => tier.tag === 'gemma3:12b') ?? null;
  if (preferred !== null) return preferred;
  return supported.reduce((best, tier) => (tier.minimumRamGb > best.minimumRamGb ? tier : best));
};
