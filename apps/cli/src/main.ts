import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

import { Command, InvalidArgumentError } from 'commander';

import { createApiClient, type ApiClient } from '@core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import {
  CONFIG_KEYS,
  HARNESS_REASONING_EFFORTS,
  WHISPER_MODEL_NAMES,
  apiCostSignal,
  analyzerProviderConfigSchema,
  estimateApiTokens,
  appError,
  configKeySchema,
  err,
  type AnalyzerProviderConfig,
  type AppError,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';
import { createApp } from '@server/src/create-app.js';
import packageJson from '../../../package.json' with { type: 'json' };

import {
  emitCompleted,
  emitError,
  emitProgress,
  emitRaw,
  emitStarted,
  isJsonMode,
} from './output.js';
import { waitForJob } from './job-wait.js';
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
  analyzer?: 'claude' | 'local' | 'api' | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
}

interface ProcessDriveOptions extends ProcessOptions {
  keepAwake?: boolean | undefined;
}

interface CliJobProgress {
  step: string;
  percentage?: number | undefined;
  current?: number | undefined;
  total?: number | undefined;
  data?: unknown;
}

const driveEventSteps = ['run-started', 'folder-started', 'folder-done', 'run-summary'] as const;

interface CredentialOptions extends JsonOption {
  env?: string | undefined;
}

interface SearchOptions extends JsonOption {
  limit: number;
}

const cliWorkingDirectory = process.env.AVC_WORKING_DIRECTORY ?? process.cwd();
const cliHomeDirectory = process.env.AVC_HOME_DIRECTORY ?? homedir();
const cliConfigFolder = path.resolve(cliWorkingDirectory) === path.resolve(cliHomeDirectory)
  ? undefined
  : cliWorkingDirectory;
const app = createApp({ workingDirectory: cliWorkingDirectory, homeDirectory: cliHomeDirectory, processName: 'cli' });
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

const waitForDriveJobAndEmit = async (json: boolean, jobId: string): Promise<void> => {
  await waitForJob(jobId, {
    fetchJob: (id) => api.job({ jobId: id }),
    onProgress: (progress) => {
      if (isDriveEventStep(progress.step)) {
        emitDriveEvent(json, progress.step, progress.data);
        return;
      }
      emitProgress(json, progressEvent(progress));
    },
    onCompleted: (data) => emitCompleted(json, data, processDriveHuman(data)),
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
    const prompter = options.yes === true || !process.stdin.isTTY ? undefined : createSetupPrompter();
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
  .option('--analyzer <backend>', 'analyzer backend')
  .option('--local-model <tag>', 'local AI model')
  .option('--force', 'reprocess even if the global index already has an analysis', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (videoPath: string, options: ProcessOptions, command: Command) => {
    const json = isJsonMode(options);
    const validatedPath = await validateProcessPath(videoPath);
    if (!validatedPath.ok) {
      emitError(json, validatedPath.error, validatedPath.data);
      return;
    }
    const explicit = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    const commandOptions = {
      frames: options.frames,
      skipRename: options.skipRename === true,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
    };
    emitStarted(json, 'process_single', { videoPath: validatedPath.value, options: commandOptions });
    await emitApiCostNotice(json, options.analyzer, options.frames);
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
      frames: options.frames,
      framesExplicit: explicit('frames'),
      skipRename: options.skipRename === true,
      skipRenameExplicit: explicit('skipRename'),
      verbose: options.verbose === true,
      timeout: options.timeout,
      timeoutExplicit: explicit('timeout'),
      whisper: options.whisper,
      whisperExplicit: explicit('whisper'),
      ...(whisperModel === undefined ? {} : { whisperModel }),
      whisperModelExplicit: explicit('whisperModel'),
      ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
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
  .option('--analyzer <backend>', 'analyzer backend')
  .option('--local-model <tag>', 'local AI model')
  .option('--force', 'reprocess even if the global index already has an analysis', false)
  .option('--keep-awake', 'keep macOS awake while the drive run is active', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (root: string, options: ProcessDriveOptions, command: Command) => {
    const json = isJsonMode(options);
    const validatedRoot = await validateProcessRoot(root);
    if (!validatedRoot.ok) {
      emitError(json, validatedRoot.error, validatedRoot.data);
      return;
    }
    const explicit = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    const commandOptions = {
      frames: options.frames,
      skipRename: options.skipRename === true,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
      force: options.force === true,
    };
    emitStarted(json, 'process_drive', { root: validatedRoot.value, options: commandOptions });
    await emitApiCostNotice(json, options.analyzer, options.frames);
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
        frames: options.frames,
        framesExplicit: explicit('frames'),
        skipRename: options.skipRename === true,
        skipRenameExplicit: explicit('skipRename'),
        verbose: options.verbose === true,
        timeout: options.timeout,
        timeoutExplicit: explicit('timeout'),
        whisper: options.whisper,
        whisperExplicit: explicit('whisper'),
        ...(whisperModel === undefined ? {} : { whisperModel }),
        whisperModelExplicit: explicit('whisperModel'),
        ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
        ...(options.localModel === undefined ? {} : { localModel: options.localModel }),
        ...(options.force === true ? { force: true } : {}),
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
    emitCompleted(json, result.value, `Set ${result.value.key}=${result.value.value}`);
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
    emitCompleted(json, result.value, `Stored credential for ${providerId}`);
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

program
  .command('search')
  .argument('<query>')
  .option('--limit <number>', 'maximum result count', numberOption, 50)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (query: string, options: SearchOptions) => {
    const json = isJsonMode(options);
    await runSimple(json, 'search', () => api.search({ query, limit: options.limit, offset: 0 }), searchHuman, { raw: true });
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
        ? `Forgot ${data.fingerprint}`
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
  if (!process.stdin.isTTY) return null;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('API credential: \u001B[8m');
    const credential = await readline.question('');
    process.stdout.write('\u001B[28m\n');
    return credential.trim();
  } finally {
    process.stdout.write('\u001B[28m');
    readline.close();
  }
};

const createSetupPrompter = (): SetupPrompter => {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  return {
    question: (message) => readline.question(message),
    secret: async (message) => {
      process.stderr.write(`${message}\u001B[8m`);
      try {
        return (await readline.question('')).trim();
      } finally {
        process.stderr.write('\u001B[28m\n');
      }
    },
    close: () => readline.close(),
  };
};

const emitApiCostNotice = async (
  json: boolean,
  explicitAnalyzer: ProcessOptions['analyzer'],
  frameCount: number,
): Promise<void> => {
  if (explicitAnalyzer !== undefined && explicitAnalyzer !== 'api') return;
  let provider: Extract<AnalyzerProviderConfig, { family: 'api' }> | null | undefined =
    explicitAnalyzer === 'api' ? null : undefined;
  const stored = await api.config({ folder: cliWorkingDirectory, key: 'analyzer_provider' });
  if (stored.ok && 'key' in stored.value && stored.value.value !== null) {
    try {
      const parsed = analyzerProviderConfigSchema.parse(JSON.parse(stored.value.value));
      if (parsed.family === 'api') provider = parsed;
    } catch {
      provider = undefined;
    }
  }
  if (explicitAnalyzer !== 'api' && provider === undefined) return;
  const selected = provider ?? {
    family: 'api',
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef: 'openai',
    model: 'gpt-4.1-mini',
    maxImageDetail: 'auto',
  } as const;
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
    .map((person) => `${person.personId} ${person.displayName ?? '(unnamed)'} - ${person.exemplarCount} exemplars`)
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
  return `Indexed ${indexed} files, added ${observations} observations, created ${people} people`;
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

const checkHuman = (data: Awaited<ReturnType<ApiClient['check']>> extends Result<infer T, AppError> ? T : never): string =>
  data.hasNestedDatabases ? `Nested databases found:\n${data.nestedPaths.join('\n')}` : 'No nested databases found';

const scanHuman = (data: Awaited<ReturnType<ApiClient['scan']>> extends Result<infer T, AppError> ? T : never): string =>
  `Found ${data.summary.total} video files`;

const indexStatusHuman = (data: Awaited<ReturnType<ApiClient['indexStatus']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = [
    `Database: ${data.databasePath}`,
    `Folders: ${data.counts.folders}`,
    `Files: ${data.counts.files}`,
    `Analyses: ${data.counts.analyses}`,
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

const searchHuman = (data: Awaited<ReturnType<ApiClient['search']>> extends Result<infer T, AppError> ? T : never): string => {
  if (data.results.length === 0) return 'No results found';
  const rows = data.results.map((result) => {
    const offline = result.folder.online ? '' : ' [drive not connected]';
    return [
      `${result.folder.currentPath}/${result.fileName}${offline}`,
      result.finalName ?? result.fileName,
      result.snippet.replace(/<\/?mark>/g, ''),
    ].join('\t');
  });
  return [...rows, `${data.count} result(s)`].join('\n');
};

const doctorHuman = (
  data: Awaited<ReturnType<ApiClient['doctor']>> extends Result<infer T, AppError> ? T : never,
  live: Awaited<ReturnType<ApiClient['healthLive']>>,
  ready: Awaited<ReturnType<ApiClient['healthReady']>>,
): string => {
  const lines = data.dependencies.map((dependency) => `${dependency.name}: ${dependency.available ? 'available' : 'missing'}`);
  lines.push(`All available: ${data.allAvailable ? 'yes' : 'no'}`);
  for (const warning of data.warnings) lines.push(`Warning: ${warning.message}`);
  lines.push(`Liveness: ${live.ok ? `up v${live.value.version}` : `unavailable (${live.error.message})`}`);
  if (ready.ok) {
    lines.push('Readiness: ready');
    for (const check of ready.value.checks) lines.push(`  ${check.name}: ${check.ok ? 'ok' : 'not ready'} - ${check.detail}`);
  } else {
    lines.push(`Readiness: not ready (${ready.error.message})`);
  }
  lines.push('Configured processing:');
  lines.push(`Analyzer (${data.configured.analyzer.providerId}): ${data.configured.analyzer.available ? 'available' : 'missing'}`);
  lines.push(`Transcriber (${data.configured.transcriber.mode}): ${data.configured.transcriber.available ? 'available' : 'missing'}`);
  if (data.configured.suggestedAction !== null) lines.push(data.configured.suggestedAction);
  return lines.join('\n');
};

const configGetHuman = (data: Awaited<ReturnType<ApiClient['config']>> extends Result<infer T, AppError> ? T : never): string => {
  if ('key' in data) return `${data.key}=${data.effectiveValue}`;
  return CONFIG_KEYS.map((key) => `${key}=${data.effective[key]}`).join('\n');
};

const processHuman = (data: unknown): string => {
  if (isRecord(data) && typeof data.video === 'string') return `Completed ${data.video}`;
  return 'Completed processing';
};

const processDriveHuman = (data: unknown): string => {
  if (!isRecord(data)) return 'Completed drive processing';
  const done = typeof data.filesDone === 'number' ? data.filesDone : 0;
  const skipped = typeof data.filesSkipped === 'number' ? data.filesSkipped : 0;
  const failed = typeof data.filesFailed === 'number' ? data.filesFailed : 0;
  return `Drive run complete: done=${done} skipped=${skipped} failed=${failed}`;
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

const isDriveEventStep = (step: string): step is (typeof driveEventSteps)[number] =>
  driveEventSteps.some((candidate) => candidate === step);

const emitDriveEvent = (json: boolean, type: (typeof driveEventSteps)[number], data: unknown): void => {
  if (!json) return;
  const payload = isRecord(data) ? data : {};
  process.stdout.write(`${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`);
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
