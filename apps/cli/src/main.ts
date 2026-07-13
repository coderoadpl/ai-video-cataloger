import path from 'node:path';

import { Command } from 'commander';

import { createApiClient, type ApiClient } from '@core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import {
  WHISPER_MODEL_NAMES,
  appError,
  err,
  type AppError,
  type ConfigKey,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';
import { createApp } from '@server/src/create-app.js';

import {
  emitCompleted,
  emitError,
  emitProgress,
  emitRaw,
  emitStarted,
  isJsonMode,
} from './output.js';

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
  analyzer?: 'claude' | 'local' | undefined;
  localModel?: string | undefined;
}

interface CliJobProgress {
  step: string;
  percentage?: number | undefined;
  current?: number | undefined;
  total?: number | undefined;
  data?: unknown;
}

const cliWorkingDirectory = process.env.AVC_WORKING_DIRECTORY ?? process.cwd();
const app = createApp({ workingDirectory: cliWorkingDirectory });
const api = createApiClient({
  baseUrl: '',
  fetchImpl: async (input, init) => app.honoApp.request(input, init),
});

const program = new Command('ai-video-cataloger')
  .description('CLI for video analysis, local Whisper transcription, Claude/local analysis, content-based renaming')
  .version('0.1.0');

const numberOption = (value: string): number => Number.parseInt(value, 10);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const CONFIG_KEYS: readonly ConfigKey[] = [
  'whisper_model',
  'whisper_mode',
  'frames',
  'timeout',
  'skip_rename',
  'analyzer_backend',
  'local_model',
];

const parseWhisperModel = (modelName: string): Result<WhisperModelName, AppError> => {
  for (const model of WHISPER_MODEL_NAMES) {
    if (modelName === model) return { ok: true, value: model };
  }
  return err(appError('invalid_model', `Invalid model: ${modelName}`));
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

const waitForJob = async (
  json: boolean,
  jobId: string,
  completedHuman: (data: unknown) => string,
): Promise<void> => {
  let previousProgressKey = '';
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const job = await api.job({ jobId });
    if (!job.ok) {
      emitError(json, job.error);
      return;
    }
    const progress = job.value.progress;
    if (progress !== null) {
      const progressKey = JSON.stringify(progress);
      if (progressKey !== previousProgressKey) {
        previousProgressKey = progressKey;
        emitProgress(json, progressEvent(progress));
      }
    }
    if (job.value.status === 'completed') {
      emitCompleted(json, job.value.result, completedHuman(job.value.result));
      return;
    }
    if (job.value.status === 'failed') {
      emitError(json, job.value.error ?? appError('internal', 'Job failed without an error'));
      return;
    }
    if (job.value.status === 'cancelled') {
      emitError(json, appError('processing_error', 'Job cancelled'));
      return;
    }
    await sleep(25);
  }
  emitError(json, appError('internal', `Timed out waiting for job: ${jobId}`));
};

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

models
  .command('list')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'models_list', () => api.modelsWhisper(), modelsListHuman, { raw: true });
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
    await waitForJob(json, result.value.jobId, (data) => installedHuman(data, tag));
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
    await waitForJob(json, result.value.jobId, (data) => downloadedHuman(data, model.value));
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

program
  .command('status')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(json, 'status', () => api.status(), statusHuman, { raw: true });
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
      const result = await api.resetAll({ force });
      if (!result.ok) {
        emitError(json, result.error);
        return;
      }
      emitRaw(json, result.value, '');
      emitCompleted(json, result.value, resetHuman(result.value));
      return;
    }
    emitStarted(json, 'reset_single', { filename });
    const result = await api.resetSingle({ filename, force });
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
  .option('-w, --whisper <mode>', 'whisper mode', 'local')
  .option('--whisper-model <model>', 'whisper model', 'base')
  .option('--analyzer <backend>', 'analyzer backend')
  .option('--local-model <tag>', 'local AI model')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (videoPath: string, options: ProcessOptions) => {
    const json = isJsonMode(options);
    const commandOptions = {
      frames: options.frames,
      skipRename: options.skipRename === true,
      verbose: options.verbose === true,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
      analyzer: options.analyzer ?? null,
      localModel: options.localModel ?? null,
    };
    emitStarted(json, 'process_single', { videoPath: path.resolve(videoPath), options: commandOptions });
    let whisperModel: WhisperModelName | undefined;
    if (options.whisper === 'local') {
      const model = parseWhisperModel(options.whisperModel);
      if (!model.ok) {
        emitError(json, model.error);
        return;
      }
      whisperModel = model.value;
    }
    if (options.whisper === 'api' && (process.env.OPENAI_API_KEY ?? '').length === 0) {
      emitError(json, appError('missing_api_key', 'OPENAI_API_KEY environment variable is required when using OpenAI Whisper API'));
      return;
    }
    const result = await api.processVideo({
      videoPath,
      frames: options.frames,
      skipRename: options.skipRename === true,
      verbose: options.verbose === true,
      timeout: options.timeout,
      whisper: options.whisper,
      ...(whisperModel === undefined ? {} : { whisperModel }),
      ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
      ...(options.localModel === undefined ? {} : { localModel: options.localModel }),
    });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    await waitForJob(json, result.value.jobId, (data) => processHuman(data));
  });

program
  .command('thumbnail')
  .argument('<video-path>')
  .option('--force', 'regenerate thumbnail', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (videoPath: string, options: ForceJsonOption) => {
    const json = isJsonMode(options);
    emitStarted(json, 'thumbnail', { videoPath: path.resolve(videoPath), force: options.force === true });
    const result = await api.generateThumbnail({ videoPath, force: options.force === true });
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
    const result = await api.config({ key: parsedKey });
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
    const result = await api.setConfig({ key: parsedKey, value });
    if (!result.ok) {
      emitError(json, result.error);
      return;
    }
    emitCompleted(json, result.value, `Set ${result.value.key}=${result.value.value}`);
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
  .command('doctor')
  .option('--json', 'machine-readable JSON output', false)
  .action(async (options: JsonOption) => {
    const json = isJsonMode(options);
    await runSimple(
      json,
      'doctor',
      () => api.doctor(),
      doctorHuman,
      {
        exitOnData: (data) => data.allAvailable ? null : EXIT_CODE_BY_ERROR_CODE.prerequisites_failed,
      },
    );
  });

const configKey = (key: string | undefined) => {
  if (key === undefined) return null;
  if (
    key === 'whisper_model' ||
    key === 'whisper_mode' ||
    key === 'frames' ||
    key === 'timeout' ||
    key === 'skip_rename' ||
    key === 'analyzer_backend' ||
    key === 'local_model'
  ) {
    return key;
  }
  return null;
};

const modelsListHuman = (data: Awaited<ReturnType<ApiClient['modelsWhisper']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = ['Whisper models:'];
  for (const model of data.models) {
    lines.push(`${model.active ? '*' : ' '} ${model.name} ${model.size} ${model.downloaded ? 'downloaded' : 'not downloaded'}`);
  }
  lines.push('', 'Local AI models: run `models requirements` for hardware tiers');
  return lines.join('\n');
};

const requirementsHuman = (data: Awaited<ReturnType<ApiClient['localAiRequirements']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = [`Your machine: ${data.machine.platform}/${data.machine.arch}, ${data.machine.totalMemGB}GB RAM`];
  lines.push(`Runtime: ${data.runtimeUp ? 'running' : 'stopped'} ${data.runtimeVersion}`);
  for (const tier of data.tiers) {
    lines.push(`${tier.tag} ${tier.label} ${tier.supportLevel}${tier.installed ? ' installed' : ''}`);
  }
  return lines.join('\n');
};

const statusHuman = (data: Awaited<ReturnType<ApiClient['status']>> extends Result<infer T, AppError> ? T : never): string =>
  `Completed: ${data.summary.completed}\nIn Progress: ${data.summary.inProgress}\nPending: ${data.summary.pending}\nError: ${data.summary.error}`;

const resetHuman = (data: Awaited<ReturnType<ApiClient['resetAll']>> extends Result<infer T, AppError> ? T : never): string =>
  `Cleared ${data.cleared} video records`;

const checkHuman = (data: Awaited<ReturnType<ApiClient['check']>> extends Result<infer T, AppError> ? T : never): string =>
  data.hasNestedDatabases ? `Nested databases found:\n${data.nestedPaths.join('\n')}` : 'No nested databases found';

const scanHuman = (data: Awaited<ReturnType<ApiClient['scan']>> extends Result<infer T, AppError> ? T : never): string =>
  `Found ${data.summary.total} video files`;

const doctorHuman = (data: Awaited<ReturnType<ApiClient['doctor']>> extends Result<infer T, AppError> ? T : never): string => {
  const lines = data.dependencies.map((dependency) => `${dependency.name}: ${dependency.available ? 'available' : 'missing'}`);
  lines.push(`All available: ${data.allAvailable ? 'yes' : 'no'}`);
  return lines.join('\n');
};

const configGetHuman = (data: Awaited<ReturnType<ApiClient['config']>> extends Result<infer T, AppError> ? T : never): string => {
  if ('key' in data) return `${data.key}=${data.value ?? data.defaultValue}`;
  return CONFIG_KEYS.map((key) => `${key}=${data.config[key] ?? data.defaults[key]}`).join('\n');
};

const processHuman = (data: unknown): string => {
  if (isRecord(data) && typeof data.video === 'string') return `Completed ${data.video}`;
  return 'Completed processing';
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

try {
  await program.parseAsync(process.argv);
} finally {
  await app.dispose();
}
