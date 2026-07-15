import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type {
  AnalyzerProviderConfig,
  ConfigKey,
  WhisperModelName,
} from '@core/domain/index.js';
import type { readinessOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import {
  analyzerBackendFor,
  buildApiProvider,
  buildHarnessProvider,
  buildLocalProvider,
  emptyApiDraft,
  harnessDescriptors,
  recommendedTier,
  type AnalyzerFamily,
  type ApiDraft,
  type HarnessDescriptor,
  type LocalAiTier,
  type Machine,
  type TranscriptionMode,
  type WizardStep,
} from './wizard-model.js';

type Readiness = z.output<typeof readinessOutputSchema>;

export type ValidationStatus = 'idle' | 'testing' | 'ok' | 'error';

export interface HarnessAvailability {
  status: 'unknown' | 'available' | 'unavailable';
  version: string | null;
}

export interface DownloadProgress {
  label: string;
  percentage: number;
  status: 'running' | 'done' | 'error';
}

const DEFAULT_WHISPER_MODEL: WhisperModelName = 'base';

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export interface WizardController {
  step: WizardStep;
  machine: Machine | null;
  tiers: LocalAiTier[];
  harnesses: readonly HarnessDescriptor[];
  harnessAvailability: Record<string, HarnessAvailability>;
  whisperRuntimeAvailable: boolean;
  whisperBuildToolsMissing: string[];
  analyzerFamily: AnalyzerFamily;
  localModelTag: string;
  apiDraft: ApiDraft;
  harnessId: string;
  transcriptionMode: TranscriptionMode;
  whisperBinaryPath: string;
  validation: ValidationStatus;
  validationMessage: string | null;
  downloads: DownloadProgress[];
  plannedDownloadLabels: string[];
  isDownloading: boolean;
  readiness: Readiness | null;
  isCheckingReadiness: boolean;
  checkReadiness: () => void;
  canGoBack: boolean;
  setAnalyzerFamily: (family: AnalyzerFamily) => void;
  setLocalModelTag: (tag: string) => void;
  setApiDraft: (patch: Partial<ApiDraft>) => void;
  setHarnessId: (id: string) => void;
  setTranscriptionMode: (mode: TranscriptionMode) => void;
  setWhisperBinaryPath: (path: string) => void;
  next: () => void;
  back: () => void;
  finish: () => void;
}

export interface UseWizardOptions {
  open: boolean;
  folder: string | null;
  onFinish: () => void;
  intervalMs?: number;
}

export const useWizard = ({ open, folder, onFinish, intervalMs = 1000 }: UseWizardOptions): WizardController => {
  const queryClient = useQueryClient();
  const requirements = useQuery({ ...actions.localAiRequirements, enabled: open });
  const whisperRuntime = useQuery({ ...actions.whisperRuntime, enabled: open });
  const setConfig = useMutation(actions.setConfig);
  const setCredential = useMutation(actions.setCredential);
  const testProvider = useMutation(actions.testProvider);
  const installWhisperRuntime = useMutation(actions.installWhisperRuntime);
  const pullLocalAiModel = useMutation(actions.pullLocalAiModel);
  const downloadWhisperModel = useMutation(actions.downloadWhisperModel);

  const tiers = useMemo(() => requirements.data?.tiers ?? [], [requirements.data]);
  const machine = requirements.data?.machine ?? null;
  const harnesses = useMemo(() => harnessDescriptors(), []);

  const [step, setStep] = useState<WizardStep>('welcome');
  const [analyzerFamily, setAnalyzerFamilyState] = useState<AnalyzerFamily>('local');
  const [localModelTag, setLocalModelTag] = useState<string>('');
  const [apiDraft, setApiDraftState] = useState<ApiDraft>(emptyApiDraft);
  const [harnessId, setHarnessId] = useState<string>('claude-code');
  const [harnessAvailability, setHarnessAvailability] = useState<Record<string, HarnessAvailability>>({});
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>('managed');
  const [whisperBinaryPath, setWhisperBinaryPath] = useState<string>('');
  const [validation, setValidation] = useState<ValidationStatus>('idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);

  const effectiveLocalTag = localModelTag.length > 0 ? localModelTag : recommendedTier(tiers)?.tag ?? 'gemma3:12b';

  const setApiDraft = useCallback((patch: Partial<ApiDraft>) => {
    setApiDraftState((current) => ({ ...current, ...patch }));
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const setAnalyzerFamily = useCallback((family: AnalyzerFamily) => {
    setAnalyzerFamilyState(family);
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const writeConfig = useCallback(
    async (key: ConfigKey, value: string): Promise<void> => {
      await setConfig.mutateAsync(folder === null ? { key, value } : { folder, key, value });
    },
    [setConfig, folder],
  );

  const persistAnalyzer = useCallback(
    async (provider: AnalyzerProviderConfig): Promise<void> => {
      await writeConfig('analyzer_provider', JSON.stringify(provider));
      await writeConfig('analyzer_backend', analyzerBackendFor(provider));
      if (provider.family === 'local') await writeConfig('local_model', provider.modelTag);
    },
    [writeConfig],
  );

  const validateAndAdvanceAnalyzer = useCallback(async (): Promise<void> => {
    setValidation('testing');
    setValidationMessage(null);
    try {
      if (analyzerFamily === 'api') {
        const provider = buildApiProvider(apiDraft);
        if (apiDraft.credential.trim().length > 0) {
          await setCredential.mutateAsync({ providerId: provider.apiKeyRef, credential: apiDraft.credential.trim() });
        }
        const result = await testProvider.mutateAsync(provider);
        if (result.family !== 'api' || !result.reachable || !result.authenticated) {
          setValidation('error');
          setValidationMessage(result.message);
          return;
        }
        await persistAnalyzer(provider);
      } else if (analyzerFamily === 'harness') {
        const descriptor = harnesses.find((entry) => entry.providerId === harnessId) ?? harnesses[0];
        if (descriptor === undefined) {
          setValidation('error');
          setValidationMessage('No harness is available');
          return;
        }
        const provider = buildHarnessProvider(descriptor);
        const result = await testProvider.mutateAsync(provider);
        if (result.family !== 'harness' || !result.available) {
          setValidation('error');
          setValidationMessage(result.message);
          return;
        }
        await persistAnalyzer(provider);
      } else {
        await persistAnalyzer(buildLocalProvider(effectiveLocalTag));
      }
      setValidation('ok');
      setStep('transcription');
    } catch (error) {
      setValidation('error');
      setValidationMessage(messageOf(error));
    }
  }, [
    analyzerFamily,
    apiDraft,
    effectiveLocalTag,
    harnessId,
    harnesses,
    persistAnalyzer,
    setCredential,
    testProvider,
  ]);

  const persistTranscription = useCallback(async (): Promise<void> => {
    switch (transcriptionMode) {
      case 'managed':
        await writeConfig('whisper_mode', 'local');
        await writeConfig('whisper_model', DEFAULT_WHISPER_MODEL);
        return;
      case 'own':
        await writeConfig('whisper_mode', 'local');
        await writeConfig('whisper_binary_path', whisperBinaryPath.trim());
        return;
      case 'api':
        await writeConfig('whisper_mode', 'api');
        return;
      case 'skip':
        await writeConfig('whisper_mode', 'skip');
        return;
    }
  }, [transcriptionMode, whisperBinaryPath, writeConfig]);

  const advanceTranscription = useCallback(async (): Promise<void> => {
    setValidation('testing');
    setValidationMessage(null);
    try {
      await persistTranscription();
      setValidation('ok');
      setStep('downloads');
    } catch (error) {
      setValidation('error');
      setValidationMessage(messageOf(error));
    }
  }, [persistTranscription]);

  const pollJob = useCallback(
    async (jobId: string, label: string, index: number): Promise<boolean> => {
      const final = await pollJobUntilTerminal(jobId, {
        intervalMs,
        delay: sleep,
        fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
        isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
        onSnapshot: (job) => {
          if (job.progress !== null) {
            const percentage = Math.round(job.progress.percentage ?? 0);
            setDownloads((current) =>
              current.map((task, taskIndex) =>
                taskIndex === index ? { ...task, percentage, status: 'running' } : task,
              ),
            );
          }
        },
      });
      const ok = final.status === 'completed';
      setDownloads((current) =>
        current.map((task, taskIndex) =>
          taskIndex === index
            ? { label, percentage: ok ? 100 : task.percentage, status: ok ? 'done' : 'error' }
            : task,
        ),
      );
      if (!ok) setValidationMessage(final.error?.message ?? 'Download failed');
      return ok;
    },
    [intervalMs, queryClient],
  );

  const plannedDownloads = useMemo(() => {
    const tasks: { kind: 'local-ai' | 'whisper-runtime' | 'whisper-model'; label: string }[] = [];
    if (analyzerFamily === 'local') {
      const tier = tiers.find((entry) => entry.tag === effectiveLocalTag);
      if (tier === undefined || !tier.installed) {
        tasks.push({ kind: 'local-ai', label: `Downloading local model ${effectiveLocalTag}` });
      }
    }
    if (transcriptionMode === 'managed') {
      if (!(whisperRuntime.data?.available ?? false)) {
        tasks.push({ kind: 'whisper-runtime', label: 'Building the managed whisper.cpp runtime' });
      }
      tasks.push({ kind: 'whisper-model', label: `Downloading whisper model ${DEFAULT_WHISPER_MODEL}` });
    }
    return tasks;
  }, [analyzerFamily, effectiveLocalTag, tiers, transcriptionMode, whisperRuntime.data]);

  const runDownloads = useCallback(async (): Promise<void> => {
    setIsDownloading(true);
    setValidationMessage(null);
    setDownloads(plannedDownloads.map((task) => ({ label: task.label, percentage: 0, status: 'running' })));
    try {
      for (let index = 0; index < plannedDownloads.length; index += 1) {
        const task = plannedDownloads[index];
        if (task === undefined) continue;
        let jobId: string;
        if (task.kind === 'local-ai') {
          jobId = (await pullLocalAiModel.mutateAsync({ tag: effectiveLocalTag })).jobId;
        } else if (task.kind === 'whisper-runtime') {
          jobId = (await installWhisperRuntime.mutateAsync(undefined)).jobId;
        } else {
          jobId = (await downloadWhisperModel.mutateAsync({ modelName: DEFAULT_WHISPER_MODEL })).jobId;
        }
        const ok = await pollJob(jobId, task.label, index);
        if (!ok) {
          setIsDownloading(false);
          return;
        }
      }
      setIsDownloading(false);
      setStep('readiness');
    } catch (error) {
      setValidationMessage(messageOf(error));
      setIsDownloading(false);
    }
  }, [
    downloadWhisperModel,
    effectiveLocalTag,
    installWhisperRuntime,
    plannedDownloads,
    pollJob,
    pullLocalAiModel,
  ]);

  const checkReadiness = useCallback((): void => {
    setIsCheckingReadiness(true);
    void (async () => {
      try {
        const result = await queryClient.fetchQuery(
          actions.readiness(folder === null ? { refresh: 'true' } : { folder, refresh: 'true' }),
        );
        setReadiness(result);
      } catch (error) {
        setValidationMessage(messageOf(error));
      } finally {
        setIsCheckingReadiness(false);
      }
    })();
  }, [folder, queryClient]);

  const next = useCallback(() => {
    switch (step) {
      case 'welcome':
        setStep('analyzer');
        return;
      case 'analyzer':
        void validateAndAdvanceAnalyzer();
        return;
      case 'transcription':
        void advanceTranscription();
        return;
      case 'downloads':
        void runDownloads();
        return;
      case 'readiness':
        setStep('done');
        return;
      case 'done':
        onFinish();
        return;
    }
  }, [step, validateAndAdvanceAnalyzer, advanceTranscription, runDownloads, onFinish]);

  const back = useCallback(() => {
    setValidation('idle');
    setValidationMessage(null);
    switch (step) {
      case 'analyzer':
        setStep('welcome');
        return;
      case 'transcription':
        setStep('analyzer');
        return;
      case 'downloads':
        setStep('transcription');
        return;
      case 'readiness':
        setStep('downloads');
        return;
      case 'welcome':
      case 'done':
        return;
    }
  }, [step]);

  const finish = useCallback(() => {
    onFinish();
  }, [onFinish]);

  const detectHarness = useCallback(
    (descriptor: HarnessDescriptor): void => {
      setHarnessAvailability((current) => ({ ...current, [descriptor.providerId]: { status: 'unknown', version: null } }));
      void (async () => {
        try {
          const result = await testProvider.mutateAsync(buildHarnessProvider(descriptor));
          if (result.family !== 'harness') return;
          setHarnessAvailability((current) => ({
            ...current,
            [descriptor.providerId]: {
              status: result.available ? 'available' : 'unavailable',
              version: result.version,
            },
          }));
        } catch {
          setHarnessAvailability((current) => ({
            ...current,
            [descriptor.providerId]: { status: 'unavailable', version: null },
          }));
        }
      })();
    },
    [testProvider],
  );

  const setAnalyzerFamilyWithDetection = useCallback(
    (family: AnalyzerFamily) => {
      setAnalyzerFamily(family);
      if (family === 'harness') {
        for (const descriptor of harnesses) {
          if (harnessAvailability[descriptor.providerId] === undefined) detectHarness(descriptor);
        }
      }
    },
    [harnesses, harnessAvailability, detectHarness, setAnalyzerFamily],
  );

  return {
    step,
    machine,
    tiers,
    harnesses,
    harnessAvailability,
    whisperRuntimeAvailable: whisperRuntime.data?.available ?? false,
    whisperBuildToolsMissing: whisperRuntime.data?.missingBuildTools ?? [],
    analyzerFamily,
    localModelTag: effectiveLocalTag,
    apiDraft,
    harnessId,
    transcriptionMode,
    whisperBinaryPath,
    validation,
    validationMessage,
    downloads,
    plannedDownloadLabels: plannedDownloads.map((task) => task.label),
    isDownloading,
    readiness,
    isCheckingReadiness,
    checkReadiness,
    canGoBack: step !== 'welcome' && step !== 'done' && !isDownloading,
    setAnalyzerFamily: setAnalyzerFamilyWithDetection,
    setLocalModelTag,
    setApiDraft,
    setHarnessId,
    setTranscriptionMode,
    setWhisperBinaryPath,
    next,
    back,
    finish,
  };
};
