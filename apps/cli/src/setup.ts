import type { ApiClient } from '@core/client/index.js';
import {
  WHISPER_MODEL_NAMES,
  analyzerProviderConfigSchema,
  appError,
  builtInHarnessProviders,
  type AnalyzerProviderConfig,
  type AppError,
  type WhisperModelName,
} from '@core/domain/index.js';

import { waitForJob } from './job-wait.js';

export type SetupAnalyzer = 'local' | 'api' | 'harness';
export type SetupTranscription = 'managed' | 'own' | 'api' | 'skip';

export interface SetupOptions {
  analyzer?: SetupAnalyzer | undefined;
  localModel?: string | undefined;
  apiBaseUrl?: string | undefined;
  apiModel?: string | undefined;
  apiKeyEnv?: string | undefined;
  apiInputPrice?: number | undefined;
  apiOutputPrice?: number | undefined;
  harness?: string | undefined;
  transcription?: SetupTranscription | undefined;
  whisperPath?: string | undefined;
  whisperModel?: WhisperModelName | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
}

export interface SetupPrompter {
  question(message: string): Promise<string>;
  secret(message: string): Promise<string>;
  close(): void;
}

export interface SetupOutput {
  started(data: unknown): void;
  progress(data: {
    step: string;
    percentage?: number | undefined;
    current?: number | undefined;
    total?: number | undefined;
    data?: unknown;
  }): void;
  completed(data: unknown, human: string): void;
  error(error: AppError): void;
  write(message: string): void;
}

type SetupApi = Pick<ApiClient,
  | 'config'
  | 'setConfig'
  | 'setCredential'
  | 'testProvider'
  | 'localAiRequirements'
  | 'modelsWhisper'
  | 'whisperRuntimeStatus'
  | 'pullLocalAiModel'
  | 'installWhisperRuntime'
  | 'downloadWhisperModel'
  | 'job'
  | 'readiness'
>;

type LocalAiRequirements = Extract<
  Awaited<ReturnType<SetupApi['localAiRequirements']>>,
  { ok: true }
>['value'];

interface SetupContext {
  api: SetupApi;
  folder: string;
  options: SetupOptions;
  output: SetupOutput;
  prompter?: SetupPrompter | undefined;
  environment: NodeJS.ProcessEnv;
}

interface ExistingSetup {
  provider: AnalyzerProviderConfig | null;
  whisperMode: 'local' | 'api' | 'skip';
  whisperModel: WhisperModelName;
  whisperPath: string;
}

interface DownloadTask {
  kind: 'local-model' | 'whisper-runtime' | 'whisper-model';
  label: string;
}

const DEFAULT_LOCAL_MODEL = 'gemma3:12b';
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_API_MODEL = 'gpt-4.1-mini';

export const executeSetup = async (context: SetupContext): Promise<boolean> => {
  context.output.started({
    analyzer: context.options.analyzer ?? null,
    transcription: context.options.transcription ?? null,
    yes: context.options.yes === true,
  });
  try {
    if (context.options.yes !== true && context.prompter === undefined) {
      context.output.error(appError('invalid_config_value', 'Interactive setup requires a terminal'));
      return false;
    }
    if (context.options.yes === true && context.options.analyzer === undefined) {
      context.output.error(appError('invalid_config_value', 'Non-interactive setup requires --analyzer'));
      return false;
    }

    const existing = await loadExisting(context);
    if (existing === null) return false;
    const requirements = await context.api.localAiRequirements();
    const recommendedModel = requirements.ok
      ? requirements.value.tiers.find((tier) => tier.recommended)?.tag ?? DEFAULT_LOCAL_MODEL
      : DEFAULT_LOCAL_MODEL;
    const analyzer = await selectAnalyzer(context, existing, recommendedModel);
    if (analyzer === null) return false;
    const persistedAnalyzer = await persistAnalyzer(context, analyzer);
    if (!persistedAnalyzer) return false;

    const transcription = await selectTranscription(context, existing);
    if (transcription === null) return false;
    const persistedTranscription = await persistTranscription(context, transcription);
    if (!persistedTranscription) return false;

    const downloads = await plannedDownloads(context, analyzer, transcription, requirements.ok ? requirements.value : null);
    if (downloads === null) return false;
    const shouldDownload = downloads.length > 0 && (
      context.options.yes === true
      || await confirm(context, `Download ${downloads.length} missing component${downloads.length === 1 ? '' : 's'} now?`, true)
    );
    if (shouldDownload) {
      for (const task of downloads) {
        const completed = await runDownload(context, task, analyzer, transcription.whisperModel);
        if (!completed) return false;
      }
    }

    const readiness = await context.api.readiness({ folder: context.folder, refresh: 'true' });
    if (!readiness.ok) {
      context.output.error(readiness.error);
      return false;
    }
    const human = readiness.value.ready
      ? 'Setup complete. Processing is ready.'
      : `Setup saved, but processing is not ready. ${readiness.value.suggestedAction ?? 'Run setup again to finish.'}`;
    context.output.completed(readiness.value, human);
    return true;
  } catch (cause) {
    context.output.error(appError('internal', `Setup failed: ${messageOf(cause)}`));
    return false;
  } finally {
    context.prompter?.close();
  }
};

const loadExisting = async (context: SetupContext): Promise<ExistingSetup | null> => {
  const result = await context.api.config({ folder: context.folder, key: null });
  if (!result.ok) {
    context.output.error(result.error);
    return null;
  }
  if ('key' in result.value) {
    context.output.error(appError('internal', 'Setup expected the complete configuration'));
    return null;
  }
  const providerValue = result.value.config.analyzer_provider;
  let provider: AnalyzerProviderConfig | null = null;
  if (providerValue !== null) {
    try {
      const parsed = analyzerProviderConfigSchema.safeParse(JSON.parse(providerValue));
      if (parsed.success) provider = parsed.data;
    } catch {
      provider = null;
    }
  }
  const whisperMode = parseWhisperMode(result.value.config.whisper_mode ?? result.value.defaults.whisper_mode);
  const whisperModel = parseWhisperModel(result.value.config.whisper_model ?? result.value.defaults.whisper_model);
  return {
    provider,
    whisperMode,
    whisperModel,
    whisperPath: result.value.config.whisper_binary_path ?? '',
  };
};

const selectAnalyzer = async (
  context: SetupContext,
  existing: ExistingSetup,
  recommendedModel: string,
): Promise<AnalyzerProviderConfig | null> => {
  const existingFamily = existing.provider?.family ?? 'local';
  const family = context.options.analyzer ?? parseAnalyzer(await ask(
    context,
    'Analyzer family (local/api/harness)',
    existingFamily,
  ));
  if (family === null) {
    context.output.error(appError('invalid_config_value', 'Analyzer must be local, api, or harness'));
    return null;
  }
  if (family === 'local') {
    const existingModel = existing.provider?.family === 'local' ? existing.provider.modelTag : recommendedModel;
    const modelTag = context.options.localModel ?? await ask(context, 'Local model', existingModel);
    return { family: 'local', providerId: 'local', modelTag };
  }
  if (family === 'api') return selectApiAnalyzer(context, existing);
  return selectHarnessAnalyzer(context, existing);
};

const selectApiAnalyzer = async (
  context: SetupContext,
  existing: ExistingSetup,
): Promise<AnalyzerProviderConfig | null> => {
  const current = existing.provider?.family === 'api' ? existing.provider : null;
  const baseUrl = context.options.apiBaseUrl ?? await ask(context, 'API base URL', current?.baseUrl ?? DEFAULT_API_BASE_URL);
  const model = context.options.apiModel ?? await ask(context, 'API model', current?.model ?? DEFAULT_API_MODEL);
  const inputPrice = context.options.apiInputPrice ?? await askOptionalPrice(
    context,
    'Input price per 1M tokens (optional)',
    current?.pricePerMTokensInput,
  );
  const outputPrice = context.options.apiOutputPrice ?? await askOptionalPrice(
    context,
    'Output price per 1M tokens (optional)',
    current?.pricePerMTokensOutput,
  );
  const credential = credentialFromEnvironment(context);
  if (credential !== null) {
    const saved = await context.api.setCredential({ providerId: 'openai', credential });
    if (!saved.ok) {
      context.output.error(saved.error);
      return null;
    }
  } else if (context.options.yes !== true) {
    const entered = await context.prompter?.secret('API key (leave blank to keep the stored key): ') ?? '';
    if (entered.trim().length > 0) {
      const saved = await context.api.setCredential({ providerId: 'openai', credential: entered.trim() });
      if (!saved.ok) {
        context.output.error(saved.error);
        return null;
      }
    }
  }
  context.output.write('Notice: usage will be charged by your API provider.');
  const provider: AnalyzerProviderConfig = {
    family: 'api',
    providerId: 'openai',
    baseUrl,
    apiKeyRef: 'openai',
    model,
    maxImageDetail: current?.maxImageDetail ?? 'auto',
    ...(inputPrice === undefined ? {} : { pricePerMTokensInput: inputPrice }),
    ...(outputPrice === undefined ? {} : { pricePerMTokensOutput: outputPrice }),
  };
  const tested = await context.api.testProvider(provider);
  if (!tested.ok) {
    context.output.error(tested.error);
    return null;
  }
  if (tested.value.family !== 'api' || !tested.value.reachable || !tested.value.authenticated) {
    context.output.error(appError('provider_auth_failed', tested.value.message));
    return null;
  }
  return provider;
};

const selectHarnessAnalyzer = async (
  context: SetupContext,
  existing: ExistingSetup,
): Promise<AnalyzerProviderConfig | null> => {
  const harnesses = builtInHarnessProviders();
  if (context.options.yes !== true) {
    context.output.write('Detected agent harnesses:');
    for (const harness of harnesses) {
      const tested = await context.api.testProvider(toHarnessConfig(harness));
      const detail = tested.ok && tested.value.family === 'harness' && tested.value.available
        ? `available${tested.value.version === null ? '' : ` (${tested.value.version})`}`
        : 'not available';
      context.output.write(`  ${harness.providerId}: ${detail}`);
    }
  }
  const currentId = existing.provider?.family === 'harness' ? existing.provider.providerId : 'claude-code';
  const providerId = context.options.harness ?? await ask(context, 'Harness', currentId);
  const descriptor = harnesses.find((harness) => harness.providerId === providerId);
  if (descriptor === undefined) {
    context.output.error(appError('invalid_config_value', `Unknown built-in harness: ${providerId}`));
    return null;
  }
  const provider = toHarnessConfig(descriptor);
  const tested = await context.api.testProvider(provider);
  if (!tested.ok) {
    context.output.error(tested.error);
    return null;
  }
  if (tested.value.family !== 'harness' || !tested.value.available) {
    context.output.error(appError('prerequisites_failed', tested.value.message));
    return null;
  }
  return provider;
};

const toHarnessConfig = (descriptor: ReturnType<typeof builtInHarnessProviders>[number]): AnalyzerProviderConfig => ({
  family: 'harness',
  providerId: descriptor.providerId,
  command: descriptor.command,
  argsTemplate: [...descriptor.argsTemplate],
  promptStyle: descriptor.promptStyle,
});

const persistAnalyzer = async (context: SetupContext, provider: AnalyzerProviderConfig): Promise<boolean> => {
  if (!await setConfig(context, 'analyzer_provider', JSON.stringify(provider))) return false;
  if (!await setConfig(context, 'analyzer_backend', provider.family === 'local' ? 'local' : 'claude')) return false;
  return provider.family !== 'local' || await setConfig(context, 'local_model', provider.modelTag);
};

const selectTranscription = async (
  context: SetupContext,
  existing: ExistingSetup,
): Promise<{ mode: SetupTranscription; whisperPath: string; whisperModel: WhisperModelName } | null> => {
  const existingMode: SetupTranscription = existing.whisperMode === 'local'
    ? existing.whisperPath.length > 0 ? 'own' : 'managed'
    : existing.whisperMode;
  const mode = context.options.transcription ?? parseTranscription(await ask(
    context,
    'Transcription source (managed/own/api/skip)',
    existingMode,
  ));
  if (mode === null) {
    context.output.error(appError('invalid_config_value', 'Transcription must be managed, own, api, or skip'));
    return null;
  }
  const whisperPath = mode === 'own'
    ? context.options.whisperPath ?? await ask(context, 'Path to whisper executable', existing.whisperPath)
    : '';
  if (mode === 'own' && whisperPath.trim().length === 0) {
    context.output.error(appError('invalid_config_value', 'The own transcription source requires --whisper-path'));
    return null;
  }
  return { mode, whisperPath: whisperPath.trim(), whisperModel: context.options.whisperModel ?? existing.whisperModel };
};

const persistTranscription = async (
  context: SetupContext,
  transcription: { mode: SetupTranscription; whisperPath: string; whisperModel: WhisperModelName },
): Promise<boolean> => {
  if (transcription.mode === 'managed') {
    return await setConfig(context, 'whisper_binary_path', '')
      && await setConfig(context, 'whisper_mode', 'local')
      && await setConfig(context, 'whisper_model', transcription.whisperModel);
  }
  if (transcription.mode === 'own') {
    return await setConfig(context, 'whisper_binary_path', transcription.whisperPath)
      && await setConfig(context, 'whisper_mode', 'local')
      && await setConfig(context, 'whisper_model', transcription.whisperModel);
  }
  return setConfig(context, 'whisper_mode', transcription.mode);
};

const plannedDownloads = async (
  context: SetupContext,
  analyzer: AnalyzerProviderConfig,
  transcription: { mode: SetupTranscription; whisperModel: WhisperModelName },
  requirements: LocalAiRequirements | null,
): Promise<DownloadTask[] | null> => {
  const tasks: DownloadTask[] = [];
  if (analyzer.family === 'local') {
    const installed = requirements?.tiers.find((tier) => tier.tag === analyzer.modelTag)?.installed ?? false;
    if (!installed) tasks.push({ kind: 'local-model', label: `Local model ${analyzer.modelTag}` });
  }
  if (transcription.mode !== 'managed') return tasks;
  const runtime = await context.api.whisperRuntimeStatus();
  if (!runtime.ok) {
    context.output.error(runtime.error);
    return null;
  }
  if (!runtime.value.available) tasks.push({ kind: 'whisper-runtime', label: 'Managed whisper.cpp runtime' });
  const models = await context.api.modelsWhisper();
  if (!models.ok) {
    context.output.error(models.error);
    return null;
  }
  const model = models.value.models.find((entry) => entry.name === transcription.whisperModel);
  if (model?.downloaded !== true) tasks.push({ kind: 'whisper-model', label: `Whisper model ${transcription.whisperModel}` });
  return tasks;
};

const runDownload = async (
  context: SetupContext,
  task: DownloadTask,
  analyzer: AnalyzerProviderConfig,
  whisperModel: WhisperModelName,
): Promise<boolean> => {
  context.output.write(`${task.label}…`);
  const accepted = task.kind === 'local-model'
    ? await context.api.pullLocalAiModel({ tag: analyzer.family === 'local' ? analyzer.modelTag : DEFAULT_LOCAL_MODEL })
    : task.kind === 'whisper-runtime'
      ? await context.api.installWhisperRuntime()
      : await context.api.downloadWhisperModel({ modelName: whisperModel, force: false });
  if (!accepted.ok) {
    context.output.error(accepted.error);
    return false;
  }
  return waitForSetupJob(context, accepted.value.jobId, task);
};

const waitForSetupJob = async (context: SetupContext, jobId: string, task: DownloadTask): Promise<boolean> => {
  let completed = false;
  await waitForJob(jobId, {
    fetchJob: (id): Promise<ReturnType<SetupApi['job']> extends Promise<infer T> ? T : never> => context.api.job({ jobId: id }),
    onProgress: (progress) => context.output.progress({
      step: progress.step,
      ...(progress.percentage === undefined ? {} : { percentage: progress.percentage }),
      ...(progress.current === undefined ? {} : { current: progress.current }),
      ...(progress.total === undefined ? {} : { total: progress.total }),
      data: { download: task.kind, label: task.label, detail: progress.data ?? null },
    }),
    onCompleted: () => {
      completed = true;
      context.output.write(`${task.label}: complete`);
    },
    onError: (error) => context.output.error(error),
  });
  return completed;
};

const setConfig = async (
  context: SetupContext,
  key: Parameters<SetupApi['setConfig']>[0]['key'],
  value: string,
): Promise<boolean> => {
  const result = await context.api.setConfig({ folder: context.folder, key, value });
  if (result.ok) return true;
  context.output.error(result.error);
  return false;
};

const ask = async (context: SetupContext, message: string, defaultValue: string): Promise<string> => {
  const answer = await context.prompter?.question(`${message} [${defaultValue}]: `) ?? '';
  return answer.trim().length === 0 ? defaultValue : answer.trim();
};

const confirm = async (context: SetupContext, message: string, defaultValue: boolean): Promise<boolean> => {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await context.prompter?.question(`${message} ${suffix} `) ?? '';
  if (answer.trim().length === 0) return defaultValue;
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
};

const askOptionalPrice = async (
  context: SetupContext,
  message: string,
  current: number | undefined,
): Promise<number | undefined> => {
  if (context.options.yes === true) return current;
  const answer = await context.prompter?.question(`${message}${current === undefined ? '' : ` [${current}]`}: `) ?? '';
  if (answer.trim().length === 0) return current;
  const value = Number(answer);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${message} must be a non-negative number`);
  return value;
};

const credentialFromEnvironment = (context: SetupContext): string | null => {
  if (context.options.apiKeyEnv !== undefined) return context.environment[context.options.apiKeyEnv] ?? null;
  return context.environment.AI_VIDEO_CATALOGER_API_KEY ?? context.environment.OPENAI_API_KEY ?? null;
};

const parseAnalyzer = (value: string): SetupAnalyzer | null =>
  value === 'local' || value === 'api' || value === 'harness' ? value : null;

const parseTranscription = (value: string): SetupTranscription | null =>
  value === 'managed' || value === 'own' || value === 'api' || value === 'skip' ? value : null;

const parseWhisperMode = (value: string): ExistingSetup['whisperMode'] =>
  value === 'api' || value === 'skip' ? value : 'local';

const parseWhisperModel = (value: string): WhisperModelName => {
  for (const model of WHISPER_MODEL_NAMES) {
    if (value === model) return model;
  }
  return 'base';
};

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
