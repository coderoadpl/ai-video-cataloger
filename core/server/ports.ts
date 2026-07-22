import type {
  AppConfig,
  AppError,
  AnalyzerProviderConfig,
  CatalogAnalysis,
  CatalogFile,
  CatalogFolder,
  ConfigKey,
  MachineProfile,
  Result,
  Video,
  WhisperModelName,
} from '@core/domain/index.js';

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

export interface CatalogFileRecord {
  file: CatalogFile;
  analysis: CatalogAnalysis | null;
}

export interface CatalogTagSummary {
  name: string;
  count: number;
}

export interface CatalogTagAliasResult {
  alias: string;
  canonical: string;
  remappedFiles: number;
}

export interface CatalogSearchInput {
  match: string;
  rankingTerms: string[];
  limit: number;
  offset: number;
}

export interface CatalogSearchRow {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  description: string | null;
  snippet: string;
  tags: string[];
  folder: CatalogFolder;
  gps: { lat: number; lon: number } | null;
  score: number;
}

export interface GlobalCatalogCounts {
  folders: number;
  files: number;
  analyses: number;
}

export interface DriveRunRecord {
  runId: string;
  root: string;
  startedAt: string;
  finishedAt: string | null;
  foldersTotal: number;
  foldersDone: number;
  filesDone: number;
  filesSkipped: number;
  filesFailed: number;
  lastActivityAt: string;
}

export interface GlobalCatalogStore {
  databasePath(): string;
  listFolders(): Promise<Result<CatalogFolder[], AppError>>;
  getFolder(folderId: string): Promise<Result<CatalogFolder | null, AppError>>;
  upsertFolder(folder: CatalogFolder): Promise<Result<void, AppError>>;
  getFile(fingerprint: string): Promise<Result<CatalogFile | null, AppError>>;
  upsertFile(file: CatalogFile): Promise<Result<void, AppError>>;
  getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>>;
  upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>>;
  listFolderRecords(folderId: string): Promise<Result<CatalogFileRecord[], AppError>>;
  listTags(): Promise<Result<CatalogTagSummary[], AppError>>;
  aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>>;
  search(input: CatalogSearchInput): Promise<Result<CatalogSearchRow[], AppError>>;
  rebuildSearchIndex(): Promise<Result<{ indexed: number }, AppError>>;
  counts(): Promise<Result<GlobalCatalogCounts, AppError>>;
  startDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>>;
  updateDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>>;
  latestDriveRun(): Promise<Result<DriveRunRecord | null, AppError>>;
}

export type ConfigScope = { kind: 'folder'; folder: string } | { kind: 'home' };

export interface ConfigStore {
  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>>;
  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>>;
  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>>;
}

export interface CredentialsStore {
  get(providerId: string): Promise<Result<string | null, AppError>>;
  set(providerId: string, credential: string): Promise<Result<void, AppError>>;
  delete?(providerId: string): Promise<Result<void, AppError>>;
  legacyPlaintextProviders?(): Promise<Result<string[], AppError>>;
}

export interface SecretsStore {
  isAvailable(): Promise<boolean>;
  get(account: string): Promise<Result<string | null, AppError>>;
  set(account: string, secret: string): Promise<Result<void, AppError>>;
  delete(account: string): Promise<Result<void, AppError>>;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'symlink';
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
  source: 'bundled' | 'configured' | 'managed' | 'system' | null;
  path: string | null;
  installHint: string;
  warning?: string | undefined;
}

export interface MediaProbe {
  duration: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

export interface ExtractFramesInput {
  videoPath: string;
  outputDirectory: string;
  frameCount: number;
  signal?: AbortSignal | undefined;
}

export interface ExtractAudioInput {
  videoPath: string;
  outputPath: string;
  signal?: AbortSignal | undefined;
}

export interface AudioExtraction {
  hasAudio: boolean;
  audioPath: string | null;
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
  extractAudio(input: ExtractAudioInput): Promise<Result<AudioExtraction, AppError>>;
  thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>>;
  dependencies(): Promise<Result<DependencyStatus[], AppError>>;
}

export interface TranscribeInput {
  audioPath: string;
  transcriptPath: string;
  mode: AppConfig['whisper_mode'];
  model: WhisperModelName;
  apiBaseUrl?: string | undefined;
  apiModel?: string | undefined;
  binaryPath?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface TranscriberPort {
  transcribe(input: TranscribeInput): Promise<Result<{ transcriptPath: string; content: string }, AppError>>;
  dependency(input?: {
    mode: AppConfig['whisper_mode'];
    model: WhisperModelName;
    apiBaseUrl?: string | undefined;
    apiModel?: string | undefined;
    binaryPath?: string | undefined;
  }): Promise<Result<DependencyStatus, AppError>>;
}

export type WhisperRuntimeSource = 'configured' | 'managed' | 'system';

export type WhisperImplementation = 'whisper-cli' | 'openai-whisper';

export interface WhisperRuntimeStatus {
  available: boolean;
  path: string | null;
  source: WhisperRuntimeSource | null;
  version: string | null;
  managedInstalled: boolean;
  buildToolsAvailable: boolean;
  missingBuildTools: string[];
  message?: string | undefined;
  implementation?: WhisperImplementation | undefined;
  warning?: string | undefined;
}

export interface WhisperRuntimeInstallProgress {
  phase: 'authenticating' | 'downloading' | 'patching' | 'source_fallback';
  percentage: number;
  artifact?: string | undefined;
}

export interface WhisperRuntimePort {
  status(input?: { configuredPath?: string | undefined }): Promise<Result<WhisperRuntimeStatus, AppError>>;
  install(options?: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined;
  }): Promise<Result<{
    path: string;
    version: string;
    installed: boolean;
  }, AppError>>;
}

export interface AnalyzeInput {
  videoPath: string;
  framePaths: string[];
  transcript: string | null;
  backend: AppConfig['analyzer_backend'];
  localModel: string;
  provider?: AnalyzerProviderConfig | undefined;
  timeoutSeconds: number;
  verbose: boolean;
  signal?: AbortSignal | undefined;
}

export interface AnalysisOutput {
  rawResponse: string;
}

export interface AnalyzerPort {
  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>>;
  dependency(input?: {
    backend: AppConfig['analyzer_backend'];
    provider?: AnalyzerProviderConfig | undefined;
  }): Promise<Result<DependencyStatus, AppError>>;
}

export type ProviderTestResult =
  | {
      family: 'api';
      providerId: string;
      reachable: boolean;
      authenticated: boolean;
      latencyMs: number | null;
      message: string;
    }
  | {
      family: 'harness';
      providerId: string;
      available: boolean;
      version: string | null;
      latencyMs: number | null;
      message: string;
    }
  | {
      family: 'local';
      providerId: string;
      runtimeAvailable: boolean;
      modelAvailable: boolean;
      version: string | null;
      latencyMs: number | null;
      message: string;
    };

export interface ProvidersPort {
  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>>;
}

export interface LocalAiRuntimeStatus {
  runtimeUp: boolean;
  runtimeVersion: string;
  installedModels: string[];
}

export interface LocalAiPullProgress {
  tag: string;
  status: string;
  completed: number | null;
  total: number | null;
  percentage: number | null;
}

export interface LocalAiRuntimePort {
  machine(): Promise<Result<MachineProfile, AppError>>;
  status(): Promise<Result<LocalAiRuntimeStatus, AppError>>;
  ensure(signal?: AbortSignal): Promise<Result<{ baseUrl: string }, AppError>>;
  pull(
    tag: string,
    options?: {
      onRuntimeReady?: (() => Promise<Result<void, AppError>>) | undefined;
      onProgress?: (progress: LocalAiPullProgress) => void;
      signal?: AbortSignal | undefined;
    },
  ): Promise<Result<{ tag: string; status: 'installed' }, AppError>>;
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
    options: { force: boolean; onProgress?: (progress: WhisperDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>>;
  deleteWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>>;
}

export type JobKind = 'process' | 'process_drive' | 'whisper_download' | 'whisper_runtime_install' | 'local_ai_pull';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export const JOB_CANCELLED_ERROR_MESSAGE = 'Job cancelled';
export type ProcessJobStep =
  | 'run-started'
  | 'folder-started'
  | 'folder-done'
  | 'run-summary'
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

export interface SequencedJobProgress {
  sequence: number;
  progress: JobProgress;
}

export interface JobRecord {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress | null;
  progressEvents: SequencedJobProgress[];
  result?: unknown;
  error: AppError | null;
  createdAt: string;
  updatedAt: string;
  resourceKey?: string | undefined;
}

export interface JobExecutionContext {
  signal: AbortSignal;
  reportProgress(progress: JobProgress): Promise<Result<void, AppError>>;
}

export interface JobsPort {
  enqueue(input: {
    kind: JobKind;
    payload: unknown;
    resourceKey?: string | undefined;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>>;
  get(jobId: string): Promise<Result<JobRecord | null, AppError>>;
  list(): Promise<Result<JobRecord[], AppError>>;
  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>>;
}
