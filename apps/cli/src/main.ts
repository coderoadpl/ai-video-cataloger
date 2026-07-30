import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

import { Command, InvalidArgumentError } from 'commander';

import { createApiClient, type ApiClient } from '@core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE, SEARCH_SORTS, gpsBackfillSummarySchema, thumbnailsSummarySchema } from '@core/contract/index.js';
import {
  ANALYZER_PROVIDER_IDS,
  CONFIG_KEYS,
  HARNESS_REASONING_EFFORTS,
  WHISPER_MODEL_NAMES,
  apiCostSignal,
  analyzerProviderConfigSchema,
  builtInAnalyzerProvider,
  estimateApiTokens,
  appError,
  configKeySchema,
  CREDENTIALS_BACKEND_LABELS,
  err,
  whisperLanguageSchema,
  type AnalyzerProviderConfig,
  type AnalyzerProviderId,
  type AppError,
  type Result,
  type WhisperLanguage,
  type WhisperModelName,
} from '@core/domain/index.js';
import { createApp } from '@server/src/create-app.js';
import { inMemoryDbRequested } from '@server/src/composition.js';
import packageJson from '../../../package.json' with { type: 'json' };

import {
  emitCompleted,
  emitError,
  emitProgress,
  emitRaw,
  emitStarted,
  emitWarning,
  isJsonMode,
} from './output.js';
import { credentialDeleteHuman } from './credential-delete-human.js';
import { driveEventLine, isDriveEventStep, type DriveEventStep } from './drive-events.js';
import { driveFacesSummaryLine } from './drive-faces-summary.js';
import { doctorHuman } from './doctor-human.js';
import {
  photosForgetHuman,
  photosGpsBackfillHuman,
  photosProcessHuman,
  photosProxiesHuman,
  photosSearchHuman,
  photosStatusHuman,
  photosVariantNdjsonRow,
  photosVariantsListHuman,
} from './photos-human.js';
import { waitForJob } from './job-wait.js';
import { createMaskedPrompter, isInteractiveInput, promptMaskedSecret, promptStreams } from './masked-prompt.js';
import { runProgram } from './run-program.js';
import {
  executeSetup,
  type SetupAnalyzer,
  type SetupOptions,
  type SetupPrompter,
  type SetupTranscription,
} from './setup.js';

interface JsonOption {
  json?: boolean | undefined;
}

interface ForceJsonOption extends JsonOption {
  force?: boolean | undefined;
}

interface ProcessOptions extends JsonOption {
  frames: number;
  skipRename?: boolean | undefined;
  verbose?: boolean | undefined;
  timeout: number;
  whisper: 'local' | 'api' | 'skip';
  whisperModel: string;
  whisperLanguage: WhisperLanguage;
  analyzer?: 'claude' | 'local' | 'api' | undefined;
  provider?: AnalyzerProviderId | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
}

interface ProcessDriveOptions extends ProcessOptions {
  keepAwake?: boolean | undefined;
  geminiBatch?: boolean | undefined;
  skipFaces?: boolean | undefined;
}

interface MaterializeOptions extends JsonOption {
  dryRun?: boolean | undefined;
  keepAwake?: boolean | undefined;
}

interface AnalyzerSelection {
  analyzer: ProcessOptions['analyzer'];
  provider: ProcessOptions['provider'];
}

interface CliJobProgress {
  step: string;
  percentage?: number | undefined;
  current?: number | undefined;
  total?: number | undefined;
  data?: unknown;
}

interface CredentialOptions extends JsonOption {
  env?: string | undefined;
}

interface SearchOptions extends JsonOption {
  limit: number;
  offset: number;
  tag: string[];
  person: string[];
  place?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  hasGps?: boolean | undefined;
  folder?: string | undefined;
  sort?: 'relevance' | 'captured_desc' | 'captured_asc' | 'name_asc' | undefined;
}

interface VariantConfigOptions extends JsonOption {
  config: string;
}

interface VariantDefaultOptions extends JsonOption {
  config?: string | undefined;
  clear?: boolean | undefined;
}

type VariantsListOutput = Awaited<ReturnType<ApiClient['listVariants']>> extends Result<infer T, AppError> ? T : never;
type VariantListItem = VariantsListOutput['variants'][number];

const cliWorkingDirectory = process.env.AVC_WORKING_DIRECTORY ?? process.cwd();
const cliHomeDirectory = process.env.AVC_HOME_DIRECTORY ?? homedir();
const cliConfigFolder = path.resolve(cliWorkingDirectory) === path.resolve(cliHomeDirectory)
  ? undefined
  : cliWorkingDirectory;
const inMemoryDepsFactory = inMemoryDbRequested()
  ? (await import('@server/src/test-support/in-memory-deps.js')).createInMemoryDeps
  : undefined;
const app = createApp(
  { workingDirectory: cliWorkingDirectory, homeDirectory: cliHomeDirectory, processName: 'cli' },
  inMemoryDepsFactory,
);
const api = createApiClient({
  baseUrl: '',
  fetchImpl: async (input, init) => app.honoApp.request(input, init),
});

const program = new Command('ai-video-cataloger')
  .description('CLI for video analysis, local Whisper transcription, Claude/local analysis, content-based renaming')
  .version(packageJson.version);

const numberOption = (value: string): number => Number.parseInt(value, 10);
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;
const whisperOption = (value: string): ProcessOptions['whisper'] => {
  if (value === 'local' || value === 'api' || value === 'skip') return value;
  throw new InvalidArgumentError(`Invalid whisper mode: ${value}. Valid modes: local, api, skip`);
};
const parseWhisperModel = (modelName: string): Result<WhisperModelName, AppError> => {
  for (const model of WHISPER_MODEL_NAMES) {
    if (modelName === model) return { ok: true, value: model };
  }
  return err(appError('invalid_model', `Invalid model: ${modelName}`));
};
const whisperLanguageOption = (value: string): WhisperLanguage => {
  const parsed = whisperLanguageSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InvalidArgumentError(`Invalid whisper language: ${value}`);
};

const analyzerSelection = (options: ProcessOptions): AnalyzerSelection => ({
  analyzer: options.analyzer,
  provider: options.provider,
});

const optionWasPassed = (command: Command, name: string): boolean =>
  command.getOptionValueSource(name) === 'cli';

const conflictingAnalyzerSelection = (options: ProcessOptions): AppError | null =>
  options.analyzer === undefined || options.provider === undefined
    ? null
    : appError('validation', 'Use either --analyzer or --provider, not both');

const analyzerProviderOption = (value: string): AnalyzerProviderId => {
  for (const providerId of ANALYZER_PROVIDER_IDS) {
    if (value === providerId) return providerId;
  }
  throw new InvalidArgumentError(`Invalid analyzer provider: ${value}. Valid providers: ${ANALYZER_PROVIDER_IDS.join(', ')}`);
};

const analyzerBackendOption = (value: string): NonNullable<ProcessOptions['analyzer']> => {
  if (value === 'claude' || value === 'local' || value === 'api') return value;
  throw new InvalidArgumentError(`Invalid analyzer backend: ${value}. Valid backends: claude, local, api`);
};

const setupAnalyzerOption = (value: string): SetupAnalyzer => {
  if (value === 'local' || value === 'api' || value === 'harness') return value;
  throw new InvalidArgumentError(`Invalid analyzer family: ${value}. Valid families: local, api, harness`);
};

const setupTranscriptionOption = (value: string): SetupTranscription => {
  if (value === 'managed' || value === 'own' || value === 'api' || value === 'skip') return value;
  throw new InvalidArgumentError(`Invalid transcription source: ${value}. Valid sources: managed, own, api, skip`);
};

const setupWhisperModelOption = (value: string): WhisperModelName => {
  const parsed = parseWhisperModel(value);
  if (parsed.ok) return parsed.value;
  throw new InvalidArgumentError(parsed.error.message);
};

const setupHarnessEffortOption = (value: string): SetupOptions['harnessEffort'] => {
  for (const effort of HARNESS_REASONING_EFFORTS) {
    if (value === effort) return effort;
  }
  throw new InvalidArgumentError(`Invalid harness effort: ${value}. Valid efforts: ${HARNESS_REASONING_EFFORTS.join(', ')}`);
};

const nonNegativeNumberOption = (value: string): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  throw new InvalidArgumentError(`Expected a non-negative number: ${value}`);
};

const runSimple = async <T>(
  json: boolean,
  command: string,
  action: () => Promise<Result<T, AppError>>,
  human: (data: T) => string,
  options: {
    raw?: boolean | undefined;
    exitOnData?: ((data: T) => number | null) | undefined;
    startData?: unknown;
  } = {},
): Promise<void> => {
  emitStarted(json, command, options.startData);
  const result = await action();
  if (!result.ok) {
    emitError(json, result.error);
    return;
  }
  if (options.raw === true) emitRaw(json, result.value, '');
  emitCompleted(json, result.value, human(result.value));
  const exitCode = options.exitOnData?.(result.value) ?? null;
  if (exitCode !== null) process.exitCode = exitCode;
};

const waitForJobAndEmit = async (
  json: boolean,
  jobId: string,
  completedHuman: (data: unknown) => string,
  raw = false,
): Promise<void> => {
  await waitForJob(jobId, {
    fetchJob: (id) => api.job({ jobId: id }),
    onProgress: (progress) => emitProgress(json, progressEvent(progress)),
    onCompleted: (data) => {
      if (raw) emitRaw(json, data, '');
      emitCompleted(json, data, completedHuman(data));
    },
    onError: (error) => emitError(json, error),
  });
};

const waitForDriveJobAndEmit = async (
  json: boolean,
  jobId: string,
  completedHuman: (data: unknown) => string = processDriveHuman,
): Promise<void> => {
  await waitForJob(jobId, {
    fetchJob: (id) => api.job({ jobId: id }),
    onProgress: (progress) => {
      if (isDriveEventStep(progress.step)) {
        emitDriveEvent(json, progress.step, progress.data);
        return;
      }
      emitProgress(json, progressEvent(progress));
    },
    onCompleted: (data) => emitCompleted(json, data, completedHuman(data)),
    onError: (error) => emitError(json, error),
  });
};

program
  .command('setup')
  .description('Configure an analyzer, transcription, and optional managed downloads')
  .option('--analyzer <family>', 'analyzer family: local, api, or harness', setupAnalyzerOption)
  .option('--local-model <tag>', 'local Ollama model tag')
  .option('--api-base-url <url>', 'OpenAI-compatible API base URL')
  .option('--api-model <model>', 'OpenAI-compatible API model')
  .option('--api-key-env <name>', 'environment variable containing the API key')
  .option('--api-input-price <amount>', 'price per 1M input tokens', nonNegativeNumberOption)
  .option('--api-output-price <amount>', 'price per 1M output tokens', nonNegativeNumberOption)
  .option('--harness <providerId>', 'built-in harness: claude-code, codex, or cursor-agent')
  .option('--harness-model <model>', 'model passed to built-in harnesses that support it')
  .option('--harness-effort <effort>', 'reasoning effort: low, medium, high, or xhigh', setupHarnessEffortOption)
  .option('--transcription <source>', 'managed, own, api, or skip', setupTranscriptionOption)
  .option('--whisper-path <path>', 'path to an existing whisper.cpp executable')
  .option('--whisper-model <model>', 'managed Whisper model', setupWhisperModelOption)
  .option('--whisper-api-base-url <url>', 'OpenAI-compatible Whisper API base URL')
  .option('--whisper-api-model <model>', 'OpenAI-compatible Whisper API model')
  .option('--yes', 'accept downloads and run without prompts', false)
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (options: SetupOptions) => {
    const json = isJsonMode(options);
    const prompter = options.yes === true || !isInteractiveInput(process.stdin) ? undefined : createSetupPrompter();
    await executeSetup({
      api,
      folder: cliWorkingDirectory,
      options,
      ...(prompter === undefined ? {} : { prompter }),
      environment: process.env,
      output: {
        started: (data) => emitStarted(json, 'setup', data),
        progress: (data) => emitProgress(json, data),
        completed: (data, human) => emitCompleted(json, data, human),
        error: (error) => emitError(json, error),
        write: (message) => {
          if (!json) process.stdout.write(`${message}\n`);
        },
      },
    });
  });

const progressEvent = (progress: CliJobProgress): {
  step: string;
  percentage?: number | undefined;
  current?: number | undefined;
  total?: number | undefined;
  data?: unknown;
} => ({
  step: progress.step,
  ...(progress.percentage === undefined ? {} : { percentage: progress.percentage }),
  ...(progress.current === undefined ? {} : { current: progress.current }),
  ...(progress.total === undefined ? {} : { total: progress.total }),
  ...(progress.data === undefined ? {} : { data: progress.data }),
});

program
  .command('health')
  .option('--json', 'machine-readable JSON output', false)
  .description('App and version status')
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'health', () => api.health(), (data) => `status=${data.status} v${data.version}`);
  });

const models = program.command('models').description('Manage Whisper and local AI models');
const whisperRuntime = models.command('whisper-runtime').description('Manage the whisper.cpp runtime');

whisperRuntime
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'models_whisper_runtime_status',
      () => api.whisperRuntimeStatus(),
      whisperRuntimeStatusHuman,
    );
  });

whisperRuntime
  .command('install')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_whisper_runtime_install');
    const result = await api.installWhisperRuntime();
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, whisperRuntimeInstallHuman);
  });

models
  .command('list')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_list');
    const whisper = await api.modelsWhisper();
    if (!whisper.ok) {
      emitError(json, whisper.error);
      return;
    }
    emitRaw(json, whisper.value, '');
    if (json) {
      emitCompleted(json, whisper.value);
      return;
    }
    const localAi = await api.localAiRequirements();
    if (!localAi.ok) {
      emitError(json, localAi.error);
      return;
    }
    emitCompleted(json, whisper.value, modelsListHuman(whisper.value, localAi.value));
  });

models
  .command('requirements')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'models_requirements', () => api.localAiRequirements(), requirementsHuman, { startData: {} });
  });

models
  .command('pull')
  .argument('<tag>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (tag: string, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_pull', { tag });
    const result = await api.pullLocalAiModel({ tag });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, (data) => installedHuman(data, tag));
  });

models
  .command('rm')
  .argument('<tag>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (tag: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'models_rm', () => api.removeLocalAiModel({ tag }), (data) => `Removed ${data.tag}`);
  });

models
  .command('daemon-stop')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    const result = await api.stopLocalAiDaemon();
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitCompleted(json, result.value, result.value.stopped ? 'Stopped managed Ollama daemon' : 'No managed Ollama daemon running');
  });

models
  .command('use')
  .argument('<model-name>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (modelName: string, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_use', { modelName });
    const model = parseWhisperModel(modelName);
    if (!model.ok) {
      emitError(json, model.error);
      return;
    }
    const result = await api.useWhisperModel({ modelName: model.value });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitRaw(json, result.value, '');
    emitCompleted(json, result.value, `Using Whisper model: ${result.value.model}`);
  });

models
  .command('download')
  .argument('<model-name>')
  .option('--force', 'download even if already present', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (modelName: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_download', { modelName, force: options.force === true });
    const model = parseWhisperModel(modelName);
    if (!model.ok) {
      emitError(json, model.error);
      return;
    }
    const result = await api.downloadWhisperModel({ modelName: model.value, force: options.force === true });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, (data) => downloadedHuman(data, model.value), true);
  });

models
  .command('delete')
  .argument('<model-name>')
  .option('--force', 'delete without prompting', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (modelName: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_delete', { modelName, force: options.force === true });
    const model = parseWhisperModel(modelName);
    if (!model.ok) {
      emitError(json, model.error);
      return;
    }
    if (!json && options.force !== true) {
      emitCompleted(json, { model: model.value, deleted: false }, 'Deletion requires --force flag');
      return;
    }
    const result = await api.deleteWhisperModel({ modelName: model.value, force: options.force === true });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitCompleted(json, result.value, result.value.deleted ? `Deleted ${result.value.model}` : `Skipped ${result.value.model}`);
  });

const modelsFaces = models.command('faces').description('Manage the face detection and recognition models');

modelsFaces
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'models_faces_status', () => api.faceArtifactsStatus(), faceArtifactsStatusHuman, { raw: true });
  });

modelsFaces
  .command('install')
  .option('--force', 'download even if already present', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: ForceJsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'models_faces_install', { force: options.force === true });
    const result = await api.installFaceArtifacts({ force: options.force === true });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, () => 'Face models installed', true);
  });

program
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'status', () => api.status({ folder: cliWorkingDirectory }), statusHuman, { raw: true });
  });

program
  .command('reset')
  .argument('[filename]')
  .option('--force', 'reset without prompting', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (filename: string | undefined, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    const force = options.force === true;
    if (filename === undefined) {
      emitStarted(json, 'reset_all');
      let result = await api.resetAll({ folder: cliWorkingDirectory, force });
      if (!json && !force && !result.ok && result.error.code === 'force_required') {
        const confirmed = await confirmReset('Are you sure you want to clear all video records?');
        if (!confirmed) {
          emitCompleted(false, undefined, 'Reset cancelled.');
          return;
        }
        result = await api.resetAll({ folder: cliWorkingDirectory, force: true });
      }
      if (!result.ok) {
        emitError(json, result.error);
        return;
      }
      emitRaw(json, result.value, '');
      emitCompleted(json, result.value, resetHuman(result.value));
      return;
    }
    emitStarted(json, 'reset_single', { filename });
    let result = await api.resetSingle({ folder: cliWorkingDirectory, filename, force });
    if (!json && !force && !result.ok && result.error.code === 'force_required') {
      const confirmed = await confirmReset(`Reset "${filename}" to pending status?`);
      if (!confirmed) {
        emitCompleted(false, undefined, 'Reset cancelled.');
        return;
      }
      result = await api.resetSingle({ folder: cliWorkingDirectory, filename, force: true });
    }
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitRaw(json, result.value, '');
    emitCompleted(json, result.value, `Reset ${filename}`);
  });

program
  .command('process')
  .argument('<path>')
  .option('-f, --frames <number>', 'number of frames', numberOption, 3)
  .option('-s, --skip-rename', 'skip renaming', false)
  .option('-v, --verbose', 'verbose output', false)
  .option('-t, --timeout <seconds>', 'analysis timeout', numberOption, 120)
  .option('-w, --whisper <mode>', 'whisper mode', whisperOption, 'local')
  .option('--whisper-model <model>', 'whisper model', 'base')
  .option('--whisper-language <language>', 'whisper transcription language', whisperLanguageOption, 'auto')
  .option('--analyzer <backend>', 'analyzer backend: claude, local, or api', analyzerBackendOption)
  .option(
    '--provider <id>',
    `analyzer provider id: ${ANALYZER_PROVIDER_IDS.join(', ')}`,
    analyzerProviderOption,
  )
  .option('--local-model <tag>', 'local AI model')
  .option(
    '--force',
    'bypass only the global-index skip; does not re-analyze completed folder-catalog files (use reset or reset-single)',
    false,
  )
  .option('--json', 'machine-readable JSON output', false)
  .action(async (videoPath: string, options: ProcessOptions, command: Command) => {
    const json = isJsonMode(options);
    const conflict = conflictingAnalyzerSelection(options);
    if (conflict !== null) {
      emitError(json, conflict);
      return;
    }
    const validatedPath = await validateProcessPath(videoPath);
    if (!validatedPath.ok) {
      emitError(json, validatedPath.error, validatedPath.data);
      return;
    }
    const commandOptions = {
      frames: options.frames,
      skipRename: options.skipRename === true,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
      whisperLanguage: options.whisperLanguage,
    };
    emitStarted(json, 'process_single', { videoPath: validatedPath.value, options: commandOptions });
    await emitApiCostNotice(json, analyzerSelection(options), options.frames);
    let whisperModel: WhisperModelName | undefined;
    if (options.whisper === 'local') {
      const model = parseWhisperModel(options.whisperModel);
      if (!model.ok) {
        emitError(json, model.error);
        return;
      }
      whisperModel = model.value;
    }
    const result = await api.processVideo({
      videoPath: validatedPath.value,
      ...(optionWasPassed(command, 'frames') ? { frames: options.frames } : {}),
      ...(optionWasPassed(command, 'skipRename') ? { skipRename: options.skipRename === true } : {}),
      verbose: options.verbose === true,
      ...(optionWasPassed(command, 'timeout') ? { timeout: options.timeout } : {}),
      ...(optionWasPassed(command, 'whisper') ? { whisper: options.whisper } : {}),
      ...(optionWasPassed(command, 'whisperModel') && whisperModel !== undefined ? { whisperModel } : {}),
      ...(optionWasPassed(command, 'whisperLanguage') ? { whisperLanguage: options.whisperLanguage } : {}),
      ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.localModel === undefined ? {} : { localModel: options.localModel }),
      ...(options.force === true ? { force: true } : {}),
    });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, (data) => processHuman(data));
  });

program
  .command('process-drive')
  .argument('<root>')
  .option('-f, --frames <number>', 'number of frames', numberOption, 3)
  .option('-s, --skip-rename', 'skip renaming', false)
  .option('-v, --verbose', 'verbose output', false)
  .option('-t, --timeout <seconds>', 'analysis timeout', numberOption, 120)
  .option('-w, --whisper <mode>', 'whisper mode', whisperOption, 'local')
  .option('--whisper-model <model>', 'whisper model', 'base')
  .option('--whisper-language <language>', 'whisper transcription language', whisperLanguageOption, 'auto')
  .option('--analyzer <backend>', 'analyzer backend: claude, local, or api', analyzerBackendOption)
  .option(
    '--provider <id>',
    `analyzer provider id: ${ANALYZER_PROVIDER_IDS.join(', ')}`,
    analyzerProviderOption,
  )
  .option('--local-model <tag>', 'local AI model')
  .option(
    '--force',
    'bypass only the global-index skip; does not re-analyze completed folder-catalog files (use reset or reset-single)',
    false,
  )
  .option(
    '--gemini-batch',
    'submit the run to the Gemini Batch API (half price; results usually minutes, up to 24h)',
    false,
  )
  .option('--keep-awake', 'keep macOS awake while the drive run is active', false)
  .option('--skip-faces', 'skip the face-indexing pass that runs at the end of the run', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: ProcessDriveOptions, command: Command) => {
    const json = isJsonMode(options);
    const conflict = conflictingAnalyzerSelection(options);
    if (conflict !== null) {
      emitError(json, conflict);
      return;
    }
    const validatedRoot = await validateProcessRoot(root);
    if (!validatedRoot.ok) {
      emitError(json, validatedRoot.error, validatedRoot.data);
      return;
    }
    const commandOptions = {
      frames: options.frames,
      skipRename: options.skipRename === true,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
      whisperLanguage: options.whisperLanguage,
      force: options.force === true,
    };
    emitStarted(json, 'process_drive', { root: validatedRoot.value, options: commandOptions });
    await emitApiCostNotice(json, analyzerSelection(options), options.frames);
    let whisperModel: WhisperModelName | undefined;
    if (options.whisper === 'local') {
      const model = parseWhisperModel(options.whisperModel);
      if (!model.ok) {
        emitError(json, model.error);
        return;
      }
      whisperModel = model.value;
    }
    const keepAwake = startKeepAwake(options.keepAwake === true);
    try {
      const result = await api.processDrive({
        root: validatedRoot.value,
        ...(optionWasPassed(command, 'frames') ? { frames: options.frames } : {}),
        ...(optionWasPassed(command, 'skipRename') ? { skipRename: options.skipRename === true } : {}),
        verbose: options.verbose === true,
        ...(optionWasPassed(command, 'timeout') ? { timeout: options.timeout } : {}),
        ...(optionWasPassed(command, 'whisper') ? { whisper: options.whisper } : {}),
        ...(optionWasPassed(command, 'whisperModel') && whisperModel !== undefined ? { whisperModel } : {}),
        ...(optionWasPassed(command, 'whisperLanguage') ? { whisperLanguage: options.whisperLanguage } : {}),
        ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.localModel === undefined ? {} : { localModel: options.localModel }),
        ...(options.force === true ? { force: true } : {}),
        ...(optionWasPassed(command, 'geminiBatch') ? { geminiBatch: options.geminiBatch === true } : {}),
        ...(optionWasPassed(command, 'skipFaces') ? { skipFaces: options.skipFaces === true } : {}),
      });
      if (!result.ok) {
        emitError(json, result.error);
        return;
      }
      await waitForDriveJobAndEmit(json, result.value.jobId);
    } finally {
      keepAwake?.kill();
    }
  });

program
  .command('materialize')
  .argument('<root>')
  .description('Apply an existing catalog to a now-writable drive, without re-analysis')
  .option('--dry-run', 'list every planned operation without touching disk', false)
  .option('--keep-awake', 'keep macOS awake while the run is active', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: MaterializeOptions) => {
    const json = isJsonMode(options);
    const validatedRoot = await validateProcessRoot(root);
    if (!validatedRoot.ok) {
      emitError(json, validatedRoot.error, validatedRoot.data);
      return;
    }
    const dryRun = options.dryRun === true;
    emitStarted(json, 'materialize', { root: validatedRoot.value, dryRun });
    const keepAwake = startKeepAwake(options.keepAwake === true);
    try {
      const result = await api.materialize({ root: validatedRoot.value, dryRun });
      if (!result.ok) {
        emitError(json, result.error);
        return;
      }
      await waitForDriveJobAndEmit(json, result.value.jobId, materializeHuman);
    } finally {
      keepAwake?.kill();
    }
  });

program
  .command('thumbnail')
  .argument('<video-path>')
  .option('--force', 'regenerate thumbnail', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (videoPath: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    const resolvedVideoPath = path.resolve(cliWorkingDirectory, videoPath);
    emitStarted(json, 'thumbnail', { videoPath: resolvedVideoPath, force: options.force === true });
    const result = await api.generateThumbnail({ videoPath: resolvedVideoPath, force: options.force === true });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    const human = result.value.skipped
      ? `Thumbnail already exists: ${result.value.thumbnailPath}`
      : `Generated thumbnail: ${result.value.thumbnailPath}`;
    emitCompleted(json, result.value, human);
  });

program
  .command('thumbnails')
  .argument('<root>')
  .description('Generate every missing catalog thumbnail under a folder tree')
  .option('--force', 'regenerate thumbnails that already exist', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    const force = options.force === true;
    emitStarted(json, 'thumbnails', { root: resolvedRoot, force });
    const result = await api.thumbnails({ root: resolvedRoot, force });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, thumbnailsHuman);
  });

const gps = program.command('gps');

gps
  .command('backfill')
  .argument('<timeline-path>')
  .description('Fill empty catalog coordinates from a Google Timeline export')
  .option('--root <path>', 'restrict the backfill to files under this folder')
  .option('--dry-run', 'report matches without writing', false)
  .option('--tolerance-minutes <minutes>', 'match tolerance in minutes', '30')
  .option('--max-visit-hours <hours>', 'visits longer than this are treated as low-accuracy', '36')
  .option('--reresolve-places', 're-resolve place names even where one is already stored', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (
    timelinePath: string,
    options: { root?: string; dryRun?: boolean; toleranceMinutes: string; maxVisitHours: string; reresolvePlaces?: boolean; json?: boolean },
  ) => {
    const json = isJsonMode(options);
    const resolvedTimelinePath = path.resolve(cliWorkingDirectory, timelinePath);
    const input = {
      timelinePath: resolvedTimelinePath,
      root: options.root === undefined ? undefined : path.resolve(cliWorkingDirectory, options.root),
      dryRun: options.dryRun === true,
      toleranceMinutes: Number.parseInt(options.toleranceMinutes, 10),
      maxVisitHours: Number.parseInt(options.maxVisitHours, 10),
      reresolvePlaces: options.reresolvePlaces === true,
    };
    emitStarted(json, 'gps_backfill', input);
    const result = await api.gpsBackfill(input);
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, gpsBackfillHuman, true);
  });

const config = program.command('config');

config
  .command('get')
  .argument('[key]')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (key: string | undefined, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'config_get', { key: key ?? null });
    const parsedKey = configKey(key);
    if (key !== undefined && parsedKey === null) {
      emitError(json, appError('unknown_config_key', `Unknown config key: ${key}`));
      return;
    }
    const result = await api.config({
      ...(cliConfigFolder === undefined ? {} : { folder: cliConfigFolder }),
      key: parsedKey,
    });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    if ('key' in result.value) warnIgnoredFolderConfig(result.value.key, result.value.ignoredFolderValue);
    emitRaw(json, result.value, '');
    emitCompleted(json, result.value, configGetHuman(result.value));
  });

config
  .command('set')
  .argument('<key>')
  .argument('<value>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (key: string, value: string, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'config_set', { key, value });
    const parsedKey = configKey(key);
    if (parsedKey === null) {
      emitError(json, appError('unknown_config_key', `Unknown config key: ${key}`));
      return;
    }
    const result = await api.setConfig({
      ...(cliConfigFolder === undefined ? {} : { folder: cliConfigFolder }),
      key: parsedKey,
      value,
    });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    warnIgnoredFolderConfig(result.value.key, result.value.ignoredFolderValue);
    const scopeNote = result.value.scope === 'home' && cliConfigFolder !== undefined ? ' (app-wide)' : '';
    emitCompleted(json, result.value, `Set ${result.value.key}=${result.value.value}${scopeNote}`);
  });

config
  .command('set-credential')
  .argument('<providerId>')
  .option('--env <name>', 'read the credential from an environment variable')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (providerId: string, options: CredentialOptions) => {
    const json = isJsonMode(options);
    emitStarted(json, 'config_set_credential', { providerId });
    const credential = credentialFromEnvironment(providerId, options.env) ?? await promptHiddenCredential();
    if (credential === null || credential.length === 0) {
      emitError(json, appError('missing_api_key', 'No API credential was provided'));
      return;
    }
    const result = await api.setCredential({ providerId, credential });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitCompleted(
      json,
      result.value,
      `Stored credential for ${providerId} in the ${CREDENTIALS_BACKEND_LABELS[result.value.backend.backend]}`,
    );
  });

config
  .command('delete-credential')
  .argument('<providerId>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (providerId: string, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'config_delete_credential', { providerId });
    const result = await api.deleteCredential({ providerId });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitCompleted(json, result.value, credentialDeleteHuman(result.value));
  });

program
  .command('check')
  .argument('[folder]')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (folder: string | undefined, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'check',
      () => api.check({ folder: folder ?? cliWorkingDirectory }),
      checkHuman,
      {
        exitOnData: (data) => data.hasNestedDatabases ? EXIT_CODE_BY_ERROR_CODE.nested_databases_found : null,
      },
    );
  });

program
  .command('scan')
  .argument('<folder>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (folder: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'scan', () => api.scan({ folder }), scanHuman, { raw: true });
  });

const collectRepeatable = (value: string, previous: string[]): string[] => [...previous, value];

const searchSortOption = (value: string): NonNullable<SearchOptions['sort']> => {
  for (const sort of SEARCH_SORTS) if (value === sort) return sort;
  throw new InvalidArgumentError(`Invalid sort: ${value}. Valid values: ${SEARCH_SORTS.join(', ')}`);
};

const resolveSearchPersonIds = async (people: readonly string[]): Promise<Result<string[], AppError>> => {
  if (people.length === 0) return { ok: true, value: [] };
  const listed = await api.facesPeople();
  if (!listed.ok) return { ok: false, error: appError('validation', `Could not resolve --person filters: ${listed.error.message}`) };
  const ids: string[] = [];
  for (const entry of people) {
    if (entry.startsWith('person-')) {
      ids.push(entry);
      continue;
    }
    const matches = listed.value.people.filter(
      (person) => person.displayName !== null && person.displayName.toLocaleLowerCase() === entry.toLocaleLowerCase(),
    );
    const [onlyMatch] = matches;
    if (matches.length === 0) return { ok: false, error: appError('validation', `No person found matching "${entry}"`) };
    if (matches.length > 1 || onlyMatch === undefined) {
      return {
        ok: false,
        error: appError('validation', `Multiple people match "${entry}": ${matches.map((match) => match.personId).join(', ')}`),
      };
    }
    ids.push(onlyMatch.personId);
  }
  return { ok: true, value: ids };
};

const resolveSearchFolderId = async (folder: string | undefined): Promise<Result<string | undefined, AppError>> => {
  if (folder === undefined) return { ok: true, value: undefined };
  const resolvedPath = path.resolve(cliWorkingDirectory, folder);
  const status = await api.indexStatus();
  if (!status.ok) return status;
  const match = status.value.folders.find((entry) => entry.currentPath === resolvedPath);
  if (match === undefined) return { ok: false, error: appError('validation', `Unknown catalog folder: ${resolvedPath}`) };
  return { ok: true, value: match.folderId };
};

program
  .command('search')
  .argument('[query]')
  .option('--tag <name>', 'filter by tag (repeatable, AND semantics, aliases auto-expand)', collectRepeatable, [])
  .option('--person <nameOrId>', 'filter by person name or id (repeatable, OR semantics)', collectRepeatable, [])
  .option('--place <text>', 'case-insensitive substring match over place name/region/country')
  .option('--from <iso>', 'captured-at lower bound (ISO date or datetime)')
  .option('--to <iso>', 'captured-at upper bound (ISO date or datetime)')
  .option('--has-gps', 'only items with GPS coordinates')
  .option('--no-has-gps', 'only items without GPS coordinates')
  .option('--folder <path>', 'restrict results to a known catalog folder')
  .option('--sort <sort>', `${SEARCH_SORTS.join('|')}`, searchSortOption)
  .option('--limit <number>', 'maximum result count', numberOption, 50)
  .option('--offset <number>', 'result offset', numberOption, 0)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (query: string | undefined, options: SearchOptions) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'search',
      async () => {
        const personIds = await resolveSearchPersonIds(options.person);
        if (!personIds.ok) return personIds;
        const folderId = await resolveSearchFolderId(options.folder);
        if (!folderId.ok) return folderId;
        return api.search({
          query,
          tags: options.tag,
          people: personIds.value,
          place: options.place,
          from: options.from,
          to: options.to,
          hasGps: options.hasGps,
          folderId: folderId.value,
          sort: options.sort,
          limit: options.limit,
          offset: options.offset,
        });
      },
      searchHuman,
      { raw: true },
    );
  });

const variants = program.command('variants').description('Inspect and manage analysis variants');

variants
  .command('list')
  .description('List every analysis variant for a video')
  .argument('<path>', 'video path')
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (videoPath: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const resolvedVideoPath = path.resolve(cliWorkingDirectory, videoPath);
    emitStarted(json, 'variants_list', { videoPath: resolvedVideoPath });
    const result = await api.listVariants({ videoPath: resolvedVideoPath });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    if (json) {
      for (const variant of result.value.variants) emitRaw(true, variantNdjsonRow(variant), '');
      emitCompleted(true, {
        fingerprint: result.value.fingerprint,
        videoPath: result.value.videoPath,
        folderDefaultConfigId: result.value.folderDefaultConfigId,
        count: result.value.variants.length,
      });
      return;
    }
    emitCompleted(false, result.value, variantsListHuman(result.value));
  });

variants
  .command('select')
  .description('Select the analysis variant used by search and projected artifacts')
  .argument('<path>', 'video path')
  .requiredOption('--config <configId>', 'configuration id to select')
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (videoPath: string, options: VariantConfigOptions) => {
    const json = isJsonMode(options);
    const resolvedVideoPath = path.resolve(cliWorkingDirectory, videoPath);
    await runSimple(
      json,
      'variants_select',
      () => api.selectVariant({ videoPath: resolvedVideoPath, configId: options.config }),
      (data) => `Selected ${data.configId} for ${resolvedVideoPath}`,
      { startData: { videoPath: resolvedVideoPath, configId: options.config } },
    );
  });

variants
  .command('delete')
  .description('Delete one analysis variant while preserving other variants')
  .argument('<path>', 'video path')
  .requiredOption('--config <configId>', 'configuration id to delete')
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (videoPath: string, options: VariantConfigOptions) => {
    const json = isJsonMode(options);
    const resolvedVideoPath = path.resolve(cliWorkingDirectory, videoPath);
    await runSimple(
      json,
      'variants_delete',
      () => api.deleteVariant({ videoPath: resolvedVideoPath, configId: options.config }),
      (data) => `Deleted ${data.configId}; selected variant is ${data.selectedConfigId}`,
      { startData: { videoPath: resolvedVideoPath, configId: options.config } },
    );
  });

variants
  .command('default')
  .description('Set or clear the default analysis configuration for a folder')
  .argument('<folder>', 'folder path')
  .option('--config <configId>', 'configuration id to use by default')
  .option('--clear', 'clear the explicit folder default', false)
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (folderPath: string, options: VariantDefaultOptions) => {
    const json = isJsonMode(options);
    const resolvedFolderPath = path.resolve(cliWorkingDirectory, folderPath);
    const clear = options.clear === true;
    const invalid = (clear && options.config !== undefined) || (!clear && options.config === undefined);
    if (invalid) {
      emitStarted(json, 'variants_default', { folderPath: resolvedFolderPath });
      emitError(json, appError('validation', 'Use exactly one of --config <configId> or --clear'));
      return;
    }
    const selectedConfigId = clear ? null : options.config ?? null;
    await runSimple(
      json,
      'variants_default',
      () => api.setFolderDefaultVariant({ folderPath: resolvedFolderPath, configId: selectedConfigId }),
      (data) => data.defaultConfigId === null
        ? `Cleared the folder default; resolved configuration is ${data.resolvedConfigId}`
        : `Set the folder default to ${data.defaultConfigId}`,
      { startData: { folderPath: resolvedFolderPath, configId: selectedConfigId } },
    );
  });

program
  .command('doctor')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'doctor');
    const result = await api.doctor();
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    const live = await api.healthLive();
    const ready = await api.healthReady();
    emitCompleted(json, result.value, doctorHuman(result.value, live, ready));
    if (!result.value.allAvailable) process.exitCode = EXIT_CODE_BY_ERROR_CODE.prerequisites_failed;
  });

const index = program.command('index').description('Inspect and rebuild the global catalog index');

index
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'index_status', () => api.indexStatus(), indexStatusHuman, { raw: true });
  });

index
  .command('rebuild')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'index_rebuild', () => api.indexRebuild(), indexRebuildHuman, { raw: true });
  });

index
  .command('forget')
  .argument('<fingerprint>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (fingerprint: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'index_forget',
      () => api.indexForget({ fingerprint }),
      (data) => data.deleted
        ? `Forgot ${data.fingerprint}${data.snapshotSkipped ? ' (folder snapshot not updated: the folder is not writable)' : ''}`
        : `No catalog entry for ${data.fingerprint}`,
      { raw: true },
    );
  });

const tags = program.command('tags').description('Inspect and manage catalog tags');

tags
  .command('list')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'tags_list', () => api.listTags(), tagsListHuman, { raw: true });
  });

tags
  .command('alias')
  .argument('<from>')
  .argument('<to>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (from: string, to: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'tags_alias', () => api.aliasTag({ from, to }), tagsAliasHuman, { raw: true });
  });

tags
  .command('suggest-aliases')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'tags_suggest_aliases', () => api.suggestTagAliases(), tagsSuggestAliasesHuman, { raw: true });
  });

const faces = program.command('faces').description('Index and manage people detected across the catalog');

faces
  .command('index')
  .argument('<root>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    emitStarted(json, 'faces_index', { root: resolvedRoot });
    const result = await api.facesIndex({ root: resolvedRoot });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, facesIndexHuman, true);
  });

faces
  .command('people')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'faces_people', () => api.facesPeople(), facesPeopleHuman, { raw: true });
  });

faces
  .command('name')
  .argument('<personId>')
  .argument('<displayName>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (personId: string, displayName: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'faces_name',
      () => api.facesName({ personId, displayName }),
      (data) => `Named ${data.personId} "${data.displayName}" (${data.affectedFingerprints.length} files re-synced)`,
      { raw: true },
    );
  });

faces
  .command('merge')
  .argument('<fromPersonId>')
  .argument('<toPersonId>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (fromPersonId: string, toPersonId: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'faces_merge',
      () => api.facesMerge({ fromPersonId, toPersonId }),
      (data) => `Merged ${data.fromPersonId} into ${data.toPersonId} (${data.movedObservations} observations moved)`,
      { raw: true },
    );
  });

faces
  .command('forget')
  .argument('<personId>')
  .option('--force', 'delete the person without prompting', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (personId: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'faces_forget',
      () => api.facesForget({ personId, force: options.force === true }),
      (data) => data.deleted
        ? `Forgot ${data.personId} (${data.cropPathsDeleted} crops deleted)`
        : `Forget requires --force flag`,
      { raw: true },
    );
  });

faces
  .command('purge')
  .option('--force', 'wipe all people and observations without prompting', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: ForceJsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'faces_purge',
      () => api.facesPurge({ force: options.force === true }),
      (data) => `Purged ${data.peopleDeleted} people and ${data.observationsDeleted} observations (${data.cropPathsDeleted} crops deleted)`,
      { raw: true },
    );
  });

faces
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'faces_status', () => api.facesStatus(), facesStatusHuman, { raw: true });
  });

faces
  .command('recluster')
  .description('rebuild people and assignments from stored embeddings (person ids change)')
  .option('--dry-run', 'compute the report without writing', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption & { dryRun?: boolean }) => {
    const json = isJsonMode(options);
    const dryRun = options.dryRun === true;
    emitStarted(json, 'faces_recluster', { dryRun });
    const result = await api.facesRecluster({ dryRun });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, facesReclusterHuman, true);
  });

faces
  .command('exemplars')
  .description('fill missing exemplar crops by re-cutting the frames the observations came from')
  .option('--dry-run', 'compute the plan without writing', false)
  .option('--limit <n>', 'process at most this many files', (value: string) => Number.parseInt(value, 10))
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption & { dryRun?: boolean; limit?: number }) => {
    const json = isJsonMode(options);
    const dryRun = options.dryRun === true;
    const limit = options.limit ?? null;
    emitStarted(json, 'faces_exemplars', { dryRun, limit });
    const result = await api.facesExemplars({ dryRun, limit });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, facesExemplarsHuman, true);
  });

const photos = program.command('photos').description('Index and manage the photo catalog');

photos
  .command('scan')
  .argument('<root>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    emitStarted(json, 'photos_scan', { root: resolvedRoot });
    const result = await api.photosScan({ root: resolvedRoot });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, () => 'Photo scan complete', true);
  });

photos
  .command('status')
  .argument('[root]')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string | undefined, options: JsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = root === undefined ? undefined : path.resolve(cliWorkingDirectory, root);
    await runSimple(
      json,
      'photos_status',
      () => api.photosStatus({ root: resolvedRoot }),
      photosStatusHuman,
      { raw: true },
    );
  });

photos
  .command('proxies')
  .argument('<root>')
  .option('--force', 'regenerate proxies even when already present', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    const force = options.force === true;
    emitStarted(json, 'photos_proxies', { root: resolvedRoot, force });
    const result = await api.photosProxies({ root: resolvedRoot, force });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, photosProxiesHuman, true);
  });

interface PhotosProcessOptions extends ForceJsonOption {
  batchSize?: string | undefined;
}

photos
  .command('process')
  .argument('<root>')
  .option('--force', 'reanalyse photos already analysed under the current config', false)
  .option('--batch-size <n>', 'photos per analyzer call (1-12)')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: PhotosProcessOptions) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    const force = options.force === true;
    const batchSize = options.batchSize === undefined ? undefined : Number.parseInt(options.batchSize, 10);
    emitStarted(json, 'photos_process', { root: resolvedRoot, force, batchSize: batchSize ?? null });
    const result = await api.photosProcess({ root: resolvedRoot, force, batchSize });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, photosProcessHuman, true);
  });

const photosGps = photos.command('gps').description('Fill photo GPS and place data from a Google Timeline export');

photosGps
  .command('backfill')
  .argument('<timeline-path>')
  .description('Fill empty photo coordinates from a Google Timeline export')
  .option('--root <path>', 'restrict the backfill to photos under this folder')
  .option('--dry-run', 'report matches without writing', false)
  .option('--tolerance-minutes <minutes>', 'match tolerance in minutes', '30')
  .option('--max-visit-hours <hours>', 'visits longer than this are treated as low-accuracy', '36')
  .option('--reresolve-places', 're-resolve place names even where one is already stored', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (
    timelinePath: string,
    options: { root?: string; dryRun?: boolean; toleranceMinutes: string; maxVisitHours: string; reresolvePlaces?: boolean; json?: boolean },
  ) => {
    const json = isJsonMode(options);
    const resolvedTimelinePath = path.resolve(cliWorkingDirectory, timelinePath);
    const input = {
      timelinePath: resolvedTimelinePath,
      root: options.root === undefined ? undefined : path.resolve(cliWorkingDirectory, options.root),
      dryRun: options.dryRun === true,
      toleranceMinutes: Number.parseInt(options.toleranceMinutes, 10),
      maxVisitHours: Number.parseInt(options.maxVisitHours, 10),
      reresolvePlaces: options.reresolvePlaces === true,
    };
    emitStarted(json, 'photos_gps_backfill', input);
    const result = await api.photosGpsBackfill(input);
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJobAndEmit(json, result.value.jobId, photosGpsBackfillHuman, true);
  });

photos
  .command('forget')
  .argument('<root>')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const resolvedRoot = path.resolve(cliWorkingDirectory, root);
    await runSimple(
      json,
      'photos_forget',
      () => api.photosForget({ root: resolvedRoot }),
      photosForgetHuman,
      { raw: true },
    );
  });

interface PhotosSearchOptions extends JsonOption {
  limit: number;
}

photos
  .command('search')
  .argument('<query>')
  .option('--limit <number>', 'maximum result count', numberOption, 50)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (query: string, options: PhotosSearchOptions) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'photos_search',
      () => api.photosSearch({ query, limit: options.limit, offset: 0 }),
      photosSearchHuman,
      { raw: true },
    );
  });

const photosVariants = photos.command('variants').description('Inspect and manage photo analysis variants');

const parsePhotoConfigId = (value: string): string | null => (value === 'none' ? null : value);

photosVariants
  .command('list')
  .description('List every analysis variant for a photo')
  .argument('<fingerprint>')
  .option('--json', 'machine-readable NDJSON output', false)
  .action(async (fingerprint: string, options: JsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'photos_variants_list', { fingerprint });
    const result = await api.photosVariantsList({ fingerprint });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    if (json) {
      for (const variant of result.value.variants) emitRaw(true, photosVariantNdjsonRow(variant), '');
      emitCompleted(true, {
        fingerprint: result.value.fingerprint,
        selectedConfigId: result.value.selectedConfigId,
        count: result.value.variants.length,
      });
      return;
    }
    emitCompleted(false, result.value, photosVariantsListHuman(result.value));
  });

photosVariants
  .command('select')
  .description('Select the analysis variant used by search and the detail pane')
  .argument('<fingerprint>')
  .argument('<configId>', 'configuration id to select, or "none" to clear')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (fingerprint: string, configIdArgument: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const configId = parsePhotoConfigId(configIdArgument);
    await runSimple(
      json,
      'photos_variants_select',
      () => api.photosVariantsSelect({ fingerprint, configId }),
      (data) => data.configId === null ? 'Cleared the explicit selection' : `Selected ${data.configId}`,
      { startData: { fingerprint, configId } },
    );
  });

photosVariants
  .command('delete')
  .description('Delete one analysis variant')
  .argument('<fingerprint>')
  .argument('<configId>', 'configuration id to delete')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (fingerprint: string, configId: string, options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'photos_variants_delete',
      () => api.photosVariantsDelete({ fingerprint, configId }),
      (data) => `Deleted ${data.configId}; selected variant is ${data.selectedConfigId ?? 'none'}`,
      { startData: { fingerprint, configId } },
    );
  });

photosVariants
  .command('folder-default')
  .description('Set or clear the default analysis configuration for a photo folder')
  .argument('<folderId>')
  .argument('<configId>', 'configuration id to use by default, or "none" to clear')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (folderId: string, configIdArgument: string, options: JsonOption) => {
    const json = isJsonMode(options);
    const configId = parsePhotoConfigId(configIdArgument);
    await runSimple(
      json,
      'photos_variants_folder_default',
      () => api.photosVariantsFolderDefault({ folderId, configId }),
      (data) => data.defaultConfigId === null ? 'Cleared the folder default' : `Set the folder default to ${data.defaultConfigId}`,
      { startData: { folderId, configId } },
    );
  });

const configKey = (key: string | undefined) => {
  if (key === undefined) return null;
  const parsed = configKeySchema.safeParse(key);
  return parsed.success ? parsed.data : null;
};

const credentialFromEnvironment = (providerId: string, requestedName: string | undefined): string | null => {
  if (requestedName !== undefined) return process.env[requestedName] ?? null;
  const generic = process.env.AI_VIDEO_CATALOGER_API_KEY;
  if (generic !== undefined && generic.length > 0) return generic;
  if (providerId === 'openai') return process.env.OPENAI_API_KEY ?? null;
  return null;
};

const promptHiddenCredential = async (): Promise<string | null> => {
  const streams = promptStreams();
  if (!isInteractiveInput(streams.input)) return null;
  return promptMaskedSecret(streams, 'API credential: ');
};

const createSetupPrompter = (): SetupPrompter => createMaskedPrompter(promptStreams());

type ApiAnalyzerProvider = Extract<AnalyzerProviderConfig, { family: 'api' }>;

const DEFAULT_API_PROVIDER: ApiAnalyzerProvider = {
  family: 'api',
  providerId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'openai',
  model: 'gpt-4.1-mini',
  maxImageDetail: 'auto',
};

const storedApiProvider = async (): Promise<ApiAnalyzerProvider | null> => {
  const stored = await api.config({ folder: cliWorkingDirectory, key: 'analyzer_provider' });
  if (!stored.ok || !('key' in stored.value) || stored.value.value === null) return null;
  try {
    const parsed = analyzerProviderConfigSchema.parse(JSON.parse(stored.value.value));
    return parsed.family === 'api' ? parsed : null;
  } catch {
    return null;
  }
};

const apiProviderForNotice = async (selection: AnalyzerSelection): Promise<ApiAnalyzerProvider | null> => {
  if (selection.provider !== undefined) {
    const builtIn = builtInAnalyzerProvider(selection.provider);
    if (builtIn === null || builtIn.family !== 'api') return null;
    const stored = await storedApiProvider();
    return stored?.providerId === builtIn.providerId ? stored : builtIn;
  }
  if (selection.analyzer !== undefined && selection.analyzer !== 'api') return null;
  const stored = await storedApiProvider();
  if (stored !== null) return stored;
  return selection.analyzer === 'api' ? DEFAULT_API_PROVIDER : null;
};

const emitApiCostNotice = async (
  json: boolean,
  selection: AnalyzerSelection,
  frameCount: number,
): Promise<void> => {
  const selected = await apiProviderForNotice(selection);
  if (selected === null) return;
  const signal = apiCostSignal(selected, estimateApiTokens({ transcriptCharacters: 0, frameCount }));
  if (json) {
    emitProgress(true, { step: 'api_cost_notice', data: signal });
    return;
  }
  process.stdout.write(`Notice: ${signal.message}\n`);
};

const faceArtifactsStatusHuman = (
  data: Awaited<ReturnType<ApiClient['faceArtifactsStatus']>> extends Result<infer T, AppError> ? T : never,
): string => {
  const lines = [`Face models: ${data.ready ? 'ready' : 'not installed'}`];
  for (const artifact of data.artifacts) {
    lines.push(`${artifact.downloaded ? '*' : ' '} ${artifact.artifactId} (${artifact.license})`);
  }
  return lines.join('\n');
};

const facesPeopleHuman = (
  data: Awaited<ReturnType<ApiClient['facesPeople']>> extends Result<infer T, AppError> ? T : never,
): string => {
  if (data.people.length === 0) return 'No people indexed yet';
  return data.people
    .map((person) => `${person.personId} ${person.displayName ?? '(unnamed)'} - ${person.exemplarCount} exemplars (${person.exemplarCropPaths.length} crops)`)
    .join('\n');
};

const facesStatusHuman = (
  data: Awaited<ReturnType<ApiClient['facesStatus']>> extends Result<infer T, AppError> ? T : never,
): string =>
  `Faces: ${data.enabled ? 'enabled' : 'disabled'}, models ${data.artifactsReady ? 'ready' : 'missing'}\n`
  + `People: ${data.people}\nObservations: ${data.observations} (${data.assignedObservations} assigned, ${data.unassignedObservations} unassigned)\n`
  + `Files indexed: ${data.filesIndexed}`
  + (data.staleVersionFiles > 0 ? `\nStale-version files (need re-index): ${data.staleVersionFiles}` : '');

const facesIndexHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Face indexing complete';
  const indexed = typeof data.filesIndexed === 'number' ? data.filesIndexed : 0;
  const observations = typeof data.observationsAdded === 'number' ? data.observationsAdded : 0;
  const people = typeof data.peopleCreated === 'number' ? data.peopleCreated : 0;
  const failed = typeof data.filesFailed === 'number' ? data.filesFailed : 0;
  const scanned = typeof data.filesScanned === 'number' ? data.filesScanned : 0;
  if (scanned === 0) {
    const folders = typeof data.foldersMatched === 'number' ? data.foldersMatched : 0;
    const filesInScope = typeof data.filesInScope === 'number' ? data.filesInScope : 0;
    return `Nothing to index: ${folders} catalog folders, ${filesInScope} analyzed files already indexed`;
  }
  return `Indexed ${indexed} files, added ${observations} observations, created ${people} people`
    + (failed > 0 ? `, ${failed} file(s) failed` : '');
};

const facesReclusterHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Recluster complete';
  const observations = typeof data.observations === 'number' ? data.observations : 0;
  const personsBefore = typeof data.personsBefore === 'number' ? data.personsBefore : 0;
  const personsAfter = typeof data.personsAfter === 'number' ? data.personsAfter : 0;
  const reassigned = typeof data.observationsReassigned === 'number' ? data.observationsReassigned : 0;
  const unassigned = typeof data.observationsUnassigned === 'number' ? data.observationsUnassigned : 0;
  const namesCarried = typeof data.namesCarried === 'number' ? data.namesCarried : 0;
  const namesDropped = Array.isArray(data.namesDropped) ? data.namesDropped.length : 0;
  const personsWithoutExemplar = typeof data.personsWithoutExemplar === 'number' ? data.personsWithoutExemplar : 0;
  const dryRun = data.dryRun === true;
  return `Reclustered ${observations} observations: ${personsBefore} → ${personsAfter} people `
    + `(${reassigned} reassigned, ${unassigned} unassigned), `
    + `${namesCarried} names carried, ${namesDropped} dropped`
    + (dryRun ? ' — dry run, nothing written' : '')
    + (personsWithoutExemplar > 0 ? ` — ${personsWithoutExemplar} people have no photo yet, run \`faces exemplars\`` : '');
};

const facesExemplarsHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Exemplars complete';
  const cropsWritten = typeof data.cropsWritten === 'number' ? data.cropsWritten : 0;
  const filesVisited = typeof data.filesVisited === 'number' ? data.filesVisited : 0;
  const filesUnavailable = typeof data.filesUnavailable === 'number' ? data.filesUnavailable : 0;
  const detectionsMismatched = typeof data.detectionsMismatched === 'number' ? data.detectionsMismatched : 0;
  const peopleWithoutExemplarBefore = typeof data.peopleWithoutExemplarBefore === 'number' ? data.peopleWithoutExemplarBefore : 0;
  const peopleWithoutExemplarAfter = typeof data.peopleWithoutExemplarAfter === 'number' ? data.peopleWithoutExemplarAfter : 0;
  const dryRun = data.dryRun === true;
  const limitReached = data.limitReached === true;
  return `Exemplars: wrote ${cropsWritten} crops over ${filesVisited} files `
    + `(${filesUnavailable} unavailable, ${detectionsMismatched} detections no longer matched), `
    + `${peopleWithoutExemplarBefore} → ${peopleWithoutExemplarAfter} people without a photo`
    + (dryRun ? ' — dry run, nothing written' : '')
    + (limitReached ? ' (limit reached)' : '');
};

const modelsListHuman = (
  data: Awaited<ReturnType<ApiClient['modelsWhisper']>> extends Result<infer T, AppError> ? T : never,
  localAi: Awaited<ReturnType<ApiClient['localAiRequirements']>> extends Result<infer T, AppError> ? T : never,
): string => {
  const lines = ['Whisper models:'];
  for (const model of data.models) {
    lines.push(`${model.active ? '*' : ' '} ${model.name} ${model.size} ${model.downloaded ? 'downloaded' : 'not downloaded'}`);
  }
  lines.push('', 'Local AI models (Ollama):');
  for (const tier of localAi.tiers) {
    const recommended = tier.recommended ? ' (recommended)' : '';
    const installed = tier.installed ? 'installed' : 'not installed';
    lines.push(`  ${tier.tag}${recommended} - ${installed} - ${tier.downloadGB} GB, needs ${tier.minTotalMemGB} GB RAM - ${localAiSupportHuman(tier.supportLevel)}`);
  }
  if (!localAi.runtimeUp) lines.push('', 'Runtime not running (starts automatically when needed).');
  return lines.join('\n');
};

const localAiSupportHuman = (supportLevel: 'ok' | 'insufficient-ram' | 'unsupported-platform'): string => {
  if (supportLevel === 'ok') return 'compatible';
  if (supportLevel === 'insufficient-ram') return 'not enough RAM';
  return 'Apple Silicon required';
};

const requirementsHuman = (data: Awaited<ReturnType<ApiClient['localAiRequirements']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = [`Your machine: ${data.machine.platform}/${data.machine.arch}, ${data.machine.totalMemGB}GB RAM`];
  lines.push(`Runtime: ${data.runtimeUp ? 'running' : 'stopped'} ${data.runtimeVersion}`);
  for (const tier of data.tiers) {
    lines.push(`${tier.tag} ${tier.label} ${tier.supportLevel}${tier.installed ? ' installed' : ''}`);
  }
  return lines.join('\n');
};

const whisperRuntimeStatusHuman = (
  data: Awaited<ReturnType<ApiClient['whisperRuntimeStatus']>> extends Result<infer T, AppError> ? T : never,
): string => {
  if (data.available) return `Whisper runtime: ${data.source ?? 'unknown'} (${data.path ?? 'unknown path'})`;
  if (!data.buildToolsAvailable) return `Whisper runtime missing; managed build requires ${data.missingBuildTools.join(' and ')}`;
  return 'Whisper runtime missing; run models whisper-runtime install';
};

const whisperRuntimeInstallHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Installed managed whisper.cpp runtime';
  return data.installed === false
    ? 'Managed whisper.cpp runtime is already installed'
    : `Installed managed whisper.cpp runtime${typeof data.path === 'string' ? ` at ${data.path}` : ''}`;
};

const statusHuman = (data: Awaited<ReturnType<ApiClient['status']>> extends Result<infer T, AppError> ? T : never): string =>
  `Completed: ${data.summary.completed}\nIn Progress: ${data.summary.inProgress}\nPending: ${data.summary.pending}\nError: ${data.summary.error}`;

const resetHuman = (data: Awaited<ReturnType<ApiClient['resetAll']>> extends Result<infer T, AppError> ? T : never): string =>
  `Cleared ${data.cleared} video records`;

const checkHuman = (data: Awaited<ReturnType<ApiClient['check']>> extends Result<infer T, AppError> ? T : never): string => {
  if (data.hasNestedDatabases) return `Nested databases found:\n${data.nestedPaths.join('\n')}`;
  if (data.ownNestedPaths.length > 0) {
    return `No foreign nested databases found; ${String(data.ownNestedPaths.length)} nested catalogs of this app`;
  }
  return 'No nested databases found';
};

const scanHuman = (data: Awaited<ReturnType<ApiClient['scan']>> extends Result<infer T, AppError> ? T : never): string =>
  `Found ${data.summary.total} video files`;

const indexStatusHuman = (data: Awaited<ReturnType<ApiClient['indexStatus']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = [
    `Database: ${data.databasePath}`,
    `Folders: ${data.counts.folders}`,
    `Files: ${data.counts.files}`,
    `Analyses: ${data.counts.analyses}`,
    `Estimated Gemini spend (${data.currentMonthSpend.month}): $${data.currentMonthSpend.estimatedCostUsd.toFixed(4)} (${String(data.currentMonthSpend.entries)} analyses)`,
  ];
  if (data.latestRun !== null) {
    const finished = data.latestRun.finishedAt ?? 'running';
    lines.push(
      `Latest drive run: ${data.latestRun.root} folders=${data.latestRun.foldersDone}/${data.latestRun.foldersTotal} files=${data.latestRun.filesDone} skipped=${data.latestRun.filesSkipped} failed=${data.latestRun.filesFailed} finished=${finished}`,
    );
  }
  for (const folder of data.folders) lines.push(`  ${folder.displayName} -> ${folder.currentPath}`);
  return lines.join('\n');
};

const indexRebuildHuman = (data: Awaited<ReturnType<ApiClient['indexRebuild']>> extends Result<infer T, AppError> ? T : never): string =>
  `Reconciled ${data.reconciledFolders} folders, imported ${data.importedFiles} files`;

const tagsListHuman = (data: Awaited<ReturnType<ApiClient['listTags']>> extends Result<infer T, AppError> ? T : never): string =>
  data.tags.length === 0 ? 'No tags found' : data.tags.map((tag) => `${tag.name}\t${tag.count}`).join('\n');

const tagsAliasHuman = (data: Awaited<ReturnType<ApiClient['aliasTag']>> extends Result<infer T, AppError> ? T : never): string =>
  `Aliased ${data.alias} -> ${data.canonical}; remapped ${data.remappedFiles} files`;

const tagsSuggestAliasesHuman = (data: Awaited<ReturnType<ApiClient['suggestTagAliases']>> extends Result<infer T, AppError> ? T : never): string => {
  if (data.proposals.length === 0) return 'No alias proposals';
  const lines = data.proposals.map((proposal) =>
    `${proposal.from} (${proposal.fromCount}) -> ${proposal.to} (${proposal.toCount})\t${proposal.rule}`);
  lines.push(`${data.proposals.length} proposals. Apply one with: ai-video-cataloger tags alias <from> <to>`);
  return lines.join('\n');
};

const searchHuman = (data: Awaited<ReturnType<ApiClient['search']>> extends Result<infer T, AppError> ? T : never): string => {
  if (data.results.length === 0) return 'No results found';
  const rows = data.results.map((result) => {
    const offline = result.folder.online ? '' : ' [drive not connected]';
    return [
      `${result.folder.currentPath}/${result.fileName}${offline}`,
      result.finalName ?? result.fileName,
      result.capturedAt ?? '',
      result.place?.name ?? '',
      result.snippet.replace(/<\/?mark>/g, ''),
    ].join('\t');
  });
  return [...rows, `${data.count} of ${data.total} result(s)`].join('\n');
};

const variantNdjsonRow = (variant: VariantListItem) => ({
  configId: variant.configId,
  descriptor: variant.descriptor,
  selected: variant.selected,
  createdAt: variant.createdAt,
  analyzer: variant.analyzer,
  model: variant.model,
  ...(variant.estimatedCostUsd === null ? {} : { estimatedCostUsd: variant.estimatedCostUsd }),
});

const variantsListHuman = (data: VariantsListOutput): string => {
  if (data.variants.length === 0) return 'No analysis variants found';
  const rows = data.variants.map((variant) => [
    variant.selected ? '*' : '',
    variant.configId,
    variant.analyzer ?? '-',
    variant.model ?? '-',
    variant.createdAt,
    variant.estimatedCostUsd === null ? '-' : `$${variant.estimatedCostUsd.toFixed(4)}`,
  ].join('\t'));
  return [
    'SELECTED\tCONFIG\tANALYZER\tMODEL\tCREATED\tESTIMATED COST (USD)',
    ...rows,
  ].join('\n');
};

const warnIgnoredFolderConfig = (key: string, ignoredFolderValue: string | null): void => {
  if (ignoredFolderValue === null) return;
  emitWarning(`ignoring the folder override ${key}=${ignoredFolderValue}; this key is app-wide and resolves from ${cliHomeDirectory}`);
};

const configGetHuman = (data: Awaited<ReturnType<ApiClient['config']>> extends Result<infer T, AppError> ? T : never): string => {
  if ('key' in data) return `${data.key}=${data.effectiveValue}`;
  return CONFIG_KEYS.map((key) => `${key}=${data.effective[key]}`).join('\n');
};

const processHuman = (data: unknown): string => {
  if (isRecord(data) && typeof data.video === 'string') {
    const estimate = data.costEstimate;
    const cost = isRecord(estimate) && typeof estimate.estimatedCostUsd === 'number'
      ? `; estimated Gemini cost $${estimate.estimatedCostUsd.toFixed(4)} USD`
      : '';
    return `Completed ${data.video}${cost}`;
  }
  return 'Completed processing';
};

const processDriveHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Completed drive processing';
  const done = typeof data.filesDone === 'number' ? data.filesDone : 0;
  const skipped = typeof data.filesSkipped === 'number' ? data.filesSkipped : 0;
  const failed = typeof data.filesFailed === 'number' ? data.filesFailed : 0;
  const cost = isRecord(data.costEstimate) && typeof data.costEstimate.estimatedCostUsd === 'number'
    ? ` estimated-cost=$${data.costEstimate.estimatedCostUsd.toFixed(4)} USD`
    : '';
  const faces = driveFacesSummaryLine(data.faces);
  return `Drive run complete: done=${done} skipped=${skipped} failed=${failed}${cost}${faces === null ? '' : ` — ${faces}`}`;
};

const materializeHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Completed materialize';
  const materialized = typeof data.filesMaterialized === 'number' ? data.filesMaterialized : 0;
  const unchanged = typeof data.filesUnchanged === 'number' ? data.filesUnchanged : 0;
  const skipped = typeof data.filesSkipped === 'number' ? data.filesSkipped : 0;
  const failed = typeof data.filesFailed === 'number' ? data.filesFailed : 0;
  const foldersTotal = typeof data.foldersTotal === 'number' ? data.foldersTotal : 0;
  const elapsedS = typeof data.elapsedMs === 'number' ? (data.elapsedMs / 1000).toFixed(1) : '0.0';
  const lines = [
    `Materialized ${materialized} files, ${unchanged} already current, ${skipped} skipped, `
    + `${failed} failed across ${foldersTotal} folders in ${elapsedS}s`,
  ];
  const collisions = typeof data.collisions === 'number' ? data.collisions : 0;
  if (collisions > 0) lines.push(`Name collisions resolved with a numeric suffix: ${collisions}`);
  if (data.dryRun === true) lines.push('Dry run: nothing was written.');
  const foldersNotWritable = typeof data.foldersNotWritable === 'number' ? data.foldersNotWritable : 0;
  if (foldersNotWritable > 0) lines.push(`Folders still read-only: ${foldersNotWritable}`);
  return lines.join('\n');
};

const thumbnailsHuman = (data: unknown): string => {
  const parsed = thumbnailsSummarySchema.safeParse(data);
  if (!parsed.success) return 'Thumbnail generation complete';
  const { generated, fromFrame, fromSource, skipped, failed, filesScanned } = parsed.data;
  return `Thumbnails: generated=${generated} (frame=${fromFrame}, video=${fromSource}) skipped=${skipped} failed=${failed} over ${filesScanned} files`;
};

const gpsBackfillHuman = (data: unknown): string => {
  const parsed = gpsBackfillSummarySchema.safeParse(data);
  if (!parsed.success) return 'GPS backfill complete';
  const summary = parsed.data;
  const lines = [
    summary.dryRun ? 'GPS backfill (dry run):' : 'GPS backfill:',
    `Files considered: ${summary.filesConsidered} of ${summary.filesTotal} (camera-protected: ${summary.skipped.cameraGps}, manual-protected: ${summary.skipped.manualGps})`,
    `Matched: visit=${summary.matched.visit} activity=${summary.matched.activity} path=${summary.matched.path} unmatched=${summary.unmatched}`,
    `Accuracy median=${summary.accuracy.medianM ?? '-'}m p90=${summary.accuracy.p90M ?? '-'}m`,
    `Written: ${summary.written}, unchanged: ${summary.unchanged}`,
    `Skipped: offline=${summary.skipped.offline} noCapturedAt=${summary.skipped.noCapturedAt}`,
    `Places: resolved=${summary.places.resolved} unresolved=${summary.places.unresolved} skippedNoDataset=${summary.places.skippedNoDataset}`,
  ];
  if (summary.skewSuspicious > 0) lines.push(`Filename/capture-time skew flagged on ${summary.skewSuspicious} files`);
  return lines.join('\n');
};

const downloadedHuman = (data: unknown, model: string): string => {
  if (isRecord(data) && data.skipped === true) return `Model already downloaded: ${model}`;
  return `Downloaded ${model}`;
};

const installedHuman = (data: unknown, tag: string): string => {
  if (isRecord(data) && typeof data.tag === 'string') return `Installed ${data.tag}`;
  return `Installed ${tag}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const emitDriveEvent = (json: boolean, type: DriveEventStep, data: unknown): void => {
  if (!json) return;
  process.stdout.write(driveEventLine(type, data, new Date().toISOString()));
};

const startKeepAwake = (enabled: boolean): ChildProcess | null => {
  if (!enabled || process.platform !== 'darwin') return null;
  try {
    const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    child.on('error', () => undefined);
    return child;
  } catch {
    return null;
  }
};

const validateProcessPath = async (inputPath: string): Promise<
  | { ok: true; value: string }
  | { ok: false; error: AppError; data: { path: string; extension?: string; supportedExtensions?: readonly string[] } }
> => {
  const absolutePath = path.resolve(cliWorkingDirectory, inputPath);
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return {
      ok: false,
      error: appError('file_not_found', `File not found: ${absolutePath}`),
      data: { path: absolutePath },
    };
  }
  const extension = path.extname(absolutePath).toLowerCase();
  if (!VIDEO_EXTENSIONS.some((supported) => supported === extension)) {
    return {
      ok: false,
      error: appError('invalid_file_type', `Not a video file: ${absolutePath}`),
      data: { path: absolutePath, extension, supportedExtensions: VIDEO_EXTENSIONS },
    };
  }
  if (!fileStat.isFile()) {
    return {
      ok: false,
      error: appError('not_a_file', `Path is not a file: ${absolutePath}`),
      data: { path: absolutePath },
    };
  }
  return { ok: true, value: absolutePath };
};

const validateProcessRoot = async (inputPath: string): Promise<
  | { ok: true; value: string }
  | { ok: false; error: AppError; data: { path: string } }
> => {
  const absolutePath = path.resolve(cliWorkingDirectory, inputPath);
  let rootStat;
  try {
    rootStat = await stat(absolutePath);
  } catch {
    return {
      ok: false,
      error: appError('folder_not_found', `Root not found: ${absolutePath}`),
      data: { path: absolutePath },
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      ok: false,
      error: appError('not_a_directory', `Root is not a directory: ${absolutePath}`),
      data: { path: absolutePath },
    };
  }
  return { ok: true, value: absolutePath };
};

const confirmReset = async (message: string): Promise<boolean> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    prompt.close();
  }
};

const fatalExitCode = await runProgram(
  () => program.parseAsync(process.argv),
  () => app.dispose(),
  (message) => process.stderr.write(message),
);
if (fatalExitCode !== null) process.exitCode = fatalExitCode;
