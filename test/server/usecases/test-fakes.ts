import path from 'node:path';

import {
  FACE_ENGINE_VERSION,
  appError,
  normalizeEmbedding,
  ok,
  type AppConfig,
  type AppError,
  type AnalyzerProviderConfig,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type ConfigKey,
  type FaceObservation,
  type FileArtifact,
  type MachineProfile,
  type Person,
  type Result,
  type Video,
  type WhisperModelName,
} from '@core/domain/index.js';

import type {
  CatalogFileRecord,
  CatalogLockSnapshot,
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  CatalogTagAliasResult,
  CatalogTagSummary,
  FaceIndexCandidate,
  FaceDetection,
  FaceEnginePort,
  FaceStatusCounts,
  AlignedFaceCrop,
  FileArtifactDownloadProgress,
  ForgetEntryResult,
  GlobalCatalogCounts,
  GlobalCatalogStore,
  ReconcileFolderInput,
  ReconcileFolderResult,
  AnalyzerPort,
  AnalysisOutput,
  ConfigScope,
  ConfigStore,
  DependencyStatus,
  DirectoryEntry,
  DriveRunRecord,
  FileStat,
  FileSystemPort,
  JobExecutionContext,
  JobKind,
  JobProgress,
  JobRecord,
  JobsPort,
  LocalAiPullProgress,
  LocalAiRuntimePort,
  LocalAiRuntimeStatus,
  MediaPort,
  MediaProbe,
  ModelDownloadPort,
  ProvidersPort,
  ProviderTestResult,
  ThumbnailGeneration,
  ThumbnailInput,
  TranscribeInput,
  TranscriberPort,
} from '../../../core/server/ports.js';

interface FakeFile {
  content: string | null;
  size: number;
  mtimeMs: number;
  hash: string | null;
}

export class InMemoryFileSystem implements FileSystemPort {
  private readonly files = new Map<string, FakeFile>();
  private readonly directories = new Set<string>();
  private readonly symlinks = new Set<string>();

  constructor(private readonly workingDirectory = '/work') {
    this.addDirectory(workingDirectory);
  }

  addDirectory(value: string): void {
    const normalized = this.normalize(value);
    const parent = path.dirname(normalized);
    if (parent !== normalized && !this.directories.has(parent)) this.addDirectory(parent);
    this.directories.add(normalized);
  }

  addFile(
    value: string,
    options: { content?: string; size?: number; mtimeMs?: number; hash?: string } = {},
  ): void {
    const normalized = this.normalize(value);
    this.addDirectory(path.dirname(normalized));
    this.files.set(normalized, {
      content: options.content ?? null,
      size: options.size ?? options.content?.length ?? 0,
      mtimeMs: options.mtimeMs ?? 0,
      hash: options.hash ?? null,
    });
  }

  addSymlink(value: string): void {
    const normalized = this.normalize(value);
    this.addDirectory(path.dirname(normalized));
    this.symlinks.add(normalized);
  }

  cwd(): string {
    return this.workingDirectory;
  }

  resolve(value: string): string {
    return this.normalize(path.isAbsolute(value) ? value : path.resolve(this.workingDirectory, value));
  }

  dirname(value: string): string {
    return path.dirname(value);
  }

  basename(value: string): string {
    return path.basename(value);
  }

  basenameWithoutExtension(value: string): string {
    return path.basename(value, path.extname(value));
  }

  extname(value: string): string {
    return path.extname(value);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }

  isDirectory(value: string): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.directories.has(this.normalize(value))));
  }

  isFile(value: string): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.files.has(this.normalize(value))));
  }

  exists(value: string): Promise<Result<boolean, AppError>> {
    const normalized = this.normalize(value);
    return Promise.resolve(ok(this.directories.has(normalized) || this.files.has(normalized)));
  }

  listDirectory(value: string): Promise<Result<DirectoryEntry[], AppError>> {
    const normalized = this.normalize(value);
    if (!this.directories.has(normalized)) {
      return Promise.resolve({ ok: false, error: appError('not_a_directory', `Not a directory: ${normalized}`) });
    }
    const entries: DirectoryEntry[] = [];
    for (const directory of this.directories) {
      if (directory === normalized || path.dirname(directory) !== normalized) continue;
      entries.push({ name: path.basename(directory), path: directory, kind: 'directory' });
    }
    for (const filePath of this.files.keys()) {
      if (path.dirname(filePath) !== normalized) continue;
      entries.push({ name: path.basename(filePath), path: filePath, kind: 'file' });
    }
    for (const linkPath of this.symlinks) {
      if (path.dirname(linkPath) !== normalized) continue;
      entries.push({ name: path.basename(linkPath), path: linkPath, kind: 'symlink' });
    }
    return Promise.resolve(ok(entries));
  }

  stat(value: string): Promise<Result<FileStat, AppError>> {
    const normalized = this.normalize(value);
    const file = this.files.get(normalized);
    if (file !== undefined) return Promise.resolve(ok({ size: file.size, mtimeMs: file.mtimeMs }));
    if (this.directories.has(normalized)) return Promise.resolve(ok({ size: 0, mtimeMs: 0 }));
    return Promise.resolve({ ok: false, error: appError('file_not_found', `File not found: ${normalized}`) });
  }

  readTextFile(value: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.files.get(this.normalize(value))?.content ?? null));
  }

  writeTextFile(value: string, content: string): Promise<Result<void, AppError>> {
    this.addFile(value, { content, size: content.length });
    return Promise.resolve(ok(undefined));
  }

  ensureDirectory(value: string): Promise<Result<void, AppError>> {
    this.addDirectory(value);
    return Promise.resolve(ok(undefined));
  }

  renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    const normalizedFrom = this.normalize(from);
    const normalizedTo = this.normalize(to);
    if (this.directories.has(normalizedTo)) {
      return Promise.resolve({ ok: false, error: appError('conflict', `Path already exists: ${normalizedTo}`) });
    }
    const file = this.files.get(normalizedFrom);
    if (file !== undefined) {
      this.addDirectory(path.dirname(normalizedTo));
      this.files.delete(normalizedFrom);
      this.files.set(normalizedTo, file);
      return Promise.resolve(ok(undefined));
    }
    if (this.directories.has(normalizedFrom)) {
      this.addDirectory(path.dirname(normalizedTo));
      const movedDirectories = [...this.directories].filter(
        (directory) => directory === normalizedFrom || directory.startsWith(`${normalizedFrom}/`),
      );
      const movedFiles = [...this.files.entries()].filter(([filePath]) => filePath.startsWith(`${normalizedFrom}/`));
      for (const directory of movedDirectories) this.directories.delete(directory);
      for (const [filePath] of movedFiles) this.files.delete(filePath);
      for (const directory of movedDirectories) {
        this.directories.add(`${normalizedTo}${directory.slice(normalizedFrom.length)}`);
      }
      for (const [filePath, movedFile] of movedFiles) {
        this.files.set(`${normalizedTo}${filePath.slice(normalizedFrom.length)}`, movedFile);
      }
      return Promise.resolve(ok(undefined));
    }
    return Promise.resolve({ ok: false, error: appError('file_not_found', `File not found: ${normalizedFrom}`) });
  }

  deleteFile(value: string): Promise<Result<void, AppError>> {
    this.files.delete(this.normalize(value));
    return Promise.resolve(ok(undefined));
  }

  partialContentHash(value: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.files.get(this.normalize(value))?.hash ?? null));
  }

  tempDirectory(): string {
    return '/tmp';
  }

  private normalize(value: string): string {
    return path.normalize(value);
  }
}

export class InMemoryCatalogRepository implements CatalogRepository {
  private records: Video[];

  constructor(
    private readonly folder: string,
    videos: Video[] = [],
  ) {
    this.records = [...videos];
  }

  databasePath(): string | null {
    return path.join(this.folder, '.ai-video-cataloger', 'catalog.db');
  }

  setVideos(videos: Video[]): void {
    this.records = [...videos];
  }

  listVideos(): Promise<Result<Video[], AppError>> {
    return Promise.resolve(ok([...this.records]));
  }

  findVideoByPath(videoPath: string): Promise<Result<Video | null, AppError>> {
    return Promise.resolve(ok(this.records.find((video) => video.originalPath === videoPath) ?? null));
  }

  findVideoByHash(fileHash: string): Promise<Result<Video | null, AppError>> {
    return Promise.resolve(ok(this.records.find((video) => video.fileHash === fileHash) ?? null));
  }

  createVideo(input: Omit<Video, 'id'>): Promise<Result<Video, AppError>> {
    const nextId = this.records.reduce((max, video) => Math.max(max, video.id), 0) + 1;
    const video = { ...input, id: nextId };
    this.records = [...this.records, video];
    return Promise.resolve(ok(video));
  }

  updateVideoStatus(id: number, status: Video['status'], errorMessage: string | null): Promise<Result<Video, AppError>> {
    const current = this.records.find((video) => video.id === id);
    if (current === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated: Video = {
      ...current,
      status,
      errorMessage,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.records = this.records.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  updateVideoPath(id: number, originalPath: string): Promise<Result<Video, AppError>> {
    const current = this.records.find((video) => video.id === id);
    if (current === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated: Video = {
      ...current,
      originalPath,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.records = this.records.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  updateVideoNewName(id: number, newName: string): Promise<Result<Video, AppError>> {
    const current = this.records.find((video) => video.id === id);
    if (current === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated: Video = {
      ...current,
      newName,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.records = this.records.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  clearVideos(): Promise<Result<{ cleared: number }, AppError>> {
    const cleared = this.records.length;
    this.records = [];
    return Promise.resolve(ok({ cleared }));
  }

  resetVideoByOriginalName(filename: string): Promise<Result<CatalogResetSingleResult | null, AppError>> {
    const before = this.records.find((video) => video.originalName === filename) ?? null;
    if (before === null) return Promise.resolve(ok(null));
    const after: Video = {
      ...before,
      newName: null,
      status: 'pending',
      errorMessage: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.records = this.records.map((video) => (video.id === before.id ? after : video));
    return Promise.resolve(ok({ before, after }));
  }
}

export class InMemoryCatalogs implements CatalogRepositoryFactory {
  private readonly repositories = new Map<string, InMemoryCatalogRepository>();
  readonly openInputs: string[] = [];

  constructor(initial: ReadonlyArray<{ folder: string; videos: Video[] }> = []) {
    for (const entry of initial) {
      this.repositories.set(path.normalize(entry.folder), new InMemoryCatalogRepository(entry.folder, entry.videos));
    }
  }

  repo(folder: string): InMemoryCatalogRepository {
    const normalized = path.normalize(folder);
    const existing = this.repositories.get(normalized);
    if (existing !== undefined) return existing;
    const created = new InMemoryCatalogRepository(normalized);
    this.repositories.set(normalized, created);
    return created;
  }

  open(folder: string): Promise<Result<CatalogRepository, AppError>> {
    this.openInputs.push(folder);
    return Promise.resolve(ok(this.repo(folder)));
  }
}

export class InMemoryConfig implements ConfigStore {
  private readonly scopes = new Map<string, Map<ConfigKey, string>>();

  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.scopeValues(scope).get(key) ?? null));
  }

  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    const values: Partial<Record<ConfigKey, string>> = {};
    for (const [key, value] of this.scopeValues(scope)) values[key] = value;
    return Promise.resolve(ok(values));
  }

  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>> {
    const values = this.scopeValues(scope);
    const previousValue = values.get(key) ?? null;
    values.set(key, value);
    return Promise.resolve(ok({ previousValue }));
  }

  private scopeValues(scope: ConfigScope): Map<ConfigKey, string> {
    const key = scope.kind === 'home' ? 'home' : `folder:${scope.folder}`;
    const existing = this.scopes.get(key);
    if (existing !== undefined) return existing;
    const created = new Map<ConfigKey, string>();
    this.scopes.set(key, created);
    return created;
  }
}

export class InMemoryMedia implements MediaPort {
  readonly thumbnailInputs: ThumbnailInput[] = [];
  readonly frameInputs: Array<{ videoPath: string; outputDirectory: string; frameCount: number }> = [];
  readonly audioInputs: Array<{ videoPath: string; outputPath: string }> = [];
  readonly durations = new Map<string, number | null>();
  readonly locations = new Map<string, { gpsLat: number; gpsLon: number }>();
  dependenciesValue: DependencyStatus[] = [dependency('ffmpeg', true), dependency('ffprobe', true)];
  hasAudio = true;

  probe(input: { videoPath: string }): Promise<Result<MediaProbe, AppError>> {
    const location = this.locations.get(input.videoPath);
    return Promise.resolve(ok({
      duration: this.durations.get(input.videoPath) ?? null,
      width: null,
      height: null,
      rotation: null,
      gpsLat: location?.gpsLat ?? null,
      gpsLon: location?.gpsLon ?? null,
    }));
  }

  extractFrames(input: { videoPath: string; outputDirectory: string; frameCount: number }): Promise<Result<{ framePaths: string[] }, AppError>> {
    this.frameInputs.push(input);
    const paths = Array.from({ length: input.frameCount }, (_value, index) =>
      path.join(input.outputDirectory, `frame-${String(index + 1).padStart(3, '0')}.jpg`),
    );
    return Promise.resolve(ok({ framePaths: paths }));
  }

  extractAudio(input: { videoPath: string; outputPath: string }): Promise<Result<{ hasAudio: boolean; audioPath: string | null }, AppError>> {
    this.audioInputs.push(input);
    return Promise.resolve(ok({ hasAudio: this.hasAudio, audioPath: this.hasAudio ? input.outputPath : null }));
  }

  thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>> {
    this.thumbnailInputs.push(input);
    return Promise.resolve(ok({ path: input.thumbnailPath, generated: input.force, skipped: !input.force }));
  }

  dependencies(): Promise<Result<DependencyStatus[], AppError>> {
    return Promise.resolve(ok(this.dependenciesValue));
  }
}

export class InMemoryFaceEngine implements FaceEnginePort {
  dependencyValue: DependencyStatus = dependency('faces', true);
  readonly cropWrites: string[] = [];

  load(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  detect(): Promise<Result<FaceDetection[], AppError>> {
    return Promise.resolve(ok([]));
  }

  align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    return Promise.resolve(ok({ frameJpegPath, detection, width: 112, height: 112, data: new Uint8Array(112 * 112 * 3) }));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
    return Promise.resolve(ok(new Float32Array(128)));
  }

  writeCrop(_alignedCrop: AlignedFaceCrop, outputPath: string): Promise<Result<void, AppError>> {
    this.cropWrites.push(outputPath);
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(this.dependencyValue));
  }
}

export class InMemoryTranscriber implements TranscriberPort {
  dependencyValue: DependencyStatus = dependency('whisper', true);
  readonly inputs: TranscribeInput[] = [];
  readonly dependencyInputs: Array<{
    mode: AppConfig['whisper_mode'];
    model: WhisperModelName;
    binaryPath?: string | undefined;
  } | undefined> = [];
  transcript = 'transcript';

  constructor(private readonly fs: FileSystemPort = new InMemoryFileSystem()) {}

  async transcribe(input: TranscribeInput): Promise<Result<{ transcriptPath: string; content: string }, AppError>> {
    this.inputs.push(input);
    const written = await this.fs.writeTextFile(input.transcriptPath, this.transcript);
    if (!written.ok) return written;
    return ok({ transcriptPath: input.transcriptPath, content: this.transcript });
  }

  dependency(input?: {
    mode: AppConfig['whisper_mode'];
    model: WhisperModelName;
    binaryPath?: string | undefined;
  }): Promise<Result<DependencyStatus, AppError>> {
    this.dependencyInputs.push(input);
    return Promise.resolve(ok(this.dependencyValue));
  }
}

export class InMemoryAnalyzer implements AnalyzerPort {
  dependencyValue: DependencyStatus = dependency('claude', true);
  analyzeError: AppError | null = null;
  readonly dependencyInputs: Array<AppConfig['analyzer_backend'] | null> = [];
  readonly dependencyProviders: Array<AnalyzerProviderConfig | null> = [];
  readonly inputs: Array<{
    videoPath: string;
    framePaths: string[];
    transcript: string | null;
    backend: AppConfig['analyzer_backend'];
    localModel: string;
    timeoutSeconds: number;
    verbose: boolean;
  }> = [];
  rawResponse = 'DESCRIPTION: A useful clip.\nFILENAME: useful-clip';

  analyze(input: {
    videoPath: string;
    framePaths: string[];
    transcript: string | null;
    backend: AppConfig['analyzer_backend'];
    localModel: string;
    timeoutSeconds: number;
    verbose: boolean;
  }): Promise<Result<AnalysisOutput, AppError>> {
    this.inputs.push(input);
    if (this.analyzeError !== null) return Promise.resolve({ ok: false, error: this.analyzeError });
    return Promise.resolve(ok({ rawResponse: this.rawResponse }));
  }

  dependency(input?: {
    backend: AppConfig['analyzer_backend'];
    provider?: AnalyzerProviderConfig | undefined;
  }): Promise<Result<DependencyStatus, AppError>> {
    this.dependencyInputs.push(input?.backend ?? null);
    this.dependencyProviders.push(input?.provider ?? null);
    return Promise.resolve(ok(this.dependencyValue));
  }
}

export class InMemoryProviders implements ProvidersPort {
  readonly tested: AnalyzerProviderConfig[] = [];

  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    this.tested.push(config);
    if (config.family !== 'harness') {
      return Promise.resolve({ ok: false, error: appError('invalid_config_value', 'Expected harness provider') });
    }
    return Promise.resolve(ok({
      family: 'harness',
      providerId: config.providerId,
      available: true,
      version: '1.0.0',
      latencyMs: 1,
      message: 'Available',
    }));
  }
}

export class InMemoryLocalAi implements LocalAiRuntimePort {
  machineValue: MachineProfile = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
  statusValue: LocalAiRuntimeStatus = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: [] };
  dependencyValue: DependencyStatus = dependency('ollama', true);
  pulled: string[] = [];
  removed: string[] = [];
  stopped = false;
  beforeRuntimeReady: (() => void) | null = null;

  machine(): Promise<Result<MachineProfile, AppError>> {
    return Promise.resolve(ok(this.machineValue));
  }

  status(): Promise<Result<LocalAiRuntimeStatus, AppError>> {
    return Promise.resolve(ok(this.statusValue));
  }

  ensure(): Promise<Result<{ baseUrl: string }, AppError>> {
    return Promise.resolve(ok({ baseUrl: 'http://127.0.0.1:11434' }));
  }

  async pull(
    tag: string,
    options?: {
      onRuntimeReady?: (() => Promise<Result<void, AppError>>) | undefined;
      onProgress?: ((progress: LocalAiPullProgress) => void) | undefined;
    },
  ): Promise<Result<{ tag: string; status: 'installed' }, AppError>> {
    this.pulled.push(tag);
    this.beforeRuntimeReady?.();
    const ready = await options?.onRuntimeReady?.();
    if (ready !== undefined && !ready.ok) return ready;
    options?.onProgress?.({ tag, status: 'success', completed: 1, total: 1, percentage: 100 });
    return ok({ tag, status: 'installed' });
  }

  rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>> {
    this.removed.push(tag);
    return Promise.resolve(ok({ tag, status: 'removed' }));
  }

  stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>> {
    this.stopped = true;
    return Promise.resolve(ok({ stopped: true }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(this.dependencyValue));
  }
}

export class InMemoryDownloads implements ModelDownloadPort {
  readonly downloaded = new Set<WhisperModelName>();
  readonly downloadedArtifacts = new Set<string>();

  whisperModelPath(model: WhisperModelName): string {
    return `/models/${model}.bin`;
  }

  fileArtifactPath(artifact: FileArtifact): string {
    return `/models/artifacts/${artifact.filename}`;
  }

  isFileArtifactDownloaded(artifact: FileArtifact): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.downloadedArtifacts.has(artifact.id)));
  }

  downloadFileArtifact(
    artifact: FileArtifact,
    options: { force: boolean; onProgress?: (progress: FileArtifactDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ artifactId: FileArtifact['id']; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    const artifactPath = this.fileArtifactPath(artifact);
    if (this.downloadedArtifacts.has(artifact.id) && !options.force) {
      return Promise.resolve(ok({ artifactId: artifact.id, path: artifactPath, downloaded: false, skipped: true }));
    }
    this.downloadedArtifacts.add(artifact.id);
    options.onProgress?.({ artifactId: artifact.id, downloadedBytes: artifact.bytes ?? 0, totalBytes: artifact.bytes, percentage: 100, speed: 0 });
    return Promise.resolve(ok({ artifactId: artifact.id, path: artifactPath, downloaded: true, skipped: false }));
  }

  isWhisperModelDownloaded(model: WhisperModelName): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.downloaded.has(model)));
  }

  downloadWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    if (this.downloaded.has(model) && !options.force) {
      return Promise.resolve(ok({ model, path: this.whisperModelPath(model), downloaded: false, skipped: true }));
    }
    this.downloaded.add(model);
    return Promise.resolve(ok({ model, path: this.whisperModelPath(model), downloaded: true, skipped: false }));
  }

  deleteWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>> {
    if (!options.force) return Promise.resolve({ ok: false, error: appError('confirmation_required', 'Force required') });
    if (!this.downloaded.has(model)) {
      return Promise.resolve({ ok: false, error: appError('model_not_found', `Model not found: ${model}`) });
    }
    this.downloaded.delete(model);
    return Promise.resolve(ok({ model, path: this.whisperModelPath(model), deleted: true }));
  }
}

export class InMemoryJobs implements JobsPort {
  private readonly records = new Map<string, JobRecord>();
  private nextId = 1;
  readonly progressEvents: JobProgress[] = [];

  addJob(record: JobRecord): void {
    this.records.set(record.jobId, record);
  }

  async enqueue(input: {
    kind: JobKind;
    payload: unknown;
    resourceKey?: string | undefined;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>> {
    if (input.resourceKey !== undefined && [...this.records.values()].some((record) =>
      record.resourceKey === input.resourceKey
      && (record.status === 'queued' || record.status === 'running'))) {
      return {
        ok: false,
        error: appError('conflict', `A ${input.kind} job is already running for ${input.resourceKey}`),
      };
    }
    const jobId = `job-${this.nextId}`;
    this.nextId += 1;
    this.records.set(jobId, {
      jobId,
      kind: input.kind,
      status: 'queued',
      progress: null,
      progressEvents: [],
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      resourceKey: input.resourceKey,
    });
    if (input.run !== undefined) {
      const queued = this.records.get(jobId);
      if (queued === undefined) return ok({ jobId });
      this.records.set(jobId, {
        ...queued,
        jobId,
        kind: input.kind,
        status: 'running',
        progress: null,
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      const result = await input.run({
        signal: new AbortController().signal,
        reportProgress: (progress) => {
          this.progressEvents.push(progress);
          const record = this.records.get(jobId);
          if (record !== undefined) {
            const sequence = record.progressEvents.length + 1;
            this.records.set(jobId, {
              ...record,
              progress,
              progressEvents: [...record.progressEvents, { sequence, progress }],
              updatedAt: '2026-01-01T00:00:00.000Z',
            });
          }
          return Promise.resolve(ok(undefined));
        },
      });
      const record = this.records.get(jobId);
      if (record !== undefined) {
        this.records.set(jobId, {
          ...record,
          status: result.ok ? 'completed' : 'failed',
          result: result.ok ? result.value : undefined,
          error: result.ok ? null : result.error,
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }
    }
    return ok({ jobId });
  }

  get(jobId: string): Promise<Result<JobRecord | null, AppError>> {
    return Promise.resolve(ok(this.records.get(jobId) ?? null));
  }

  list(): Promise<Result<JobRecord[], AppError>> {
    return Promise.resolve(ok([...this.records.values()]));
  }

  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>> {
    const record = this.records.get(jobId);
    if (record === undefined) return Promise.resolve(ok({ jobId, cancelled: false }));
    this.records.set(jobId, { ...record, status: 'cancelled', updatedAt: '2026-01-01T00:00:01.000Z' });
    return Promise.resolve(ok({ jobId, cancelled: true }));
  }
}

export const videoFixture = (overrides: Partial<Video> = {}): Video => ({
  id: overrides.id ?? 1,
  originalPath: overrides.originalPath ?? '/work/clip.mp4',
  originalName: overrides.originalName ?? 'clip.mp4',
  newName: overrides.newName ?? null,
  fileHash: overrides.fileHash ?? 'hash-1',
  status: overrides.status ?? 'pending',
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  errorMessage: overrides.errorMessage ?? null,
});

export class InMemoryGlobalCatalogStore implements GlobalCatalogStore {
  private readonly folders = new Map<string, CatalogFolder>();
  private readonly files = new Map<string, CatalogFile>();
  private readonly analyses = new Map<string, CatalogAnalysis>();
  private readonly aliases = new Map<string, string>();
  private readonly people = new Map<string, Person>();
  private readonly faceObservations = new Map<string, FaceObservation>();
  readonly faceIndexState = new Map<string, { completedAt: string; engineVersion: number }>();
  readonly driveRuns = new Map<string, DriveRunRecord>();

  constructor(private readonly path = '/home/.ai-video-cataloger/catalog.db') {}

  flushCount = 0;

  databasePath(): string {
    return this.path;
  }

  flush(): Promise<Result<void, AppError>> {
    this.flushCount += 1;
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  lockStatus(): Promise<Result<CatalogLockSnapshot, AppError>> {
    return Promise.resolve(ok({ writable: true, owner: null, blockedBy: null, warnings: [] }));
  }

  acquireWriteLock(): Promise<Result<CatalogLockSnapshot, AppError>> {
    return Promise.resolve(ok({ writable: true, owner: null, blockedBy: null, warnings: [] }));
  }

  listFolders(): Promise<Result<CatalogFolder[], AppError>> {
    return Promise.resolve(ok([...this.folders.values()]));
  }

  getFolder(folderId: string): Promise<Result<CatalogFolder | null, AppError>> {
    return Promise.resolve(ok(this.folders.get(folderId) ?? null));
  }

  upsertFolder(folder: CatalogFolder): Promise<Result<void, AppError>> {
    this.folders.set(folder.folderId, folder);
    return Promise.resolve(ok(undefined));
  }

  getFile(fingerprint: string): Promise<Result<CatalogFile | null, AppError>> {
    return Promise.resolve(ok(this.files.get(fingerprint) ?? null));
  }

  upsertFile(file: CatalogFile): Promise<Result<void, AppError>> {
    this.files.set(file.fingerprint, file);
    return Promise.resolve(ok(undefined));
  }

  getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>> {
    return Promise.resolve(ok(this.analyses.get(fingerprint) ?? null));
  }

  upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>> {
    this.analyses.set(analysis.fingerprint, {
      ...analysis,
      tags: analysis.tags.map((tag) => this.aliases.get(tag) ?? tag),
    });
    return Promise.resolve(ok(undefined));
  }

  listFolderRecords(folderId: string): Promise<Result<CatalogFileRecord[], AppError>> {
    const records = [...this.files.values()]
      .filter((file) => file.folderId === folderId)
      .map((file) => ({ file, analysis: this.analyses.get(file.fingerprint) ?? null }));
    return Promise.resolve(ok(records));
  }

  listTags(): Promise<Result<CatalogTagSummary[], AppError>> {
    const counts = new Map<string, number>();
    for (const analysis of this.analyses.values()) {
      for (const tag of analysis.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Promise.resolve(ok([...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))));
  }

  aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>> {
    let remappedFiles = 0;
    for (const analysis of this.analyses.values()) {
      if (!analysis.tags.includes(input.from)) continue;
      remappedFiles += 1;
      const tags = analysis.tags.map((tag) => tag === input.from ? input.to : tag);
      this.analyses.set(analysis.fingerprint, { ...analysis, tags: [...new Set(tags)] });
    }
    this.aliases.set(input.from, input.to);
    return Promise.resolve(ok({ alias: input.from, canonical: input.to, remappedFiles }));
  }

  search(input: CatalogSearchInput): Promise<Result<CatalogSearchRow[], AppError>> {
    const rows = [...this.files.values()]
      .map((file) => {
        const analysis = this.analyses.get(file.fingerprint) ?? null;
        const folder = this.folders.get(file.folderId);
        if (folder === undefined) return null;
        const searchable = [
          file.fileName,
          analysis?.finalName ?? '',
          analysis?.description ?? '',
          analysis?.transcript ?? '',
          ...(analysis?.tags ?? []),
        ].join(' ').toLocaleLowerCase();
        const matches = input.rankingTerms.every((term) => searchable.includes(term.toLocaleLowerCase()));
        if (!matches) return null;
        return {
          fingerprint: file.fingerprint,
          fileName: file.fileName,
          finalName: analysis?.finalName ?? null,
          description: analysis?.description ?? null,
          snippet: analysis?.description ?? file.fileName,
          tags: analysis?.tags ?? [],
          folder,
          gps: file.gpsLat === null || file.gpsLon === null ? null : { lat: file.gpsLat, lon: file.gpsLon },
          missing: file.missingAt !== null,
          score: scoreFor(file, analysis, input.rankingTerms),
        };
      })
      .filter((row): row is CatalogSearchRow => row !== null)
      .sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName))
      .slice(input.offset, input.offset + input.limit);
    return Promise.resolve(ok(rows));
  }

  rebuildSearchIndex(): Promise<Result<{ indexed: number }, AppError>> {
    return Promise.resolve(ok({ indexed: this.files.size }));
  }

  counts(): Promise<Result<GlobalCatalogCounts, AppError>> {
    return Promise.resolve(ok({
      folders: this.folders.size,
      files: this.files.size,
      analyses: this.analyses.size,
    }));
  }

  reconcileFolder(input: ReconcileFolderInput): Promise<Result<ReconcileFolderResult, AppError>> {
    const present = new Set(input.presentFingerprints);
    const elsewhere = new Set(input.fingerprintsPresentElsewhere ?? []);
    const markMissing = input.markMissing ?? true;
    let marked = 0;
    let cleared = 0;
    for (const file of this.files.values()) {
      if (file.folderId !== input.folderId) continue;
      const onDisk = present.has(file.fingerprint) || elsewhere.has(file.fingerprint);
      if (onDisk) {
        if (file.missingAt !== null) {
          this.files.set(file.fingerprint, { ...file, missingAt: null });
          cleared += 1;
        }
      } else if (markMissing && file.missingAt === null) {
        this.files.set(file.fingerprint, { ...file, missingAt: input.now });
        marked += 1;
      }
    }
    return Promise.resolve(ok({ marked, cleared }));
  }

  relocateFile(fingerprint: string, folderId: string, fileName: string): Promise<Result<void, AppError>> {
    const file = this.files.get(fingerprint);
    if (file === undefined) return Promise.resolve(ok(undefined));
    this.files.set(fingerprint, { ...file, folderId, fileName });
    return Promise.resolve(ok(undefined));
  }

  forgetEntry(fingerprint: string): Promise<Result<ForgetEntryResult, AppError>> {
    const file = this.files.get(fingerprint);
    if (file === undefined) return Promise.resolve(ok({ fingerprint, deleted: false, folderId: null, cropPaths: [] }));
    const cropPaths: string[] = [];
    for (const observation of this.faceObservations.values()) {
      if (observation.fingerprint !== fingerprint) continue;
      if (typeof observation.cropPath === 'string' && observation.cropPath.length > 0) cropPaths.push(observation.cropPath);
      this.faceObservations.delete(observation.obsId);
    }
    this.faceIndexState.delete(fingerprint);
    this.analyses.delete(fingerprint);
    this.files.delete(fingerprint);
    return Promise.resolve(ok({ fingerprint, deleted: true, folderId: file.folderId, cropPaths }));
  }

  startDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>> {
    this.driveRuns.set(run.runId, run);
    return Promise.resolve(ok(undefined));
  }

  updateDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>> {
    this.driveRuns.set(run.runId, run);
    return Promise.resolve(ok(undefined));
  }

  latestDriveRun(): Promise<Result<DriveRunRecord | null, AppError>> {
    const runs = [...this.driveRuns.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return Promise.resolve(ok(runs[0] ?? null));
  }

  listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexCandidate[], AppError>> {
    const candidates: FaceIndexCandidate[] = [];
    for (const file of this.files.values()) {
      const analysis = this.analyses.get(file.fingerprint);
      if (analysis === undefined) continue;
      const folder = this.folders.get(file.folderId);
      if (folder === undefined) continue;
      if (folder.currentPath !== rootPath && !folder.currentPath.startsWith(`${rootPath}${path.sep}`)) continue;
      const state = this.faceIndexState.get(file.fingerprint);
      if (state !== undefined && state.engineVersion >= FACE_ENGINE_VERSION) continue;
      candidates.push({ file, analysis, folder, previousEngineVersion: state?.engineVersion ?? null });
    }
    return Promise.resolve(ok(candidates.sort((left, right) => left.folder.currentPath.localeCompare(right.folder.currentPath)
      || left.file.fileName.localeCompare(right.file.fileName))));
  }

  completeFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>> {
    this.faceIndexState.set(fingerprint, { completedAt: '2026-01-01T00:00:00.000Z', engineVersion });
    return Promise.resolve(ok(undefined));
  }

  deleteFaceObservationsForFile(fingerprint: string): Promise<Result<void, AppError>> {
    for (const observation of [...this.faceObservations.values()]) {
      if (observation.fingerprint === fingerprint) this.faceObservations.delete(observation.obsId);
    }
    return Promise.resolve(ok(undefined));
  }

  listUnassignedFaceObservations(): Promise<Result<FaceObservation[], AppError>> {
    return Promise.resolve(ok([...this.faceObservations.values()].filter((observation) => observation.personId === null)));
  }

  listPeople(): Promise<Result<Person[], AppError>> {
    return Promise.resolve(ok([...this.people.values()]));
  }

  getPerson(personId: string): Promise<Result<Person | null, AppError>> {
    return Promise.resolve(ok(this.people.get(personId) ?? null));
  }

  upsertPerson(person: Person): Promise<Result<void, AppError>> {
    this.people.set(person.personId, person);
    return Promise.resolve(ok(undefined));
  }

  setPersonName(personId: string, displayName: string): Promise<Result<{ personId: string; displayName: string; affectedFingerprints: string[] }, AppError>> {
    const existing = this.people.get(personId);
    if (existing === undefined) return Promise.resolve({ ok: false, error: appError('not_found', `Person not found: ${personId}`) });
    this.people.set(personId, { ...existing, displayName });
    return Promise.resolve(ok({ personId, displayName, affectedFingerprints: this.fingerprintsForPerson(personId) }));
  }

  listFaceObservations(input: { fingerprint?: string | undefined; personId?: string | undefined } = {}): Promise<Result<FaceObservation[], AppError>> {
    let rows = [...this.faceObservations.values()];
    if (input.fingerprint !== undefined) rows = rows.filter((observation) => observation.fingerprint === input.fingerprint);
    else if (input.personId !== undefined) rows = rows.filter((observation) => observation.personId === input.personId);
    return Promise.resolve(ok(rows));
  }

  upsertFaceObservation(observation: FaceObservation): Promise<Result<void, AppError>> {
    this.faceObservations.set(observation.obsId, observation);
    return Promise.resolve(ok(undefined));
  }

  assignFaceObservation(obsId: string, personId: string | null): Promise<Result<void, AppError>> {
    const observation = this.faceObservations.get(obsId);
    if (observation === undefined) return Promise.resolve({ ok: false, error: appError('not_found', `Face observation not found: ${obsId}`) });
    this.faceObservations.set(obsId, { ...observation, personId });
    return Promise.resolve(ok(undefined));
  }

  mergePeople(input: { fromPersonId: string; toPersonId: string }): Promise<Result<{ fromPersonId: string; toPersonId: string; movedObservations: number; affectedFingerprints: string[] }, AppError>> {
    const from = this.people.get(input.fromPersonId);
    const to = this.people.get(input.toPersonId);
    if (from === undefined || to === undefined) return Promise.resolve({ ok: false, error: appError('not_found', 'Person not found') });
    const moved = [...this.faceObservations.values()].filter((observation) => observation.personId === input.fromPersonId);
    const affectedFingerprints = uniqueFingerprints(moved);
    for (const observation of moved) this.faceObservations.set(observation.obsId, { ...observation, personId: input.toPersonId });
    const embeddings = [...this.faceObservations.values()]
      .filter((observation) => observation.personId === input.toPersonId)
      .map((observation) => observation.embedding);
    this.people.set(input.toPersonId, { ...to, centroid: fakeCentroid(embeddings), exemplarCount: embeddings.length });
    this.people.delete(input.fromPersonId);
    return Promise.resolve(ok({ fromPersonId: input.fromPersonId, toPersonId: input.toPersonId, movedObservations: moved.length, affectedFingerprints }));
  }

  forgetPerson(personId: string): Promise<Result<{ personId: string; deleted: boolean; cropPaths: string[]; affectedFingerprints: string[] }, AppError>> {
    const existing = this.people.get(personId);
    if (existing === undefined) return Promise.resolve(ok({ personId, deleted: false, cropPaths: [], affectedFingerprints: [] }));
    const rows = [...this.faceObservations.values()].filter((observation) => observation.personId === personId);
    const cropPaths = rows.map((observation) => observation.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
    const affectedFingerprints = uniqueFingerprints(rows);
    for (const observation of rows) this.faceObservations.delete(observation.obsId);
    this.people.delete(personId);
    return Promise.resolve(ok({ personId, deleted: true, cropPaths, affectedFingerprints }));
  }

  purgeFaces(): Promise<Result<{ peopleDeleted: number; observationsDeleted: number; cropPaths: string[] }, AppError>> {
    const observationRows = [...this.faceObservations.values()];
    const peopleRows = [...this.people.values()];
    const cropPaths = observationRows.map((observation) => observation.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
    this.faceObservations.clear();
    this.people.clear();
    return Promise.resolve(ok({ peopleDeleted: peopleRows.length, observationsDeleted: observationRows.length, cropPaths }));
  }

  faceStatus(): Promise<Result<FaceStatusCounts, AppError>> {
    const observationRows = [...this.faceObservations.values()];
    return Promise.resolve(ok({
      people: this.people.size,
      observations: observationRows.length,
      assignedObservations: observationRows.filter((observation) => observation.personId !== null).length,
      unassignedObservations: observationRows.filter((observation) => observation.personId === null).length,
      filesIndexed: new Set(observationRows.map((observation) => observation.fingerprint)).size,
      staleVersionFiles: [...this.faceIndexState.values()].filter((state) => state.engineVersion < FACE_ENGINE_VERSION).length,
    }));
  }

  private fingerprintsForPerson(personId: string): string[] {
    return uniqueFingerprints([...this.faceObservations.values()].filter((observation) => observation.personId === personId));
  }
}

const scoreFor = (
  file: CatalogFile,
  analysis: CatalogAnalysis | null,
  rankingTerms: readonly string[],
): number => {
  let score = 0;
  for (const term of rankingTerms) {
    score += includesScore(file.fileName, term, 80);
    score += includesScore(analysis?.finalName ?? '', term, 70);
    score += includesScore((analysis?.tags ?? []).join(' '), term, 45);
    score += includesScore(analysis?.description ?? '', term, 30);
    score += includesScore(analysis?.transcript ?? '', term, 5);
  }
  return score;
};

const includesScore = (value: string, term: string, weight: number): number =>
  value.toLocaleLowerCase().includes(term.toLocaleLowerCase()) ? weight : 0;

const uniqueFingerprints = (rows: readonly FaceObservation[]): string[] =>
  [...new Set(rows.map((row) => row.fingerprint))];

const fakeCentroid = (embeddings: readonly (readonly number[])[]): number[] => {
  if (embeddings.length === 0) return Array.from({ length: 128 }, () => 0);
  const totals = Array.from({ length: 128 }, () => 0);
  for (const embedding of embeddings) {
    embedding.forEach((value, index) => {
      const current = totals[index];
      if (current !== undefined) totals[index] = current + value;
    });
  }
  return normalizeEmbedding(totals.map((value) => value / embeddings.length));
};

export const dependency = (name: string, available: boolean): DependencyStatus => ({
  name,
  available,
  version: available ? '1.0.0' : null,
  source: available ? 'system' : null,
  path: available ? `/bin/${name}` : null,
  installHint: available ? '' : `Install ${name}`,
});
