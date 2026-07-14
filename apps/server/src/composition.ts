import path from 'node:path';
import packageJson from '../../../package.json' with { type: 'json' };

import { ClaudeCliAnalyzerAdapter, OllamaAnalyzerAdapter } from '@adapters/analyzers/index.js';
import { JsonConfigStore, SqlJsCatalogRepositoryFactory } from '@adapters/db/index.js';
import { FfmpegMediaAdapter } from '@adapters/ffmpeg/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import { ManagedOllamaRuntimeAdapter } from '@adapters/ollama-runtime/index.js';
import { HuggingFaceWhisperModelDownloader, WhisperTranscriberAdapter } from '@adapters/whisper/index.js';
import {
  appError,
  ok,
  type AppError,
  type ConfigKey,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerPort,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  CatalogVideo,
  ConfigScope,
  ConfigStore,
  DependencyStatus,
  DirectoryEntry,
  FileStat,
  FileSystemPort,
  JobsPort,
  LocalAiRuntimePort,
  MediaPort,
  ModelDownloadPort,
  ThumbnailGeneration,
  TranscriberPort,
} from '@core/server/index.js';

export interface AppDeps {
  version: string;
  catalogs: CatalogRepositoryFactory;
  config: ConfigStore;
  fs: FileSystemPort;
  media: MediaPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
  localAi: LocalAiRuntimePort;
  downloads: ModelDownloadPort;
  jobs: JobsPort;
}

export interface AppConfig {
  version?: string;
  workingDirectory?: string;
  homeDirectory?: string;
  dbDriver?: 'sql-js' | 'memory';
}

export const createDeps = (config: AppConfig = {}): AppDeps => {
  const dbDriver = config.dbDriver ?? dbDriverFromEnv(process.env.DB_DRIVER);
  const workingDirectory = config.workingDirectory ?? process.cwd();
  const homeDirectory = config.homeDirectory;
  const jobs = new InProcessJobsPort();
  if (dbDriver === 'memory') {
    return {
      version: config.version ?? packageJson.version,
      catalogs: new InMemoryCatalogRepositoryFactory(),
      config: new InMemoryConfigStore(),
      fs: new InMemoryFileSystemPort(workingDirectory),
      media: new InMemoryMediaPort(),
      transcriber: new InMemoryTranscriberPort(),
      analyzer: new InMemoryAnalyzerPort(),
      localAi: new InMemoryLocalAiRuntimePort(),
      downloads: new InMemoryModelDownloadPort(),
      jobs,
    };
  }
  const localAi = new ManagedOllamaRuntimeAdapter({ homeDirectory });
  return {
    version: config.version ?? packageJson.version,
    catalogs: new SqlJsCatalogRepositoryFactory(),
    config: new JsonConfigStore({ homeDirectory }),
    fs: new NodeFileSystemPort({ workingDirectory }),
    media: new FfmpegMediaAdapter(),
    transcriber: new WhisperTranscriberAdapter({ homeDirectory }),
    analyzer: new BackendRoutingAnalyzerAdapter(
      new ClaudeCliAnalyzerAdapter({ homeDirectory }),
      new OllamaAnalyzerAdapter({ runtime: localAi }),
    ),
    localAi,
    downloads: new HuggingFaceWhisperModelDownloader({ homeDirectory }),
    jobs,
  };
};

class BackendRoutingAnalyzerAdapter implements AnalyzerPort {
  constructor(
    private readonly cloud: AnalyzerPort,
    private readonly local: AnalyzerPort,
  ) {}

  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    return input.backend === 'local' ? this.local.analyze(input) : this.cloud.analyze(input);
  }

  dependency(input?: { backend: AnalyzeInput['backend'] }): Promise<Result<DependencyStatus, AppError>> {
    return input?.backend === 'local' ? this.local.dependency() : this.cloud.dependency();
  }
}

const dbDriverFromEnv = (value: string | undefined): 'sql-js' | 'memory' => {
  if (value === 'memory') return 'memory';
  return 'sql-js';
};

class InMemoryCatalogRepositoryFactory implements CatalogRepositoryFactory {
  private readonly repositories = new Map<string, InMemoryCatalogRepository>();

  open(folder: string): Promise<Result<CatalogRepository, AppError>> {
    const existing = this.repositories.get(folder);
    if (existing !== undefined) return Promise.resolve(ok(existing));
    const created = new InMemoryCatalogRepository(folder);
    this.repositories.set(folder, created);
    return Promise.resolve(ok(created));
  }
}

class InMemoryCatalogRepository implements CatalogRepository {
  private videos: CatalogVideo[] = [];

  constructor(private readonly folder: string) {}

  databasePath(): string | null {
    return path.join(this.folder, '.ai-video-cataloger', 'catalog.db');
  }

  listVideos(): Promise<Result<CatalogVideo[], AppError>> {
    return Promise.resolve(ok([...this.videos]));
  }

  findVideoByPath(videoPath: string): Promise<Result<CatalogVideo | null, AppError>> {
    return Promise.resolve(ok(this.videos.find((video) => video.originalPath === videoPath) ?? null));
  }

  findVideoByHash(fileHash: string): Promise<Result<CatalogVideo | null, AppError>> {
    return Promise.resolve(ok(this.videos.find((video) => video.fileHash === fileHash) ?? null));
  }

  createVideo(input: Omit<CatalogVideo, 'id'>): Promise<Result<CatalogVideo, AppError>> {
    const nextId = this.videos.reduce((max, video) => Math.max(max, video.id), 0) + 1;
    const video = { ...input, id: nextId };
    this.videos = [...this.videos, video];
    return Promise.resolve(ok(video));
  }

  updateVideoStatus(id: number, status: CatalogVideo['status'], errorMessage: string | null): Promise<Result<CatalogVideo, AppError>> {
    const existing = this.videos.find((video) => video.id === id);
    if (existing === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated = { ...existing, status, errorMessage, updatedAt: new Date().toISOString() };
    this.videos = this.videos.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  updateVideoPath(id: number, originalPath: string): Promise<Result<CatalogVideo, AppError>> {
    const existing = this.videos.find((video) => video.id === id);
    if (existing === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated = { ...existing, originalPath, updatedAt: new Date().toISOString() };
    this.videos = this.videos.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  updateVideoNewName(id: number, newName: string): Promise<Result<CatalogVideo, AppError>> {
    const existing = this.videos.find((video) => video.id === id);
    if (existing === undefined) return Promise.resolve({ ok: false, error: appError('video_not_found', `Video not found: ${id}`) });
    const updated = { ...existing, newName, updatedAt: new Date().toISOString() };
    this.videos = this.videos.map((video) => (video.id === id ? updated : video));
    return Promise.resolve(ok(updated));
  }

  clearVideos(): Promise<Result<{ cleared: number }, AppError>> {
    const cleared = this.videos.length;
    this.videos = [];
    return Promise.resolve(ok({ cleared }));
  }

  resetVideoByOriginalName(filename: string): Promise<Result<CatalogResetSingleResult | null, AppError>> {
    const index = this.videos.findIndex((video) => video.originalName === filename);
    const before = this.videos[index];
    if (before === undefined) return Promise.resolve(ok(null));
    const after: CatalogVideo = {
      ...before,
      newName: null,
      status: 'pending',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    };
    this.videos = this.videos.map((video) => (video.id === before.id ? after : video));
    return Promise.resolve(ok({ before, after }));
  }
}

class InMemoryConfigStore implements ConfigStore {
  private readonly values = new Map<string, Map<ConfigKey, string>>();

  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.scopeValues(scope).get(key) ?? null));
  }

  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    return Promise.resolve(ok(Object.fromEntries(this.scopeValues(scope))));
  }

  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>> {
    const values = this.scopeValues(scope);
    const previousValue = values.get(key) ?? null;
    values.set(key, value);
    return Promise.resolve(ok({ previousValue }));
  }

  private scopeValues(scope: ConfigScope): Map<ConfigKey, string> {
    const key = scope.kind === 'home' ? 'home' : `folder:${scope.folder}`;
    const existing = this.values.get(key);
    if (existing !== undefined) return existing;
    const created = new Map<ConfigKey, string>();
    this.values.set(key, created);
    return created;
  }
}

class InMemoryFileSystemPort implements FileSystemPort {
  constructor(private readonly workingDirectory: string) {}

  cwd(): string {
    return this.workingDirectory;
  }

  resolve(value: string): string {
    return path.resolve(this.workingDirectory, value);
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
    return Promise.resolve(ok(value === this.workingDirectory || value === path.resolve(this.workingDirectory)));
  }

  isFile(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(false));
  }

  exists(value: string): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(value === this.workingDirectory || value === path.resolve(this.workingDirectory)));
  }

  listDirectory(): Promise<Result<DirectoryEntry[], AppError>> {
    return Promise.resolve(ok([]));
  }

  stat(): Promise<Result<FileStat, AppError>> {
    return Promise.resolve({ ok: false, error: appError('file_not_found', 'File not found') });
  }

  readTextFile(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(null));
  }

  writeTextFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  ensureDirectory(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  renamePath(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  deleteFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  partialContentHash(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(null));
  }

  tempDirectory(): string {
    return '/tmp';
  }
}

class InMemoryMediaPort implements MediaPort {
  probe(): Promise<Result<{ duration: number | null }, AppError>> {
    return Promise.resolve(ok({ duration: null }));
  }

  extractFrames(): Promise<Result<{ framePaths: string[] }, AppError>> {
    return Promise.resolve(ok({ framePaths: [] }));
  }

  extractAudio(): Promise<Result<{ hasAudio: boolean; audioPath: string | null }, AppError>> {
    return Promise.resolve(ok({ hasAudio: true, audioPath: '' }));
  }

  thumbnail(input: { thumbnailPath: string; force: boolean }): Promise<Result<ThumbnailGeneration, AppError>> {
    return Promise.resolve(ok({ path: input.thumbnailPath, generated: input.force, skipped: !input.force }));
  }

  dependencies(): Promise<Result<DependencyStatus[], AppError>> {
    return Promise.resolve(ok([dependency('ffmpeg', false), dependency('ffprobe', false)]));
  }
}

class InMemoryTranscriberPort implements TranscriberPort {
  transcribe(): Promise<Result<{ transcriptPath: string; content: string }, AppError>> {
    return Promise.resolve(ok({ transcriptPath: '', content: '' }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(dependency('whisper', false)));
  }
}

class InMemoryAnalyzerPort implements AnalyzerPort {
  analyze(): Promise<Result<{ rawResponse: string }, AppError>> {
    return Promise.resolve(ok({ rawResponse: 'DESCRIPTION: Placeholder analysis\nFILENAME: placeholder-video' }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(dependency('claude', false)));
  }
}

class InMemoryLocalAiRuntimePort implements LocalAiRuntimePort {
  machine(): Promise<Result<{ platform: string; arch: string; ramGb: number }, AppError>> {
    return Promise.resolve(ok({ platform: process.platform, arch: process.arch, ramGb: 8 }));
  }

  status(): Promise<Result<{ runtimeUp: boolean; runtimeVersion: string; installedModels: string[] }, AppError>> {
    return Promise.resolve(ok({ runtimeUp: false, runtimeVersion: '0.0.0', installedModels: [] }));
  }

  async pull(
    tag: string,
    options?: { onRuntimeReady?: (() => Promise<Result<void, AppError>>) | undefined },
  ): Promise<Result<{ tag: string; status: 'installed' }, AppError>> {
    const ready = await options?.onRuntimeReady?.();
    if (ready !== undefined && !ready.ok) return ready;
    return ok({ tag, status: 'installed' });
  }

  rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>> {
    return Promise.resolve(ok({ tag, status: 'removed' }));
  }

  stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>> {
    return Promise.resolve(ok({ stopped: false }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(dependency('local-ai', process.platform === 'darwin' && process.arch === 'arm64')));
  }
}

class InMemoryModelDownloadPort implements ModelDownloadPort {
  private readonly downloaded = new Set<WhisperModelName>();

  whisperModelPath(model: WhisperModelName): string {
    return path.join('.ai-video-cataloger', 'models', 'whisper', `ggml-${model}.bin`);
  }

  isWhisperModelDownloaded(model: WhisperModelName): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.downloaded.has(model)));
  }

  downloadWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    const pathValue = this.whisperModelPath(model);
    if (this.downloaded.has(model) && !options.force) {
      return Promise.resolve(ok({ model, path: pathValue, downloaded: false, skipped: true }));
    }
    this.downloaded.add(model);
    return Promise.resolve(ok({ model, path: pathValue, downloaded: true, skipped: false }));
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

const dependency = (name: string, available: boolean): DependencyStatus => ({
  name,
  available,
  version: null,
  source: null,
  path: null,
  installHint: '',
});
