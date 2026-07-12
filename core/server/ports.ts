import type {
  AppConfig,
  AppError,
  ConfigKey,
  MachineProfile,
  Result,
  Video,
  WhisperModelName,
} from '@core/domain/index.js';

export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  nextId(): string;
}

export type CatalogVideo = Video;

export interface CatalogResetSingleResult {
  before: CatalogVideo;
  after: CatalogVideo;
}

export interface CatalogRepository {
  databasePath(): string | null;
  listVideos(): Promise<Result<CatalogVideo[], AppError>>;
  findVideoByPath(path: string): Promise<Result<CatalogVideo | null, AppError>>;
  findVideoByHash(fileHash: string): Promise<Result<CatalogVideo | null, AppError>>;
  createVideo(input: Omit<CatalogVideo, 'id'>): Promise<Result<CatalogVideo, AppError>>;
  updateVideoStatus(
    id: number,
    status: CatalogVideo['status'],
    errorMessage: string | null,
  ): Promise<Result<CatalogVideo, AppError>>;
  updateVideoPath(id: number, path: string): Promise<Result<CatalogVideo, AppError>>;
  updateVideoNewName(id: number, newName: string): Promise<Result<CatalogVideo, AppError>>;
  clearVideos(): Promise<Result<{ cleared: number }, AppError>>;
  resetVideoByOriginalName(filename: string): Promise<Result<CatalogResetSingleResult | null, AppError>>;
}

export interface CatalogRepositoryFactory {
  open(folder: string): Promise<Result<CatalogRepository, AppError>>;
}

export type ConfigScope = { kind: 'folder'; folder: string } | { kind: 'home' };

export interface ConfigStore {
  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>>;
  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>>;
  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>>;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface FileSystemPort {
  cwd(): string;
  resolve(path: string): string;
  dirname(path: string): string;
  basename(path: string): string;
  basenameWithoutExtension(path: string): string;
  extname(path: string): string;
  join(...segments: string[]): string;
  isDirectory(path: string): Promise<Result<boolean, AppError>>;
  isFile(path: string): Promise<Result<boolean, AppError>>;
  exists(path: string): Promise<Result<boolean, AppError>>;
  listDirectory(path: string): Promise<Result<DirectoryEntry[], AppError>>;
  stat(path: string): Promise<Result<FileStat, AppError>>;
  readTextFile(path: string): Promise<Result<string | null, AppError>>;
  writeTextFile(path: string, content: string): Promise<Result<void, AppError>>;
  ensureDirectory(path: string): Promise<Result<void, AppError>>;
  renamePath(from: string, to: string): Promise<Result<void, AppError>>;
  deleteFile(path: string): Promise<Result<void, AppError>>;
  partialContentHash(path: string): Promise<Result<string | null, AppError>>;
  tempDirectory(): string;
}

export interface DependencyStatus {
  name: string;
  available: boolean;
  version: string | null;
  source: 'bundled' | 'system' | null;
  path: string | null;
  installHint: string;
}

export interface MediaProbe {
  duration: number | null;
}

export interface ExtractFramesInput {
  videoPath: string;
  outputDirectory: string;
  frameCount: number;
}

export interface ExtractAudioInput {
  videoPath: string;
  outputPath: string;
}

export interface ThumbnailInput {
  videoPath: string;
  thumbnailPath: string;
  seekPercent: number;
  width: number;
  height: number;
  force: boolean;
}

export interface ThumbnailGeneration {
  path: string;
  generated: boolean;
  skipped: boolean;
}

export interface MediaPort {
  probe(input: { videoPath: string }): Promise<Result<MediaProbe, AppError>>;
  extractFrames(input: ExtractFramesInput): Promise<Result<{ framePaths: string[] }, AppError>>;
  extractAudio(input: ExtractAudioInput): Promise<Result<{ audioPath: string }, AppError>>;
  thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>>;
  dependencies(): Promise<Result<DependencyStatus[], AppError>>;
}

export interface TranscribeInput {
  audioPath: string;
  transcriptPath: string;
  mode: AppConfig['whisper_mode'];
  model: WhisperModelName;
}

export interface TranscriberPort {
  transcribe(input: TranscribeInput): Promise<Result<{ transcriptPath: string; content: string }, AppError>>;
  dependency(): Promise<Result<DependencyStatus, AppError>>;
}

export interface AnalyzeInput {
  videoPath: string;
  framePaths: string[];
  transcript: string | null;
  backend: AppConfig['analyzer_backend'];
  localModel: string;
  timeoutSeconds: number;
}

export interface AnalysisOutput {
  rawResponse: string;
}

export interface AnalyzerPort {
  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>>;
  dependency(): Promise<Result<DependencyStatus, AppError>>;
}

export interface LocalAiRuntimeStatus {
  runtimeUp: boolean;
  runtimeVersion: string;
  installedModels: string[];
}

export interface LocalAiRuntimePort {
  machine(): Promise<Result<MachineProfile, AppError>>;
  status(): Promise<Result<LocalAiRuntimeStatus, AppError>>;
  pull(tag: string): Promise<Result<{ tag: string; status: 'installed' }, AppError>>;
  rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>>;
  stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>>;
  dependency(): Promise<Result<DependencyStatus, AppError>>;
}

export interface WhisperDownloadProgress {
  model: WhisperModelName;
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
  speed: number | null;
}

export interface ModelDownloadPort {
  whisperModelPath(model: WhisperModelName): string;
  isWhisperModelDownloaded(model: WhisperModelName): Promise<Result<boolean, AppError>>;
  downloadWhisperModel(
    model: WhisperModelName,
    options: { force: boolean; onProgress?: (progress: WhisperDownloadProgress) => void },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>>;
  deleteWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>>;
}

export type JobKind = 'process' | 'whisper_download' | 'local_ai_pull';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export const JOB_CANCELLED_ERROR_MESSAGE = 'Job cancelled';
export type ProcessJobStep =
  | 'extracting_frames'
  | 'extracting_audio'
  | 'transcribing_audio'
  | 'analyzing_with_claude'
  | 'renaming_video'
  | 'skipping_rename';

export interface JobProgress {
  step: ProcessJobStep | 'downloading' | 'runtime_setup' | 'model_download';
  percentage?: number;
  current?: number;
  total?: number;
  stepNumber?: number;
  totalSteps?: number;
  data?: Record<string, unknown>;
}

export interface JobRecord {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress | null;
  result?: unknown;
  error: AppError | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobExecutionContext {
  reportProgress(progress: JobProgress): Promise<Result<void, AppError>>;
}

export interface JobsPort {
  enqueue(input: {
    kind: JobKind;
    payload: unknown;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>>;
  get(jobId: string): Promise<Result<JobRecord | null, AppError>>;
  list(): Promise<Result<JobRecord[], AppError>>;
  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>>;
}
