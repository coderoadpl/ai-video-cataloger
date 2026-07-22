import {
  ANALYZER_PROVIDERS,
  WHISPER_MODES,
  CONFIG_DEFAULTS,
  appError,
  normalizeTagList,
  ok,
  type AppConfig,
  type AppError,
  type AnalyzerProviderConfig,
  type Result,
  type Video,
  type WhisperModelName,
} from '@core/domain/index.js';
import { analyzerBackendSchema, configValueSchema } from '@core/domain/config.js';
import { whisperModelNameSchema } from '@core/domain/models.js';
import { analyzerProviderConfigSchema, legacyAnalyzerProvider } from '@core/domain/providers.js';
import { z } from 'zod';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AnalyzerPort,
  type CatalogRepository,
  type CatalogRepositoryFactory,
  type ConfigStore,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobProgress,
  type MediaPort,
  type TranscriberPort,
} from '../ports.js';
import {
  artifactPaths,
  isSupportedVideoExtension,
  summaryDataSchema,
  type SummaryData,
} from './shared.js';
import { resolveConfigValues } from './config-resolution.js';
import { hasProcessedAnalysis, resolveFolderIntoIndex, upsertProcessedVideo } from './catalog-index.js';

const TOTAL_STEPS = 5;
const DEFAULT_LOCAL_TIMEOUT_SECONDS = 300;

export interface ProcessDeps {
  catalogs: CatalogRepositoryFactory;
  config: ConfigStore;
  fs: FileSystemPort;
  media: MediaPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
  globalCatalog?: GlobalCatalogStore | undefined;
}

export interface ProcessPipelineInput {
  videoPath: string;
  frames: number;
  framesExplicit?: boolean | undefined;
  skipRename: boolean;
  skipRenameExplicit?: boolean | undefined;
  verbose: boolean;
  timeout: number;
  timeoutExplicit?: boolean | undefined;
  whisper: AppConfig['whisper_mode'];
  whisperExplicit?: boolean | undefined;
  whisperModel: WhisperModelName;
  whisperModelExplicit?: boolean | undefined;
  analyzer?: AppConfig['analyzer_backend'] | 'api' | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
  batch?: ProcessBatchContext | undefined;
}

export interface ProcessCompletedOutput {
  video: string;
  path: string;
  status: 'completed';
}

export interface ParsedAnalysis {
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
  tags: string[];
}

type ResumeStage = 'frames' | 'audio' | 'transcribe' | 'analyze' | 'rename' | 'done';

interface ProcessBatchContext {
  current: number;
  total: number;
}

export const processVideoPipeline = async (
  deps: ProcessDeps,
  input: ProcessPipelineInput,
  progress?: JobExecutionContext,
): Promise<Result<ProcessCompletedOutput, AppError>> => {
  const notCancelled = cancellationBoundary(progress);
  if (!notCancelled.ok) return notCancelled;
  const validation = await validateVideoPath(deps.fs, input.videoPath);
  if (!validation.ok) return validation;
  const videoPath = validation.value;
  const folder = deps.fs.dirname(videoPath);
  const repository = await deps.catalogs.open(folder);
  if (!repository.ok) return repository;

  const video = await findOrCreateVideo(deps, repository.value, videoPath);
  if (!video.ok) return video;

  const skipped = await alreadyIndexed(deps, folder, videoPath, input.force === true);
  if (!skipped.ok) return skipped;
  if (skipped.value) return ok(completedOutput(deps.fs, video.value));

  const resolved = await resolveProcessOptions(deps.config, folder, input);
  if (!resolved.ok) return resolved;

  const runResult = await runPipelineSteps(deps, repository.value, video.value, resolved.value, progress);
  if (!runResult.ok) {
    if (!isJobCancelled(runResult.error) && !preservesCatalog(runResult.error)) {
      await repository.value.updateVideoStatus(video.value.id, 'error', runResult.error.message);
    }
    return runResult;
  }

  const recorded = await recordGlobalCatalog(deps, repository.value, resolved.value, runResult.value, progress);
  if (!recorded.ok) return recorded;
  return runResult;
};

export const checkProcessPrerequisites = async (
  deps: ProcessDeps,
  input: ProcessPipelineInput,
): Promise<Result<void, AppError>> => {
  const validation = await validateVideoPath(deps.fs, input.videoPath);
  if (!validation.ok) return validation;
  const folder = deps.fs.dirname(validation.value);
  const resolved = await resolveProcessOptions(deps.config, folder, input);
  if (!resolved.ok) return resolved;

  const media = await deps.media.dependencies();
  if (!media.ok) return prerequisitesFailure(media.error.message, media.error);
  const required = [...media.value];
  if (resolved.value.whisper === 'local') {
    const transcriber = await deps.transcriber.dependency({
      mode: resolved.value.whisper,
      model: resolved.value.whisperModel,
      apiBaseUrl: resolved.value.whisperApiBaseUrl,
      apiModel: resolved.value.whisperApiModel,
      binaryPath: resolved.value.whisperBinaryPath,
    });
    if (!transcriber.ok) return prerequisitesFailure(transcriber.error.message, transcriber.error);
    required.push(transcriber.value);
  } else if (resolved.value.whisper === 'api') {
    const transcriber = await deps.transcriber.dependency({
      mode: resolved.value.whisper,
      model: resolved.value.whisperModel,
      apiBaseUrl: resolved.value.whisperApiBaseUrl,
      apiModel: resolved.value.whisperApiModel,
      binaryPath: resolved.value.whisperBinaryPath,
    });
    if (!transcriber.ok) return prerequisitesFailure(transcriber.error.message, transcriber.error);
    if (!transcriber.value.available) {
      return {
        ok: false,
        error: appError('missing_api_key', 'OPENAI_API_KEY environment variable is required when using OpenAI Whisper API'),
      };
    }
    required.push(transcriber.value);
  }
  const analyzer = await deps.analyzer.dependency({
    backend: resolved.value.analyzer.backend,
    provider: resolved.value.analyzer.provider,
  });
  if (!analyzer.ok) return prerequisitesFailure(analyzer.error.message, analyzer.error);
  if (
    resolved.value.analyzer.provider.family === 'local'
    && !analyzer.value.available
    && analyzer.value.name === resolved.value.analyzer.provider.modelTag
  ) {
    return {
      ok: false,
      error: appError(
        'model_not_installed',
        `Local AI model "${resolved.value.analyzer.provider.modelTag}" is not installed. Run: ai-video-cataloger models pull ${resolved.value.analyzer.provider.modelTag}`,
      ),
    };
  }
  required.push(analyzer.value);
  const missing = required.filter((entry) => !entry.available).map((entry) => entry.name);
  if (missing.length > 0) {
    return prerequisitesFailure(
      `Missing prerequisite: ${missing.join(', ')}. Run: ai-video-cataloger setup`,
      { missing },
    );
  }
  return ok(undefined);
};

export const parseAnalysisResponse = (response: string): Result<ParsedAnalysis, AppError> => {
  const lines = response.trim().split('\n');
  let description = '';
  let suggestedFilename = '';
  let tags: string[] = [];
  let capturingDescription = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('DESCRIPTION:')) {
      description = trimmed.slice('DESCRIPTION:'.length).trim();
      capturingDescription = true;
    } else if (upper.startsWith('FILENAME:')) {
      suggestedFilename = normalizeKebabSlug(trimmed.slice('FILENAME:'.length));
      capturingDescription = false;
    } else if (upper.startsWith('TAGS:')) {
      tags = parseTagsLine(trimmed.slice('TAGS:'.length));
      capturingDescription = false;
    } else if (capturingDescription && trimmed.length > 0 && !upper.startsWith('FILENAME') && !upper.startsWith('TAGS')) {
      description = `${description} ${trimmed}`.trim();
    }
  }

  if (suggestedFilename.length === 0) {
    return {
      ok: false,
      error: appError('analysis_parse_failed', 'Failed to parse analysis response: no FILENAME line found'),
    };
  }

  return ok({
    description: description.length === 0 ? response.trim().slice(0, 500) : description.trim(),
    suggestedFilename,
    fullAnalysis: response,
    tags,
  });
};

export const parseTagsLine = (value: string): string[] => {
  const hasSeparators = value.includes(',') || value.includes(';');
  return normalizeTagList(hasSeparators ? value.split(/[;,]/) : value.split(/\s+/));
};

export const normalizeKebabSlug = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length === 0 ? 'video' : slug;
};

const validateVideoPath = async (fs: FileSystemPort, inputPath: string): Promise<Result<string, AppError>> => {
  const videoPath = fs.resolve(inputPath);
  const exists = await fs.exists(videoPath);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('file_not_found', `File not found: ${videoPath}`) };
  if (!isSupportedVideoExtension(fs.extname(videoPath))) {
    return { ok: false, error: appError('invalid_file_type', `Unsupported video file type: ${videoPath}`) };
  }
  const file = await fs.isFile(videoPath);
  if (!file.ok) return file;
  if (!file.value) return { ok: false, error: appError('not_a_file', `Not a file: ${videoPath}`) };
  return ok(videoPath);
};

const findOrCreateVideo = async (
  deps: ProcessDeps,
  repository: CatalogRepository,
  videoPath: string,
): Promise<Result<Video, AppError>> => {
  const existing = await repository.findVideoByPath(videoPath);
  if (!existing.ok) return existing;
  if (existing.value !== null) return ok(existing.value);

  const hash = await deps.fs.partialContentHash(videoPath);
  if (!hash.ok) return hash;
  if (hash.value !== null) {
    const byHash = await repository.findVideoByHash(hash.value);
    if (!byHash.ok) return byHash;
    if (byHash.value !== null) return repository.updateVideoPath(byHash.value.id, videoPath);
  }

  const stat = await deps.fs.stat(videoPath);
  if (!stat.ok) return stat;
  const now = new Date().toISOString();
  return repository.createVideo({
    originalPath: videoPath,
    originalName: deps.fs.basename(videoPath),
    newName: null,
    fileHash: hash.value ?? `${stat.value.size}:${stat.value.mtimeMs}:${deps.fs.basename(videoPath)}`,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    errorMessage: null,
  });
};

const runPipelineSteps = async (
  deps: ProcessDeps,
  repository: CatalogRepository,
  initialVideo: Video,
  resolved: ResolvedProcessOptions,
  progress?: JobExecutionContext,
): Promise<Result<ProcessCompletedOutput, AppError>> => {
  let video = initialVideo;
  let stage = await resumeStage(deps, video, resolved.frames);
  if (!stage.ok) return stage;
  if (stage.value === 'done') return ok(completedOutput(deps.fs, video));

  const paths = artifactPaths(deps.fs, deps.fs.dirname(video.originalPath), video.originalPath, video.newName);
  let currentFramePaths: string[] | null = null;

  if (stage.value === 'frames') {
    const progressResult = await report(progress, 'extracting_frames', 1, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const frames = await deps.media.extractFrames({
      videoPath: video.originalPath,
      outputDirectory: paths.framesDir,
      frameCount: resolved.frames,
      signal: progress?.signal,
    });
    const notCancelled = cancellationBoundary(progress);
    if (!notCancelled.ok) return notCancelled;
    if (!frames.ok) return frames;
    currentFramePaths = frames.value.framePaths;
    const updated = await repository.updateVideoStatus(video.id, 'frames_extracted', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('audio');
  }

  const transcriptBeforeAudio = await readTranscript(deps.fs, paths.transcriptPath);
  if (!transcriptBeforeAudio.ok) return transcriptBeforeAudio;
  if ((stage.value === 'audio' || stage.value === 'transcribe') && transcriptBeforeAudio.value !== null) {
    const updated = await repository.updateVideoStatus(video.id, 'transcribed', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('analyze');
  }

  let audioPath: string | null = null;
  let skipTranscription = resolved.whisper === 'skip';
  if (stage.value === 'audio' && resolved.whisper === 'skip') {
    const progressResult = await report(progress, 'extracting_audio', 2, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const updated = await repository.updateVideoStatus(video.id, 'audio_extracted', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('transcribe');
  }

  if (stage.value === 'audio') {
    const progressResult = await report(progress, 'extracting_audio', 2, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const extracted = await deps.media.extractAudio({
      videoPath: video.originalPath,
      outputPath: tempAudioPath(deps.fs, video.originalPath),
      signal: progress?.signal,
    });
    const notCancelled = cancellationBoundary(progress);
    if (!notCancelled.ok) return notCancelled;
    if (!extracted.ok) return extracted;
    audioPath = extracted.value.audioPath;
    skipTranscription = !extracted.value.hasAudio;
    const updated = await repository.updateVideoStatus(video.id, 'audio_extracted', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('transcribe');
  }

  if (stage.value === 'transcribe') {
    const progressResult = await report(progress, 'transcribing_audio', 3, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const transcript = await transcribe(
      deps,
      video.originalPath,
      resolved,
      paths.transcriptPath,
      audioPath,
      skipTranscription,
      progress?.signal,
    );
    const notCancelled = cancellationBoundary(progress);
    if (!notCancelled.ok) return notCancelled;
    if (!transcript.ok) return transcript;
    const updated = await repository.updateVideoStatus(video.id, 'transcribed', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('analyze');
  }

  let parsed: ParsedAnalysis | null = null;
  if (stage.value === 'analyze') {
    const progressResult = await report(progress, 'analyzing_with_claude', 4, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const frames = currentFramePaths === null ? await existingFrames(deps.fs, paths.framesDir) : ok(currentFramePaths);
    if (!frames.ok) return frames;
    if (frames.value.length === 0) {
      return { ok: false, error: appError('processing_error', 'No frames found for analysis') };
    }
    const transcript = await readTranscript(deps.fs, paths.transcriptPath);
    if (!transcript.ok) return transcript;
    const analyzed = await deps.analyzer.analyze({
      videoPath: video.originalPath,
      framePaths: frames.value,
      transcript: transcript.value,
      backend: resolved.analyzer.backend,
      localModel: resolved.analyzer.localModel,
      provider: resolved.analyzer.provider,
      timeoutSeconds: resolved.analyzer.timeoutSeconds,
      verbose: resolved.verbose,
      signal: progress?.signal,
    });
    const notCancelled = cancellationBoundary(progress);
    if (!notCancelled.ok) return notCancelled;
    if (!analyzed.ok) return analyzed;
    const debug = await writeDebugLog(deps.fs, paths.debugLogPath, {
      video,
      framePaths: frames.value,
      rawResponse: analyzed.value.rawResponse,
      provider: resolved.analyzer.provider,
    });
    if (!debug.ok) return debug;
    const afterDebug = cancellationBoundary(progress);
    if (!afterDebug.ok) return afterDebug;
    const parsedResult = parseAnalysisResponse(analyzed.value.rawResponse);
    if (!parsedResult.ok) return parsedResult;
    parsed = parsedResult.value;
    const summary = await writeSummary(deps.fs, video.originalPath, paths.summaryJsonPath, paths.summaryPath, {
      schemaVersion: 1,
      description: parsed.description,
      suggestedFilename: parsed.suggestedFilename,
      fullAnalysis: parsed.fullAnalysis,
      tags: parsed.tags,
      analyzedAt: new Date().toISOString(),
    });
    if (!summary.ok) return summary;
    const afterSummary = cancellationBoundary(progress);
    if (!afterSummary.ok) return afterSummary;
    const updated = await repository.updateVideoStatus(video.id, 'analyzed', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('rename');
  }

  if (stage.value === 'rename') {
    if (resolved.skipRename) {
      const progressResult = await report(progress, 'skipping_rename', 5, video.originalPath, resolved.batch);
      if (!progressResult.ok) return progressResult;
      const updated = await repository.updateVideoStatus(video.id, 'completed', null);
      if (!updated.ok) return updated;
      return ok(completedOutput(deps.fs, updated.value));
    }
    const progressResult = await report(progress, 'renaming_video', 5, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const summary = parsed === null ? await loadSummary(deps.fs, paths.summaryJsonPath) : ok(parsed);
    if (!summary.ok) return summary;
    const renamed = await renameVideoAndArtifacts(deps.fs, video, summary.value.suggestedFilename, progress?.signal);
    if (!renamed.ok) return renamed;
    const moved = await repository.updateVideoPath(video.id, renamed.value.newPath);
    if (!moved.ok) return moved;
    const named = await repository.updateVideoNewName(moved.value.id, renamed.value.newName);
    if (!named.ok) return named;
    const completed = await repository.updateVideoStatus(video.id, 'completed', null);
    if (!completed.ok) return completed;
    return ok({ video: deps.fs.basename(renamed.value.newPath), path: renamed.value.newPath, status: 'completed' });
  }

  return ok(completedOutput(deps.fs, video));
};

interface ResolvedAnalyzer {
  backend: AppConfig['analyzer_backend'];
  localModel: string;
  timeoutSeconds: number;
  provider: AnalyzerProviderConfig;
}

interface ResolvedProcessOptions {
  frames: number;
  skipRename: boolean;
  verbose: boolean;
  whisper: AppConfig['whisper_mode'];
  whisperModel: WhisperModelName;
  whisperBinaryPath: string;
  whisperApiBaseUrl: string;
  whisperApiModel: string;
  analyzer: ResolvedAnalyzer;
  batch: ProcessBatchContext;
}

const resolveProcessOptions = async (
  config: ConfigStore,
  folder: string,
  input: ProcessPipelineInput,
): Promise<Result<ResolvedProcessOptions, AppError>> => {
  const stored = await resolveConfigValues(config, folder);
  if (!stored.ok) return stored;
  const effective = stored.value.effective;
  const frames = input.framesExplicit === true ? input.frames : storedFrames(effective.frames) ?? CONFIG_DEFAULTS.frames;
  const skipRename =
    input.skipRenameExplicit === true ? input.skipRename : storedSkipRename(effective.skip_rename) ?? CONFIG_DEFAULTS.skip_rename;
  const whisper = input.whisperExplicit === true ? input.whisper : storedWhisperMode(effective.whisper_mode) ?? CONFIG_DEFAULTS.whisper_mode;
  const whisperModel =
    input.whisperModelExplicit === true
      ? input.whisperModel
      : storedWhisperModel(effective.whisper_model) ?? CONFIG_DEFAULTS.whisper_model;
  const whisperBinaryPath = effective.whisper_binary_path;
  const whisperApiBaseUrl = effective.whisper_api_base_url;
  const whisperApiModel = effective.whisper_api_model;
  const localModel = trimmedValue(input.localModel) ?? trimmedValue(effective.local_model) ?? CONFIG_DEFAULTS.local_model;
  const persistedProvider = storedAnalyzerProvider(effective.analyzer_provider);
  const legacyBackend = storedAnalyzerBackend(effective.analyzer_backend) ?? CONFIG_DEFAULTS.analyzer_backend;
  const selectedProvider = resolveAnalyzerProvider(input.analyzer, persistedProvider, legacyBackend, localModel);
  const provider = resolvedLocalProvider(selectedProvider, localModel, input.localModel);
  const backend = provider.family === 'local' ? 'local' : 'claude';
  const storedTimeout = stored.value.sources.timeout === 'default' ? null : storedTimeoutValue(effective.timeout);
  const timeoutSeconds =
    input.timeoutExplicit === true
      ? input.timeout
      : storedTimeout ?? (backend === 'local' ? DEFAULT_LOCAL_TIMEOUT_SECONDS : input.timeout);
  return ok({
    frames,
    skipRename,
    verbose: input.verbose,
    whisper,
    whisperModel,
    whisperBinaryPath,
    whisperApiBaseUrl,
    whisperApiModel,
    analyzer: {
      backend,
      localModel: provider.family === 'local' ? provider.modelTag : localModel,
      timeoutSeconds,
      provider,
    },
    batch: input.batch ?? { current: 1, total: 1 },
  });
};

const resolvedLocalProvider = (
  provider: AnalyzerProviderConfig,
  localModel: string,
  explicitLocalModel: string | undefined,
): AnalyzerProviderConfig => {
  if (provider.family !== 'local') return provider;
  return trimmedValue(explicitLocalModel) === null ? provider : { ...provider, modelTag: localModel };
};

const storedAnalyzerProvider = (value: string | undefined): AnalyzerProviderConfig | null => {
  if (value === undefined) return null;
  try {
    return analyzerProviderConfigSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
};

const resolveAnalyzerProvider = (
  explicit: ProcessPipelineInput['analyzer'],
  persisted: AnalyzerProviderConfig | null,
  legacyBackend: AppConfig['analyzer_backend'],
  localModel: string,
): AnalyzerProviderConfig => {
  if (explicit === undefined) return persisted ?? legacyAnalyzerProvider(legacyBackend, localModel);
  if (explicit === 'local') return legacyAnalyzerProvider('local', localModel);
  if (explicit === 'claude') return legacyAnalyzerProvider('claude', localModel);
  if (persisted?.family === 'api') return persisted;
  const descriptor = ANALYZER_PROVIDERS.find((candidate) => candidate.family === 'api');
  if (descriptor !== undefined && descriptor.family === 'api') {
    return { ...descriptor, apiKeyRef: descriptor.providerId };
  }
  return {
    family: 'api',
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef: 'openai',
    model: 'gpt-4.1-mini',
    maxImageDetail: 'auto',
  };
};

const storedAnalyzerBackend = (value: string | undefined): AppConfig['analyzer_backend'] | null => {
  if (value === undefined) return null;
  try {
    return analyzerBackendSchema.parse(value);
  } catch {
    return null;
  }
};

const storedTimeoutValue = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  try {
    return configValueSchema.shape.timeout.parse(value);
  } catch {
    return null;
  }
};

const storedFrames = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  try {
    return configValueSchema.shape.frames.parse(value);
  } catch {
    return null;
  }
};

const storedSkipRename = (value: string | undefined): boolean | null => {
  if (value === undefined) return null;
  try {
    return configValueSchema.shape.skip_rename.parse(value);
  } catch {
    return null;
  }
};

const storedWhisperMode = (value: string | undefined): AppConfig['whisper_mode'] | null => {
  if (value === undefined) return null;
  try {
    return z.enum(WHISPER_MODES).parse(value);
  } catch {
    return null;
  }
};

const storedWhisperModel = (value: string | undefined): WhisperModelName | null => {
  if (value === undefined) return null;
  try {
    return whisperModelNameSchema.parse(value);
  } catch {
    return null;
  }
};

const trimmedValue = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const resumeStage = async (
  deps: ProcessDeps,
  video: Video,
  requestedFrames: number,
): Promise<Result<ResumeStage, AppError>> => {
  if (video.status === 'completed') return ok('done');
  const paths = artifactPaths(deps.fs, deps.fs.dirname(video.originalPath), video.originalPath, video.newName);
  if (video.status === 'error') {
    const frames = await existingFrames(deps.fs, paths.framesDir);
    if (!frames.ok) return frames;
    const transcript = await readTranscript(deps.fs, paths.transcriptPath);
    if (!transcript.ok) return transcript;
    if (frames.value.length >= requestedFrames && transcript.value !== null) return ok('analyze');
    if (frames.value.length >= requestedFrames) return ok('audio');
    return ok('frames');
  }
  if (video.status === 'pending') return ok('frames');
  if (video.status === 'frames_extracted') return ok('audio');
  if (video.status === 'audio_extracted') {
    const audioExists = await deps.fs.exists(tempAudioPath(deps.fs, video.originalPath));
    if (!audioExists.ok) return audioExists;
    return ok(audioExists.value ? 'transcribe' : 'audio');
  }
  if (video.status === 'transcribed') return ok('analyze');
  return ok('rename');
};

const transcribe = async (
  deps: ProcessDeps,
  videoPath: string,
  resolved: ResolvedProcessOptions,
  transcriptPath: string,
  audioPath: string | null,
  skip: boolean,
  signal: AbortSignal | undefined,
): Promise<Result<void, AppError>> => {
  const finalAudioPath = audioPath ?? tempAudioPath(deps.fs, videoPath);
  if (resolved.whisper === 'skip' || skip) {
    await deps.fs.deleteFile(finalAudioPath);
    return ok(undefined);
  }
  const result = await deps.transcriber.transcribe({
    audioPath: finalAudioPath,
    transcriptPath,
    mode: resolved.whisper,
    model: resolved.whisperModel,
    apiBaseUrl: resolved.whisperApiBaseUrl,
    apiModel: resolved.whisperApiModel,
    binaryPath: resolved.whisperBinaryPath,
    signal,
  });
  const cleanup = await deps.fs.deleteFile(finalAudioPath);
  if (!result.ok) return result;
  if (!cleanup.ok) return ok(undefined);
  return ok(undefined);
};

const prerequisitesFailure = (message: string, details?: unknown): Result<never, AppError> => ({
  ok: false,
  error: appError('prerequisites_failed', message, details),
});

const existingFrames = async (fs: FileSystemPort, framesDir: string): Promise<Result<string[], AppError>> => {
  const exists = await fs.exists(framesDir);
  if (!exists.ok) return exists;
  if (!exists.value) return ok([]);
  const entries = await fs.listDirectory(framesDir);
  if (!entries.ok) return ok([]);
  return ok(
    entries.value
      .filter((entry) => entry.kind === 'file' && fs.extname(entry.name).toLowerCase() === '.jpg')
      .map((entry) => entry.path)
      .sort(),
  );
};

const readTranscript = async (fs: FileSystemPort, transcriptPath: string): Promise<Result<string | null, AppError>> => {
  const content = await fs.readTextFile(transcriptPath);
  if (!content.ok) return content;
  if (content.value === null) return ok(null);
  return ok(content.value.trim());
};

const loadSummary = async (fs: FileSystemPort, summaryJsonPath: string): Promise<Result<ParsedAnalysis, AppError>> => {
  const content = await fs.readTextFile(summaryJsonPath);
  if (!content.ok) return content;
  if (content.value === null) return { ok: false, error: appError('analysis_parse_failed', 'Summary JSON not found for rename') };
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return { ok: false, error: appError('analysis_parse_failed', 'Failed to parse summary JSON for rename') };
  }
  const parsed = summaryDataSchema.safeParse(decoded);
  if (!parsed.success) {
    return { ok: false, error: appError('analysis_parse_failed', 'Summary JSON does not match expected analysis format') };
  }
  return ok({
    description: parsed.data.description,
    suggestedFilename: parsed.data.suggestedFilename,
    fullAnalysis: parsed.data.fullAnalysis,
    tags: parsed.data.tags,
  });
};

const writeDebugLog = async (
  fs: FileSystemPort,
  debugLogPath: string,
  input: { video: Video; framePaths: string[]; rawResponse: string; provider: AnalyzerProviderConfig },
): Promise<Result<void, AppError>> => {
  const dir = fs.dirname(debugLogPath);
  const ensured = await fs.ensureDirectory(dir);
  if (!ensured.ok) return ensured;
  return fs.writeTextFile(
    debugLogPath,
    `Video: ${input.video.originalName}
Analyzer: ${input.provider.providerId}
Date Analyzed: ${new Date().toISOString()}

=== FRAME PATHS ===
${input.framePaths.map((framePath) => `  ${framePath}`).join('\n')}

=== FULL RESPONSE ===
${input.rawResponse}
`,
  );
};

const writeSummary = async (
  fs: FileSystemPort,
  videoPath: string,
  summaryJsonPath: string,
  summaryPath: string,
  data: SummaryData,
): Promise<Result<void, AppError>> => {
  const ensured = await fs.ensureDirectory(fs.dirname(summaryJsonPath));
  if (!ensured.ok) return ensured;
  const tmpPath = `${summaryJsonPath}.tmp`;
  const json = await fs.writeTextFile(tmpPath, JSON.stringify(data, null, 2));
  if (!json.ok) return json;
  const renamed = await fs.renamePath(tmpPath, summaryJsonPath);
  if (!renamed.ok) return renamed;
  return fs.writeTextFile(summaryPath, renderSummaryText(fs.basename(videoPath), data));
};

const renderSummaryText = (videoName: string, data: SummaryData): string => `Video: ${videoName}
Date Analyzed: ${data.analyzedAt}

DESCRIPTION:
${data.description}

SUGGESTED FILENAME:
${data.suggestedFilename}

TAGS:
${data.tags.join(', ')}

FULL ANALYSIS:
${data.fullAnalysis}
`;

const renameVideoAndArtifacts = async (
  fs: FileSystemPort,
  video: Video,
  suggestedFilename: string,
  signal: AbortSignal | undefined,
): Promise<Result<{ newPath: string; newName: string }, AppError>> => {
  const stat = await fs.stat(video.originalPath);
  if (!stat.ok) return stat;
  const folder = fs.dirname(video.originalPath);
  const extension = fs.extname(video.originalPath);
  const baseName = `${datePrefix(stat.value.mtimeMs)}_${normalizeKebabSlug(suggestedFilename)}`;
  const newName = await uniqueFilename(fs, folder, baseName, extension);
  if (!newName.ok) return newName;
  const newPath = fs.join(folder, newName.value);
  const newBase = fs.basenameWithoutExtension(newName.value);
  const oldArtifacts = artifactPaths(fs, folder, video.originalPath, null);
  const steps = [
    { from: video.originalPath, to: newPath, required: true },
    { from: oldArtifacts.framesDir, to: fs.join(folder, 'frames', newBase), required: false },
    { from: oldArtifacts.transcriptPath, to: fs.join(folder, 'transcripts', `${newBase}.txt`), required: false },
    { from: oldArtifacts.summaryPath, to: fs.join(folder, 'summaries', `${newBase}.txt`), required: false },
    { from: oldArtifacts.summaryJsonPath, to: fs.join(folder, 'summaries', `${newBase}.json`), required: false },
    {
      from: oldArtifacts.thumbnailPath,
      to: fs.join(folder, '.ai-video-cataloger', 'thumbnails', `${newBase}.jpg`),
      required: false,
    },
  ] as const;
  const renamed = await renamePathsWithRollback(fs, steps, signal);
  if (!renamed.ok) return renamed;
  return ok({ newPath, newName: newName.value });
};

const renamePathsWithRollback = async (
  fs: FileSystemPort,
  steps: ReadonlyArray<{ from: string; to: string; required: boolean }>,
  signal: AbortSignal | undefined,
): Promise<Result<void, AppError>> => {
  const completed: Array<{ from: string; to: string }> = [];
  for (const step of steps) {
    if (signal?.aborted === true) return rollbackAndPreserve(fs, completed, cancellationError());
    const shouldRename = step.required ? ok(true) : await fs.exists(step.from);
    if (!shouldRename.ok) return rollbackAndPreserve(fs, completed, shouldRename.error);
    if (!shouldRename.value) continue;
    const ensured = await fs.ensureDirectory(fs.dirname(step.to));
    if (!ensured.ok) return rollbackAndPreserve(fs, completed, ensured.error);
    const renamed = await fs.renamePath(step.from, step.to);
    if (!renamed.ok) return rollbackAndPreserve(fs, completed, renamed.error);
    completed.push({ from: step.from, to: step.to });
  }
  if (signal?.aborted === true) return rollbackAndPreserve(fs, completed, cancellationError());
  return ok(undefined);
};

const rollbackAndPreserve = async (
  fs: FileSystemPort,
  completed: ReadonlyArray<{ from: string; to: string }>,
  error: AppError,
): Promise<Result<void, AppError>> => {
  for (const step of [...completed].reverse()) await fs.renamePath(step.to, step.from);
  return {
    ok: false,
    error: appError(error.code, error.message, { preserveCatalog: true, cause: error.details }),
  };
};

const preservesCatalog = (error: AppError): boolean =>
  z.object({ preserveCatalog: z.literal(true) }).passthrough().safeParse(error.details).success;

const uniqueFilename = async (
  fs: FileSystemPort,
  folder: string,
  baseName: string,
  extension: string,
): Promise<Result<string, AppError>> => {
  let counter = 1;
  let candidate = `${baseName}${extension}`;
  let exists = await fs.exists(fs.join(folder, candidate));
  if (!exists.ok) return exists;
  while (exists.value) {
    counter += 1;
    candidate = `${baseName}-${counter}${extension}`;
    exists = await fs.exists(fs.join(folder, candidate));
    if (!exists.ok) return exists;
  }
  return ok(candidate);
};

const report = async (
  progress: JobExecutionContext | undefined,
  step: JobProgress['step'],
  stepNumber: number,
  videoPath: string,
  batch: ProcessBatchContext,
): Promise<Result<void, AppError>> => {
  if (progress === undefined) return ok(undefined);
  const reported = await progress.reportProgress({
    step,
    percentage: stepNumber * 20,
    current: batch.current,
    total: batch.total,
    stepNumber,
    totalSteps: TOTAL_STEPS,
    data: {
      video: videoPath,
      stepNumber,
      totalSteps: TOTAL_STEPS,
    },
  });
  if (!reported.ok) return reported;
  return cancellationBoundary(progress);
};

const isJobCancelled = (error: AppError): boolean =>
  error.code === 'processing_error' && error.message === JOB_CANCELLED_ERROR_MESSAGE;

export const tempAudioPath = (fs: FileSystemPort, videoPath: string): string =>
  fs.join(
    fs.tempDirectory(),
    'ai-video-cataloger',
    'audio',
    `${pathHash(videoPath)}-${fs.basenameWithoutExtension(videoPath)}.wav`,
  );

const pathHash = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const cancellationBoundary = (context: JobExecutionContext | undefined): Result<void, AppError> =>
  context?.signal.aborted === true ? { ok: false, error: cancellationError() } : ok(undefined);

const cancellationError = (): AppError =>
  appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE);

const datePrefix = (mtimeMs: number): string => {
  const date = new Date(mtimeMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const completedOutput = (fs: FileSystemPort, video: Video): ProcessCompletedOutput => ({
  video: video.newName ?? fs.basename(video.originalPath),
  path: video.newName === null ? video.originalPath : fs.join(fs.dirname(video.originalPath), video.newName),
  status: 'completed',
});

const alreadyIndexed = async (
  deps: ProcessDeps,
  folder: string,
  videoPath: string,
  force: boolean,
): Promise<Result<boolean, AppError>> => {
  const globalCatalog = deps.globalCatalog;
  if (globalCatalog === undefined || force) return ok(false);
  const catalogDeps = { globalCatalog, fs: deps.fs };
  const resolved = await resolveFolderIntoIndex(catalogDeps, folder);
  if (!resolved.ok) return resolved;
  const fingerprint = await deps.fs.partialContentHash(videoPath);
  if (!fingerprint.ok) return fingerprint;
  if (fingerprint.value === null) return ok(false);
  return hasProcessedAnalysis(catalogDeps, fingerprint.value);
};

const recordGlobalCatalog = async (
  deps: ProcessDeps,
  repository: CatalogRepository,
  resolved: ResolvedProcessOptions,
  completed: ProcessCompletedOutput,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const globalCatalog = deps.globalCatalog;
  if (globalCatalog === undefined) return ok(undefined);
  const finalPath = completed.path;
  const folder = deps.fs.dirname(finalPath);
  const fingerprint = await deps.fs.partialContentHash(finalPath);
  if (!fingerprint.ok) return fingerprint;
  if (fingerprint.value === null) {
    if (progress === undefined) return ok(undefined);
    return progress.reportProgress({
      step: 'catalog_index_skipped',
      data: { video: finalPath, reason: 'fingerprint_unavailable' },
    });
  }
  const stat = await deps.fs.stat(finalPath);
  if (!stat.ok) return stat;
  const probe = await deps.media.probe({ videoPath: finalPath });
  if (!probe.ok) return probe;
  const videoRow = await repository.findVideoByPath(finalPath);
  if (!videoRow.ok) return videoRow;
  const newName = videoRow.value?.newName ?? null;
  const paths = artifactPaths(deps.fs, folder, finalPath, newName);
  const summary = await loadOptionalSummary(deps.fs, paths.summaryJsonPath);
  if (!summary.ok) return summary;
  const transcript = await readTranscript(deps.fs, paths.transcriptPath);
  if (!transcript.ok) return transcript;
  const provider = resolved.analyzer.provider;
  return upsertProcessedVideo(
    { globalCatalog, fs: deps.fs },
    {
      folderPath: folder,
      fingerprint: fingerprint.value,
      fileName: deps.fs.basename(finalPath),
      size: stat.value.size,
      durationS: probe.value.duration,
      gpsLat: probe.value.gpsLat,
      gpsLon: probe.value.gpsLon,
      processedAt: new Date().toISOString(),
      analyzer: provider.providerId,
      model: analyzerModel(provider),
      finalName: newName,
      description: summary.value?.description ?? null,
      transcript: transcript.value,
      language: null,
      tags: summary.value?.tags ?? [],
    },
  );
};

const analyzerModel = (provider: AnalyzerProviderConfig): string | null => {
  if (provider.family === 'local') return provider.modelTag;
  if (provider.family === 'api') return provider.model;
  return provider.model ?? null;
};

const loadOptionalSummary = async (
  fs: FileSystemPort,
  summaryJsonPath: string,
): Promise<Result<SummaryData | null, AppError>> => {
  const content = await fs.readTextFile(summaryJsonPath);
  if (!content.ok) return content;
  if (content.value === null) return ok(null);
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return ok(null);
  }
  const parsed = summaryDataSchema.safeParse(decoded);
  return ok(parsed.success ? parsed.data : null);
};
