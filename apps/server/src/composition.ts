import path from 'node:path';
import { access, constants } from 'node:fs/promises';
import packageJson from '../../../package.json' with { type: 'json' };

import {
  HarnessAnalyzerAdapter,
  OllamaAnalyzerAdapter,
  OpenAiCompatibleAnalyzerAdapter,
} from '@adapters/analyzers/index.js';
import { JsonCredentialsStore, KeychainCredentialsStore } from '@adapters/credentials/index.js';
import { KeychainSecretsAdapter } from '@adapters/secrets/index.js';
import { JsonConfigStore, SqlJsCatalogRepositoryFactory, SqlJsGlobalCatalogStore } from '@adapters/db/index.js';
import { OnnxFaceEngineAdapter } from '@adapters/faces/index.js';
import { FfmpegMediaAdapter } from '@adapters/ffmpeg/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import { ManagedOllamaRuntimeAdapter } from '@adapters/ollama-runtime/index.js';
import { ManagedWhisperRuntimeAdapter } from '@adapters/whisper-runtime/index.js';
import { HuggingFaceWhisperModelDownloader, WhisperTranscriberAdapter } from '@adapters/whisper/index.js';
import {
  appError,
  ok,
  type AnalyzerProviderConfig,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type ConfigKey,
  type FaceObservation,
  type FileArtifact,
  type Result,
  type Person,
  type WhisperModelName,
} from '@core/domain/index.js';
import { ReadinessCache } from '@core/server/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerPort,
  CatalogFileRecord,
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  CatalogTagAliasResult,
  CatalogTagSummary,
  CatalogVideo,
  ConfigScope,
  ConfigStore,
  CredentialsStore,
  DependencyStatus,
  DirectoryEntry,
  DriveRunRecord,
  FaceDetection,
  FaceStatusCounts,
  FaceIndexCandidate,
  AlignedFaceCrop,
  FaceEnginePort,
  FileStat,
  FileSystemPort,
  GlobalCatalogCounts,
  GlobalCatalogStore,
  JobsPort,
  JobExecutionContext,
  JobKind,
  JobRecord,
  LocalAiRuntimePort,
  MediaPort,
  ModelDownloadPort,
  ProvidersPort,
  ProviderTestResult,
  ThumbnailGeneration,
  TranscriberPort,
  WhisperRuntimePort,
} from '@core/server/index.js';

export interface AppDeps {
  version: string;
  catalogs: CatalogRepositoryFactory;
  globalCatalog: GlobalCatalogStore;
  config: ConfigStore;
  credentials: CredentialsStore;
  fs: FileSystemPort;
  media: MediaPort;
  transcriber: TranscriberPort;
  whisperRuntime: WhisperRuntimePort;
  analyzer: AnalyzerPort;
  providers: ProvidersPort;
  localAi: LocalAiRuntimePort;
  downloads: ModelDownloadPort;
  faceEngine: FaceEnginePort;
  jobs: JobsPort;
  readiness: ReadinessCache;
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
  const readiness = new ReadinessCache();
  const jobs = new InvalidatingJobsPort(new InProcessJobsPort(), readiness);
  if (dbDriver === 'memory') {
    const configStore = new InvalidatingConfigStore(new InMemoryConfigStore(), readiness);
    const credentials = new InvalidatingCredentialsStore(new InMemoryCredentialsStore(), readiness);
    return {
      version: config.version ?? packageJson.version,
      catalogs: new InMemoryCatalogRepositoryFactory(),
      globalCatalog: new InMemoryGlobalCatalogStore(),
      config: configStore,
      credentials,
      fs: new InMemoryFileSystemPort(workingDirectory),
      media: new InMemoryMediaPort(),
      transcriber: new InMemoryTranscriberPort(),
      whisperRuntime: new InMemoryWhisperRuntimePort(),
      analyzer: new InMemoryAnalyzerPort(),
      providers: new ProvidersNotWiredPort(),
      localAi: new InMemoryLocalAiRuntimePort(),
      downloads: new InMemoryModelDownloadPort(),
      faceEngine: new InMemoryFaceEnginePort(),
      jobs,
      readiness,
    };
  }
  const localAi = new ManagedOllamaRuntimeAdapter({ homeDirectory });
  const credentials = new InvalidatingCredentialsStore(
    new KeychainCredentialsStore(new KeychainSecretsAdapter(), new JsonCredentialsStore({ homeDirectory })),
    readiness,
  );
  const harness = new HarnessAnalyzerAdapter({ homeDirectory });
  const configStore = new InvalidatingConfigStore(new JsonConfigStore({ homeDirectory }), readiness);
  const whisperRuntime = new ManagedWhisperRuntimeAdapter({ config: configStore, homeDirectory });
  const ollamaAnalyzer = new OllamaAnalyzerAdapter({ runtime: localAi });
  const apiAnalyzer = new OpenAiCompatibleAnalyzerAdapter({ credentials });
  const downloads = new HuggingFaceWhisperModelDownloader({ homeDirectory });
  return {
    version: config.version ?? packageJson.version,
    catalogs: new SqlJsCatalogRepositoryFactory(),
    globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory }),
    config: configStore,
    credentials,
    fs: new NodeFileSystemPort({ workingDirectory }),
    media: new FfmpegMediaAdapter(),
    transcriber: new WhisperTranscriberAdapter({ credentials, homeDirectory, runtime: whisperRuntime }),
    whisperRuntime,
    analyzer: new ProviderRoutingAnalyzerAdapter(harness, ollamaAnalyzer, apiAnalyzer),
    providers: new ProviderRoutingProvidersPort(harness, ollamaAnalyzer, apiAnalyzer),
    localAi,
    downloads,
    faceEngine: new OnnxFaceEngineAdapter({ downloads }),
    jobs,
    readiness,
  };
};

class InvalidatingConfigStore implements ConfigStore {
  constructor(
    private readonly store: ConfigStore,
    private readonly readiness: ReadinessCache,
  ) {}

  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    return this.store.get(scope, key);
  }

  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    return this.store.getAll(scope);
  }

  async set(
    scope: ConfigScope,
    key: ConfigKey,
    value: string,
  ): Promise<Result<{ previousValue: string | null }, AppError>> {
    if (key === 'whisper_binary_path' && value.length > 0) {
      try {
        await access(value, constants.X_OK);
      } catch {
        return {
          ok: false,
          error: appError('invalid_config_value', `Whisper binary is not executable: ${value}`),
        };
      }
    }
    const result = await this.store.set(scope, key, value);
    if (result.ok) this.readiness.invalidate();
    return result;
  }
}

class InvalidatingJobsPort implements JobsPort {
  constructor(
    private readonly jobs: JobsPort,
    private readonly readiness: ReadinessCache,
  ) {}

  enqueue(input: {
    kind: JobKind;
    payload: unknown;
    resourceKey?: string | undefined;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>> {
    const run = input.run;
    if (run === undefined || input.kind === 'process') return this.jobs.enqueue(input);
    return this.jobs.enqueue({
      ...input,
      run: async (context) => {
        const result = await run(context);
        if (result.ok) this.readiness.invalidate();
        return result;
      },
    });
  }

  get(jobId: string): Promise<Result<JobRecord | null, AppError>> {
    return this.jobs.get(jobId);
  }

  list(): Promise<Result<JobRecord[], AppError>> {
    return this.jobs.list();
  }

  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>> {
    return this.jobs.cancel(jobId);
  }
}

class InvalidatingCredentialsStore implements CredentialsStore {
  constructor(
    private readonly store: CredentialsStore,
    private readonly readiness: ReadinessCache,
  ) {}

  get(providerId: string): Promise<Result<string | null, AppError>> {
    return this.store.get(providerId);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    const result = await this.store.set(providerId, credential);
    if (result.ok) this.readiness.invalidate();
    return result;
  }

  async delete(providerId: string): Promise<Result<void, AppError>> {
    if (this.store.delete === undefined) {
      return { ok: false, error: appError('internal', 'Credential deletion is not supported by this store') };
    }
    const result = await this.store.delete(providerId);
    if (result.ok) this.readiness.invalidate();
    return result;
  }

  legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    return this.store.legacyPlaintextProviders?.() ?? Promise.resolve(ok([]));
  }
}

class ProvidersNotWiredPort implements ProvidersPort {
  test(): Promise<Result<ProviderTestResult, AppError>> {
    return Promise.resolve({
      ok: false,
      error: appError('internal', 'Provider connectivity checks are not wired until provider adapters land'),
    });
  }
}

class ProviderRoutingProvidersPort implements ProvidersPort {
  constructor(
    private readonly harness: ProvidersPort,
    private readonly local: ProvidersPort,
    private readonly api: ProvidersPort,
  ) {}

  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family === 'api') return this.api.test(config);
    if (config.family === 'local') return this.local.test(config);
    return this.harness.test(config);
  }
}

class ProviderRoutingAnalyzerAdapter implements AnalyzerPort {
  constructor(
    private readonly harness: AnalyzerPort,
    private readonly local: AnalyzerPort,
    private readonly api: AnalyzerPort,
  ) {}

  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    if (input.provider?.family === 'api') return this.api.analyze(input);
    return input.backend === 'local' ? this.local.analyze(input) : this.harness.analyze(input);
  }

  dependency(input?: { backend: AnalyzeInput['backend']; provider?: AnalyzeInput['provider'] }): Promise<Result<DependencyStatus, AppError>> {
    if (input?.provider?.family === 'api') return this.api.dependency(input);
    return input?.backend === 'local' ? this.local.dependency(input) : this.harness.dependency(input);
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

class InMemoryGlobalCatalogStore implements GlobalCatalogStore {
  private readonly folders = new Map<string, CatalogFolder>();
  private readonly files = new Map<string, CatalogFile>();
  private readonly analyses = new Map<string, CatalogAnalysis>();
  private readonly driveRuns = new Map<string, DriveRunRecord>();
  private readonly people = new Map<string, Person>();
  private readonly faceObservations = new Map<string, FaceObservation>();

  databasePath(): string {
    return path.join('.ai-video-cataloger', 'catalog.db');
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
    this.analyses.set(analysis.fingerprint, analysis);
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
    return Promise.resolve(ok([...counts.entries()].map(([name, count]) => ({ name, count }))));
  }

  aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>> {
    return Promise.resolve(ok({ alias: input.from, canonical: input.to, remappedFiles: 0 }));
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
          score: 1,
        };
      })
      .filter((row): row is CatalogSearchRow => row !== null)
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
      const folder = this.folders.get(file.folderId);
      const analysis = this.analyses.get(file.fingerprint);
      if (folder === undefined || analysis === undefined) continue;
      if (folder.currentPath !== rootPath && !folder.currentPath.startsWith(`${rootPath}${path.sep}`)) continue;
      if ([...this.faceObservations.values()].some((observation) => observation.fingerprint === file.fingerprint)) continue;
      candidates.push({ file, analysis, folder });
    }
    return Promise.resolve(ok(candidates));
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
    const person = this.people.get(personId);
    if (person === undefined) return Promise.resolve({ ok: false, error: appError('not_found', `Person not found: ${personId}`) });
    this.people.set(personId, { ...person, displayName });
    return Promise.resolve(ok({ personId, displayName, affectedFingerprints: this.affectedFingerprints(personId) }));
  }

  listFaceObservations(input: { fingerprint?: string | undefined; personId?: string | undefined } = {}): Promise<Result<FaceObservation[], AppError>> {
    const observations = [...this.faceObservations.values()].filter((observation) =>
      (input.fingerprint === undefined || observation.fingerprint === input.fingerprint)
      && (input.personId === undefined || observation.personId === input.personId));
    return Promise.resolve(ok(observations));
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
    let movedObservations = 0;
    const affected = new Set<string>();
    for (const observation of this.faceObservations.values()) {
      if (observation.personId !== input.fromPersonId) continue;
      this.faceObservations.set(observation.obsId, { ...observation, personId: input.toPersonId });
      affected.add(observation.fingerprint);
      movedObservations += 1;
    }
    this.people.delete(input.fromPersonId);
    return Promise.resolve(ok({
      fromPersonId: input.fromPersonId,
      toPersonId: input.toPersonId,
      movedObservations,
      affectedFingerprints: [...affected],
    }));
  }

  forgetPerson(personId: string): Promise<Result<{ personId: string; deleted: boolean; cropPaths: string[]; affectedFingerprints: string[] }, AppError>> {
    const deleted = this.people.delete(personId);
    const cropPaths: string[] = [];
    const affected = new Set<string>();
    for (const observation of this.faceObservations.values()) {
      if (observation.personId !== personId) continue;
      if (observation.cropPath !== null) cropPaths.push(observation.cropPath);
      this.faceObservations.set(observation.obsId, { ...observation, personId: null, cropPath: null });
      affected.add(observation.fingerprint);
    }
    return Promise.resolve(ok({ personId, deleted, cropPaths, affectedFingerprints: [...affected] }));
  }

  purgeFaces(): Promise<Result<{ peopleDeleted: number; observationsDeleted: number; cropPaths: string[] }, AppError>> {
    const cropPaths = [...this.faceObservations.values()]
      .map((observation) => observation.cropPath)
      .filter((value): value is string => value !== null);
    const peopleDeleted = this.people.size;
    const observationsDeleted = this.faceObservations.size;
    this.people.clear();
    this.faceObservations.clear();
    return Promise.resolve(ok({ peopleDeleted, observationsDeleted, cropPaths }));
  }

  faceStatus(): Promise<Result<FaceStatusCounts, AppError>> {
    const observations = [...this.faceObservations.values()];
    return Promise.resolve(ok({
      people: this.people.size,
      observations: observations.length,
      assignedObservations: observations.filter((observation) => observation.personId !== null).length,
      unassignedObservations: observations.filter((observation) => observation.personId === null).length,
      filesIndexed: new Set(observations.map((observation) => observation.fingerprint)).size,
    }));
  }

  private affectedFingerprints(personId: string): string[] {
    return [...new Set([...this.faceObservations.values()]
      .filter((observation) => observation.personId === personId)
      .map((observation) => observation.fingerprint))];
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

class InMemoryCredentialsStore implements CredentialsStore {
  private readonly values = new Map<string, string>();

  get(providerId: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(providerId) ?? null));
  }

  set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    this.values.set(providerId, credential);
    return Promise.resolve(ok(undefined));
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
  probe(): Promise<Result<{ duration: number | null; gpsLat: number | null; gpsLon: number | null }, AppError>> {
    return Promise.resolve(ok({ duration: null, gpsLat: null, gpsLon: null }));
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

class InMemoryWhisperRuntimePort implements WhisperRuntimePort {
  status(): Promise<Result<{
    available: boolean;
    path: string | null;
    source: 'configured' | 'managed' | 'system' | null;
    version: string | null;
    managedInstalled: boolean;
    buildToolsAvailable: boolean;
    missingBuildTools: string[];
  }, AppError>> {
    return Promise.resolve(ok({
      available: false,
      path: null,
      source: null,
      version: null,
      managedInstalled: false,
      buildToolsAvailable: true,
      missingBuildTools: [],
    }));
  }

  install(): Promise<Result<{ path: string; version: string; installed: boolean }, AppError>> {
    return Promise.resolve(ok({ path: '.ai-video-cataloger/bin/whisper', version: 'test', installed: true }));
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

  ensure(): Promise<Result<{ baseUrl: string }, AppError>> {
    return Promise.resolve(ok({ baseUrl: 'http://127.0.0.1:11434' }));
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
  private readonly fileArtifacts = new Set<string>();

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

  fileArtifactPath(artifact: FileArtifact): string {
    return path.join('.ai-video-cataloger', 'models', ...artifact.id.split('/'), artifact.filename);
  }

  isFileArtifactDownloaded(artifact: FileArtifact): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.fileArtifacts.has(artifact.id)));
  }

  downloadFileArtifact(
    artifact: FileArtifact,
    options: { force: boolean },
  ): Promise<Result<{ artifactId: FileArtifact['id']; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    const artifactPath = this.fileArtifactPath(artifact);
    if (this.fileArtifacts.has(artifact.id) && !options.force) {
      return Promise.resolve(ok({ artifactId: artifact.id, path: artifactPath, downloaded: false, skipped: true }));
    }
    this.fileArtifacts.add(artifact.id);
    if (artifact.bytes === null) {
      return Promise.resolve(ok({ artifactId: artifact.id, path: artifactPath, downloaded: true, skipped: false }));
    }
    return Promise.resolve(ok({ artifactId: artifact.id, path: artifactPath, downloaded: true, skipped: false, sizeBytes: artifact.bytes }));
  }
}

class InMemoryFaceEnginePort implements FaceEnginePort {
  load(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  detect(): Promise<Result<FaceDetection[], AppError>> {
    return Promise.resolve(ok([]));
  }

  align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    return Promise.resolve(ok({ frameJpegPath, detection, width: 112, height: 112 }));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
    return Promise.resolve(ok(new Float32Array(128)));
  }

  writeCrop(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok(dependency('faces', false)));
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
