import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type {
  AnalyzerProviderConfig,
  ConfigKey,
  WhisperModelName,
} from '@core/domain/index.js';
import type { doctorOutputSchema, readinessOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { Locale } from '../../i18n/dictionary.js';
import { useDictionary, useUiLanguage } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { savedToastStore } from '../../lib/saved-toast.js';
import {
  analyzerBackendFor,
  bestInstalledWhisperModel,
  buildApiProvider,
  buildGeminiProvider,
  buildHarnessProvider,
  buildLocalProvider,
  effectiveTranscriptionMode,
  emptyApiDraft,
  emptyGeminiDraft,
  harnessDescriptors,
  recommendedTier,
  transcriptionLockedToSkip,
  type AnalyzerFamily,
  type ApiDraft,
  type GeminiDraft,
  type HarnessDescriptor,
  type LocalAiTier,
  type Machine,
  type TranscriptionMode,
  type WhisperModelChoice,
  type WizardStep,
} from './wizard-model.js';
import { buildReadinessChecklist, type ChecklistAction, type ChecklistRow } from './readiness-checklist.js';

type Readiness = z.output<typeof readinessOutputSchema>;
type Doctor = z.output<typeof doctorOutputSchema>;

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

const FALLBACK_WHISPER_MODEL: WhisperModelName = 'base';

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
  geminiDraft: GeminiDraft;
  harnessId: string;
  harnessModel: string;
  harnessEffort: string;
  transcriptionMode: TranscriptionMode;
  transcriptionLocked: boolean;
  whisperModel: WhisperModelName;
  whisperModelOptions: WhisperModelChoice[];
  whisperBinaryPath: string;
  whisperApiCredential: string;
  validation: ValidationStatus;
  validationMessage: string | null;
  downloads: DownloadProgress[];
  plannedDownloadLabels: string[];
  isDownloading: boolean;
  readiness: Readiness | null;
  readinessChecklist: ChecklistRow[];
  applyChecklistAction: (action: ChecklistAction) => void;
  isCheckingReadiness: boolean;
  checkReadiness: () => void;
  canGoBack: boolean;
  uiLanguage: Locale;
  outputLanguage: string;
  setUiLanguage: (locale: Locale) => void;
  setOutputLanguage: (value: string) => void;
  setAnalyzerFamily: (family: AnalyzerFamily) => void;
  setLocalModelTag: (tag: string) => void;
  setApiDraft: (patch: Partial<ApiDraft>) => void;
  setGeminiDraft: (patch: Partial<GeminiDraft>) => void;
  setHarnessId: (id: string) => void;
  setHarnessModel: (model: string) => void;
  setHarnessEffort: (effort: string) => void;
  setTranscriptionMode: (mode: TranscriptionMode) => void;
  setWhisperModel: (model: WhisperModelName) => void;
  setWhisperBinaryPath: (path: string) => void;
  setWhisperApiCredential: (credential: string) => void;
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
  const dictionary = useDictionary();
  const uiLanguage = useUiLanguage();
  const queryClient = useQueryClient();
  const configQuery = useQuery({ ...actions.config({}), enabled: open });
  const requirements = useQuery({ ...actions.localAiRequirements, enabled: open });
  const whisperRuntime = useQuery({ ...actions.whisperRuntime, enabled: open });
  const whisperModels = useQuery({ ...actions.modelsWhisper, enabled: open });
  const setConfig = useMutation(actions.setConfig);
  const setCredential = useMutation(actions.setCredential);
  const testProvider = useMutation(actions.testProvider);
  const installWhisperRuntime = useMutation(actions.installWhisperRuntime);
  const pullLocalAiModel = useMutation(actions.pullLocalAiModel);
  const downloadWhisperModel = useMutation(actions.downloadWhisperModel);
  const activateWhisperModel = useMutation(actions.useWhisperModel);

  const tiers = useMemo(() => requirements.data?.tiers ?? [], [requirements.data]);
  const machine = requirements.data?.machine ?? null;
  const harnesses = useMemo(() => harnessDescriptors(), []);

  const [step, setStep] = useState<WizardStep>('welcome');
  const [outputLanguageChoice, setOutputLanguageChoice] = useState<string | null>(null);
  const [analyzerFamily, setAnalyzerFamilyState] = useState<AnalyzerFamily>('local');
  const [localModelTag, setLocalModelTag] = useState<string>('');
  const [apiDraft, setApiDraftState] = useState<ApiDraft>(emptyApiDraft);
  const [geminiDraft, setGeminiDraftState] = useState<GeminiDraft>(emptyGeminiDraft);
  const [harnessId, setHarnessId] = useState<string>('claude-code');
  const [harnessModel, setHarnessModelState] = useState<string>('');
  const [harnessEffort, setHarnessEffortState] = useState<string>('');
  const [harnessAvailability, setHarnessAvailability] = useState<Record<string, HarnessAvailability>>({});
  const [selectedTranscriptionMode, setTranscriptionMode] = useState<TranscriptionMode>('managed');
  const [whisperModelChoice, setWhisperModelChoice] = useState<WhisperModelName | null>(null);
  const [whisperBinaryPath, setWhisperBinaryPath] = useState<string>('');
  const [whisperApiCredential, setWhisperApiCredential] = useState<string>('');
  const [validation, setValidation] = useState<ValidationStatus>('idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);

  const effectiveLocalTag = localModelTag.length > 0 ? localModelTag : recommendedTier(tiers)?.tag ?? 'gemma3:12b';

  const whisperModelOptions = useMemo<WhisperModelChoice[]>(
    () => (whisperModels.data?.models ?? []).map((model) => ({
      name: model.name,
      size: model.size,
      downloaded: model.downloaded,
    })),
    [whisperModels.data],
  );
  const effectiveWhisperModel: WhisperModelName =
    whisperModelChoice ?? bestInstalledWhisperModel(whisperModelOptions) ?? FALLBACK_WHISPER_MODEL;
  const transcriptionLocked = transcriptionLockedToSkip(analyzerFamily);
  const transcriptionMode = effectiveTranscriptionMode(analyzerFamily, selectedTranscriptionMode);

  const setApiDraft = useCallback((patch: Partial<ApiDraft>) => {
    setApiDraftState((current) => ({ ...current, ...patch }));
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const setGeminiDraft = useCallback((patch: Partial<GeminiDraft>) => {
    setGeminiDraftState((current) => ({ ...current, ...patch }));
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const setAnalyzerFamily = useCallback((family: AnalyzerFamily) => {
    setAnalyzerFamilyState(family);
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const setHarnessModel = useCallback((model: string) => {
    setHarnessModelState(model);
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const setHarnessEffort = useCallback((effort: string) => {
    setHarnessEffortState(effort);
    setValidation('idle');
    setValidationMessage(null);
  }, []);

  const writeConfig = useCallback(
    async (key: ConfigKey, value: string): Promise<void> => {
      await setConfig.mutateAsync({ key, value });
      await queryClient.invalidateQueries();
    },
    [queryClient, setConfig],
  );

  const effectiveOutputLanguage =
    configQuery.data !== undefined && 'effective' in configQuery.data
      ? configQuery.data.effective.output_language
      : undefined;
  const outputLanguage = outputLanguageChoice ?? effectiveOutputLanguage ?? 'auto';

  const setUiLanguage = useCallback(
    (locale: Locale): void => {
      void writeConfig('ui_language', locale);
    },
    [writeConfig],
  );

  const advanceLanguage = useCallback(async (): Promise<void> => {
    await writeConfig('output_language', outputLanguage);
    setStep('analyzer');
  }, [writeConfig, outputLanguage]);

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
      } else if (analyzerFamily === 'gemini-native') {
        const provider = buildGeminiProvider(geminiDraft);
        if (geminiDraft.credential.trim().length > 0) {
          await setCredential.mutateAsync({ providerId: provider.apiKeyRef, credential: geminiDraft.credential.trim() });
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
          setValidationMessage(dictionary.wizard.controller.noHarnessAvailable);
          return;
        }
        const provider = buildHarnessProvider(descriptor, harnessModel, harnessEffort);
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
      savedToastStore.show(dictionary.wizard.controller.analyzerSaved);
      setStep('transcription');
    } catch (error) {
      setValidation('error');
      setValidationMessage(messageOf(error));
    }
  }, [
    analyzerFamily,
    apiDraft,
    geminiDraft,
    effectiveLocalTag,
    harnessId,
    harnessModel,
    harnessEffort,
    harnesses,
    persistAnalyzer,
    setCredential,
    testProvider,
    dictionary,
  ]);

  const persistTranscription = useCallback(async (): Promise<void> => {
    switch (transcriptionMode) {
      case 'managed':
        await writeConfig('whisper_mode', 'local');
        await writeConfig('whisper_model', effectiveWhisperModel);
        await writeConfig('whisper_binary_path', '');
        return;
      case 'own':
        await writeConfig('whisper_binary_path', whisperBinaryPath.trim());
        await writeConfig('whisper_model', effectiveWhisperModel);
        await writeConfig('whisper_mode', 'local');
        return;
      case 'api':
        if (whisperApiCredential.trim().length > 0) {
          await setCredential.mutateAsync({ providerId: 'openai', credential: whisperApiCredential.trim() });
        }
        await writeConfig('whisper_mode', 'api');
        return;
      case 'skip':
        await writeConfig('whisper_mode', 'skip');
        return;
    }
  }, [effectiveWhisperModel, setCredential, transcriptionMode, whisperApiCredential, whisperBinaryPath, writeConfig]);

  const advanceTranscription = useCallback(async (): Promise<void> => {
    setValidation('testing');
    setValidationMessage(null);
    if (transcriptionMode === 'own' && whisperBinaryPath.trim().length === 0) {
      setValidation('error');
      setValidationMessage(dictionary.wizard.controller.whisperBinaryPathRequired);
      return;
    }
    try {
      await persistTranscription();
      setValidation('ok');
      savedToastStore.show(dictionary.wizard.controller.transcriptionSaved);
      setStep('downloads');
    } catch (error) {
      setValidation('error');
      setValidationMessage(messageOf(error));
    }
  }, [persistTranscription, transcriptionMode, whisperBinaryPath, dictionary]);

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
      if (!ok) setValidationMessage(final.error?.message ?? dictionary.wizard.controller.downloadFailed);
      return ok;
    },
    [intervalMs, queryClient, dictionary],
  );

  const plannedDownloads = useMemo(() => {
    const tasks: { kind: 'local-ai' | 'whisper-runtime' | 'whisper-model'; label: string }[] = [];
    if (analyzerFamily === 'local') {
      const tier = tiers.find((entry) => entry.tag === effectiveLocalTag);
      if (tier === undefined || !tier.installed) {
        tasks.push({ kind: 'local-ai', label: dictionary.wizard.controller.downloadingLocalModel(effectiveLocalTag) });
      }
    }
    if (transcriptionMode === 'managed') {
      if (!(whisperRuntime.data?.available ?? false)) {
        tasks.push({ kind: 'whisper-runtime', label: dictionary.wizard.controller.buildingManagedWhisperRuntime });
      }
    }
    if (transcriptionMode === 'managed' || transcriptionMode === 'own') {
      const model = whisperModelOptions.find((entry) => entry.name === effectiveWhisperModel);
      if (model?.downloaded !== true) {
        tasks.push({ kind: 'whisper-model', label: dictionary.wizard.controller.downloadingWhisperModel(effectiveWhisperModel) });
      }
    }
    return tasks;
  }, [analyzerFamily, effectiveLocalTag, effectiveWhisperModel, tiers, transcriptionMode, whisperModelOptions, whisperRuntime.data, dictionary]);

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
          jobId = (await downloadWhisperModel.mutateAsync({ modelName: effectiveWhisperModel })).jobId;
        }
        const ok = await pollJob(jobId, task.label, index);
        if (!ok) {
          setIsDownloading(false);
          return;
        }
      }
      await queryClient.invalidateQueries();
      setIsDownloading(false);
      setStep('readiness');
    } catch (error) {
      setValidationMessage(messageOf(error));
      setIsDownloading(false);
    }
  }, [
    downloadWhisperModel,
    effectiveLocalTag,
    effectiveWhisperModel,
    installWhisperRuntime,
    plannedDownloads,
    pollJob,
    pullLocalAiModel,
    queryClient,
  ]);

  const checkReadiness = useCallback((): void => {
    setIsCheckingReadiness(true);
    void (async () => {
      try {
        const result = await queryClient.fetchQuery(
          actions.readiness(folder === null ? { scope: 'home', refresh: 'true' } : { folder, refresh: 'true' }),
        );
        setReadiness(result);
        const doctorResult = await queryClient.fetchQuery(actions.doctor).catch(() => null);
        setDoctor(doctorResult);
      } catch (error) {
        setValidationMessage(messageOf(error));
      } finally {
        setIsCheckingReadiness(false);
      }
    })();
  }, [folder, queryClient]);

  const applyChecklistAction = useCallback((action: ChecklistAction): void => {
    switch (action.kind) {
      case 'goto-analyzer':
        setValidation('idle');
        setStep('analyzer');
        return;
      case 'goto-transcription':
        setValidation('idle');
        setStep('transcription');
        return;
      case 'download-whisper':
        setStep('downloads');
        return;
      case 'activate-whisper':
        setIsCheckingReadiness(true);
        void (async () => {
          try {
            await activateWhisperModel.mutateAsync({ modelName: action.model });
            await queryClient.invalidateQueries();
            savedToastStore.show(dictionary.wizard.controller.whisperModelActive(action.model));
            checkReadiness();
          } catch (error) {
            setValidationMessage(messageOf(error));
            setIsCheckingReadiness(false);
          }
        })();
        return;
    }
  }, [activateWhisperModel, checkReadiness, queryClient, dictionary]);

  const next = useCallback(() => {
    switch (step) {
      case 'welcome':
        setStep('language');
        return;
      case 'language':
        void advanceLanguage();
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
  }, [step, advanceLanguage, validateAndAdvanceAnalyzer, advanceTranscription, runDownloads, onFinish]);

  const back = useCallback(() => {
    setValidation('idle');
    setValidationMessage(null);
    switch (step) {
      case 'language':
        setStep('welcome');
        return;
      case 'analyzer':
        setStep('language');
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

  const readinessChecklist = useMemo(
    () => buildReadinessChecklist(dictionary, doctor, readiness, whisperModelOptions),
    [dictionary, doctor, readiness, whisperModelOptions],
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
    geminiDraft,
    harnessId,
    harnessModel,
    harnessEffort,
    transcriptionMode,
    transcriptionLocked,
    whisperModel: effectiveWhisperModel,
    whisperModelOptions,
    whisperBinaryPath,
    whisperApiCredential,
    validation,
    validationMessage,
    downloads,
    plannedDownloadLabels: plannedDownloads.map((task) => task.label),
    isDownloading,
    readiness,
    readinessChecklist,
    applyChecklistAction,
    isCheckingReadiness,
    checkReadiness,
    canGoBack: step !== 'welcome' && step !== 'done' && !isDownloading,
    uiLanguage,
    outputLanguage,
    setUiLanguage,
    setOutputLanguage: setOutputLanguageChoice,
    setAnalyzerFamily: setAnalyzerFamilyWithDetection,
    setLocalModelTag,
    setApiDraft,
    setGeminiDraft,
    setHarnessId,
    setHarnessModel,
    setHarnessEffort,
    setTranscriptionMode,
    setWhisperModel: setWhisperModelChoice,
    setWhisperBinaryPath,
    setWhisperApiCredential,
    next,
    back,
    finish,
  };
};
