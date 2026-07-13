import {
  WHISPER_MODES,
  CONFIG_DEFAULTS,
  appError,
  ok,
  type AppConfig,
  type AppError,
  type Result,
  type Video,
  type WhisperModelName,
} from '@core/domain/index.js';
import { analyzerBackendSchema, configSchema } from '@core/domain/config.js';
import { whisperModelNameSchema } from '@core/domain/models.js';
import { z } from 'zod';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AnalyzerPort,
  type CatalogRepository,
  type CatalogRepositoryFactory,
  type ConfigStore,
  type FileSystemPort,
  type JobExecutionContext,
  type JobProgress,
  type MediaPort,
  type TranscriberPort,
} from '../ports.js';
import { artifactPaths, isSupportedVideoExtension, type SummaryData } from './shared.js';

const TOTAL_STEPS = 5;
const DEFAULT_LOCAL_TIMEOUT_SECONDS = 300;
const summaryDataSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  analyzedAt: z.string(),
});

export interface ProcessDeps {
  catalogs: CatalogRepositoryFactory;
  config: ConfigStore;
  fs: FileSystemPort;
  media: MediaPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
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
  analyzer?: AppConfig['analyzer_backend'] | undefined;
  localModel?: string | undefined;
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
  const validation = await validateVideoPath(deps.fs, input.videoPath);
  if (!validation.ok) return validation;
  const videoPath = validation.value;
  const folder = deps.fs.dirname(videoPath);
  const repository = await deps.catalogs.open(folder);
  if (!repository.ok) return repository;

  const video = await findOrCreateVideo(deps, repository.value, videoPath);
  if (!video.ok) return video;

  const resolved = await resolveProcessOptions(deps.config, folder, input);
  if (!resolved.ok) return resolved;

  const runResult = await runPipelineSteps(deps, repository.value, video.value, resolved.value, progress);
  if (!runResult.ok) {
    if (!isJobCancelled(runResult.error)) {
      await repository.value.updateVideoStatus(video.value.id, 'error', runResult.error.message);
    }
    return runResult;
  }
  return runResult;
};

export const parseAnalysisResponse = (response: string): Result<ParsedAnalysis, AppError> => {
  const lines = response.trim().split('\n');
  let description = '';
  let suggestedFilename = '';
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
    } else if (capturingDescription && trimmed.length > 0 && !upper.startsWith('FILENAME')) {
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
  });
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
    if (byHash.value !== null) return ok(byHash.value);
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
    });
    if (!frames.ok) return { ok: false, error: appError('processing_error', frames.error.message, frames.error) };
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
    });
    if (!extracted.ok) return { ok: false, error: appError('processing_error', extracted.error.message, extracted.error) };
    audioPath = extracted.value.audioPath;
    const updated = await repository.updateVideoStatus(video.id, 'audio_extracted', null);
    if (!updated.ok) return updated;
    video = updated.value;
    stage = ok('transcribe');
  }

  if (stage.value === 'transcribe') {
    const progressResult = await report(progress, 'transcribing_audio', 3, video.originalPath, resolved.batch);
    if (!progressResult.ok) return progressResult;
    const transcript = await transcribe(deps, video.originalPath, resolved, paths.transcriptPath, audioPath);
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
      timeoutSeconds: resolved.analyzer.timeoutSeconds,
    });
    if (!analyzed.ok) return { ok: false, error: appError('processing_error', analyzed.error.message, analyzed.error) };
    const debug = await writeDebugLog(deps.fs, paths.debugLogPath, {
      video,
      framePaths: frames.value,
      rawResponse: analyzed.value.rawResponse,
      backend: resolved.analyzer.backend,
    });
    if (!debug.ok) return debug;
    const parsedResult = parseAnalysisResponse(analyzed.value.rawResponse);
    if (!parsedResult.ok) return parsedResult;
    parsed = parsedResult.value;
    const summary = await writeSummary(deps.fs, video.originalPath, paths.summaryJsonPath, paths.summaryPath, {
      schemaVersion: 1,
      description: parsed.description,
      suggestedFilename: parsed.suggestedFilename,
      fullAnalysis: parsed.fullAnalysis,
      analyzedAt: new Date().toISOString(),
    });
    if (!summary.ok) return summary;
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
    const renamed = await renameVideoAndArtifacts(deps.fs, video, summary.value.suggestedFilename);
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
}

interface ResolvedProcessOptions {
  frames: number;
  skipRename: boolean;
  whisper: AppConfig['whisper_mode'];
  whisperModel: WhisperModelName;
  analyzer: ResolvedAnalyzer;
  batch: ProcessBatchContext;
}

const resolveProcessOptions = async (
  config: ConfigStore,
  folder: string,
  input: ProcessPipelineInput,
): Promise<Result<ResolvedProcessOptions, AppError>> => {
  const stored = await config.getAll({ kind: 'folder', folder });
  if (!stored.ok) return stored;
  const frames = input.framesExplicit === true ? input.frames : storedFrames(stored.value.frames) ?? CONFIG_DEFAULTS.frames;
  const skipRename =
    input.skipRenameExplicit === true ? input.skipRename : storedSkipRename(stored.value.skip_rename) ?? CONFIG_DEFAULTS.skip_rename;
  const whisper = input.whisperExplicit === true ? input.whisper : storedWhisperMode(stored.value.whisper_mode) ?? CONFIG_DEFAULTS.whisper_mode;
  const whisperModel =
    input.whisperModelExplicit === true
      ? input.whisperModel
      : storedWhisperModel(stored.value.whisper_model) ?? CONFIG_DEFAULTS.whisper_model;
  const backend = input.analyzer ?? storedAnalyzerBackend(stored.value.analyzer_backend) ?? CONFIG_DEFAULTS.analyzer_backend;
  const localModel = trimmedValue(input.localModel) ?? trimmedValue(stored.value.local_model) ?? CONFIG_DEFAULTS.local_model;
  const storedTimeout = storedTimeoutValue(stored.value.timeout);
  const timeoutSeconds =
    input.timeoutExplicit === true
      ? input.timeout
      : storedTimeout ?? (backend === 'local' ? DEFAULT_LOCAL_TIMEOUT_SECONDS : input.timeout);
  return ok({
    frames,
    skipRename,
    whisper,
    whisperModel,
    analyzer: { backend, localModel, timeoutSeconds },
    batch: input.batch ?? { current: 1, total: 1 },
  });
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
    return configSchema.shape.timeout.parse(value);
  } catch {
    return null;
  }
};

const storedFrames = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  try {
    return configSchema.shape.frames.parse(value);
  } catch {
    return null;
  }
};

const storedSkipRename = (value: string | undefined): boolean | null => {
  if (value === undefined) return null;
  try {
    return configSchema.shape.skip_rename.parse(value);
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
  if (video.status === 'audio_extracted') return ok('transcribe');
  if (video.status === 'transcribed') return ok('analyze');
  return ok('rename');
};

const transcribe = async (
  deps: ProcessDeps,
  videoPath: string,
  resolved: ResolvedProcessOptions,
  transcriptPath: string,
  audioPath: string | null,
): Promise<Result<void, AppError>> => {
  const finalAudioPath = audioPath ?? tempAudioPath(deps.fs, videoPath);
  if (resolved.whisper === 'skip') {
    await deps.fs.deleteFile(finalAudioPath);
    return ok(undefined);
  }
  const result = await deps.transcriber.transcribe({
    audioPath: finalAudioPath,
    transcriptPath,
    mode: resolved.whisper,
    model: resolved.whisperModel,
  });
  const cleanup = await deps.fs.deleteFile(finalAudioPath);
  if (!result.ok) return { ok: false, error: appError('processing_error', result.error.message, result.error) };
  if (!cleanup.ok) return ok(undefined);
  return ok(undefined);
};

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
  });
};

const writeDebugLog = async (
  fs: FileSystemPort,
  debugLogPath: string,
  input: { video: Video; framePaths: string[]; rawResponse: string; backend: AppConfig['analyzer_backend'] },
): Promise<Result<void, AppError>> => {
  const dir = fs.dirname(debugLogPath);
  const ensured = await fs.ensureDirectory(dir);
  if (!ensured.ok) return ensured;
  return fs.writeTextFile(
    debugLogPath,
    `Video: ${input.video.originalName}
Analyzer: ${input.backend}
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

FULL ANALYSIS:
${data.fullAnalysis}
`;

const renameVideoAndArtifacts = async (
  fs: FileSystemPort,
  video: Video,
  suggestedFilename: string,
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
  const renamedVideo = await fs.renamePath(video.originalPath, newPath);
  if (!renamedVideo.ok) return renamedVideo;
  const artifactRename = await renameArtifacts(fs, oldArtifacts, {
    framesDir: fs.join(folder, 'frames', newBase),
    transcriptPath: fs.join(folder, 'transcripts', `${newBase}.txt`),
    summaryPath: fs.join(folder, 'summaries', `${newBase}.txt`),
    summaryJsonPath: fs.join(folder, 'summaries', `${newBase}.json`),
    thumbnailPath: fs.join(folder, '.ai-video-cataloger', 'thumbnails', `${newBase}.jpg`),
  });
  if (!artifactRename.ok) return artifactRename;
  return ok({ newPath, newName: newName.value });
};

const renameArtifacts = async (
  fs: FileSystemPort,
  oldPaths: ReturnType<typeof artifactPaths>,
  newPaths: Omit<ReturnType<typeof artifactPaths>, 'debugLogPath'>,
): Promise<Result<void, AppError>> => {
  const steps = [
    { from: oldPaths.framesDir, to: newPaths.framesDir },
    { from: oldPaths.transcriptPath, to: newPaths.transcriptPath },
    { from: oldPaths.summaryPath, to: newPaths.summaryPath },
    { from: oldPaths.summaryJsonPath, to: newPaths.summaryJsonPath },
    { from: oldPaths.thumbnailPath, to: newPaths.thumbnailPath },
  ] as const;
  for (const step of steps) {
    const exists = await fs.exists(step.from);
    if (!exists.ok) return exists;
    if (exists.value) {
      const ensured = await fs.ensureDirectory(fs.dirname(step.to));
      if (!ensured.ok) return ensured;
      const renamed = await fs.renamePath(step.from, step.to);
      if (!renamed.ok) return renamed;
    }
  }
  return ok(undefined);
};

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
  return progress.reportProgress({
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
};

const isJobCancelled = (error: AppError): boolean =>
  error.code === 'processing_error' && error.message === JOB_CANCELLED_ERROR_MESSAGE;

const tempAudioPath = (fs: FileSystemPort, videoPath: string): string =>
  fs.join(fs.tempDirectory(), 'ai-video-cataloger', 'audio', `${fs.basenameWithoutExtension(videoPath)}.wav`);

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
