import path from 'node:path';
import { access, constants } from 'node:fs/promises';
import packageJson from '../../../../package.json' with { type: 'json' };

import { InProcessJobsPort } from '@adapters/jobs/index.js';
import {
  FACE_ENGINE_VERSION,
  appError,
  ok,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type ConfigKey,
  type CredentialDeletion,
  type CredentialsBackendStatus,
  type FaceObservation,
  type FileArtifact,
  type Person,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';
import { ReadinessCache } from '@core/server/index.js';
import type {
  AlignedFaceCrop,
  AnalyzerPort,
  CatalogFileRecord,
  CatalogLockSnapshot,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogTagAliasResult,
  CatalogTagSummary,
  CatalogVideo,
  CliPathPort,
  ConfigScope,
  ConfigStore,
  CredentialsStore,
  CredentialValueConflict,
  DependencyStatus,
  DirectoryEntry,
  DriveRunRecord,
  FaceDetection,
  FaceEnginePort,
  FaceIndexCandidate,
  FaceStatusCounts,
  FileStat,
  FileSystemPort,
  FolderWatchHandle,
  FolderWatcherPort,
  ForgetEntryResult,
  GlobalCatalogCounts,
  GlobalCatalogStore,
  JobExecutionContext,
  JobKind,
  JobRecord,
  JobsPort,
  LocalAiRuntimePort,
  MediaPort,
  MediaProbe,
  ModelDownloadPort,
  ProvidersPort,
  ProviderTestResult,
  ReconcileFolderInput,
  ReconcileFolderResult,
  ThumbnailGeneration,
  TranscriberPort,
  WhisperRuntimePort,
} from '@core/server/index.js';

const CLI_COMMAND_NAME = 'ai-video-cataloger';
const CLI_OWNED_INSTALL_PATHS = ['/usr/local/bin/ai-video-cataloger'];

const stubCliPathPort: CliPathPort = {
  commandName: CLI_COMMAND_NAME,
  ownedInstallPaths: CLI_OWNED_INSTALL_PATHS,
  resolveOnPath: () => Promise.resolve(ok([])),
};

interface InMemoryDepsConfig {
  version?: string;
  workingDirectory?: string;
}

export const createInMemoryDeps = (config: InMemoryDepsConfig = {}) => {
  const readiness = new ReadinessCache();
  const jobs = new InvalidatingJobsPort(new InProcessJobsPort(), readiness);
  const configStore = new InvalidatingConfigStore(new InMemoryConfigStore(), readiness);
  const credentials = new InvalidatingCredentialsStore(new InMemoryCredentialsStore(), readiness);
  return {
    version: config.version ?? packageJson.version,
    cliPath: stubCliPathPort,
    catalogs: new InMemoryCatalogRepositoryFactory(),
    globalCatalog: new InMemoryGlobalCatalogStore(),
    config: configStore,
    credentials,
    fs: new InMemoryFileSystemPort(config.workingDirectory ?? process.cwd()),
    folderWatcher: new InertFolderWatcherPort(),
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

  onSettled(jobId: string, callback: () => void | Promise<void>): void {
    this.jobs.onSettled(jobId, callback);
  }
}

class InvalidatingCredentialsStore implements Required<CredentialsStore> {
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

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const remove = this.store.delete;
    if (remove === undefined) {
      return { ok: false, error: appError('internal', 'Credential deletion is not supported by this store') };
    }
    const result = await remove.call(this.store, providerId);
    if (result.ok) this.readiness.invalidate();
    return result;
  }

  legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    return this.store.legacyPlaintextProviders?.() ?? Promise.resolve(ok([]));
  }

  credentialValueConflicts(): Promise<Result<CredentialValueConflict[], AppError>> {
    return this.store.credentialValueConflicts?.() ?? Promise.resolve(ok([]));
  }

  unreadableCredentialEntries(): Promise<Result<string[], AppError>> {
    return this.store.unreadableCredentialEntries?.() ?? Promise.resolve(ok([]));
  }

  backend(): Promise<CredentialsBackendStatus> {
    return this.store.backend?.() ?? Promise.resolve({ backend: 'file', reason: 'unsupported' });
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

class InertFolderWatcherPort implements FolderWatcherPort {
  watch(): Promise<Result<FolderWatchHandle, AppError>> {
    return Promise.resolve(ok({ close: () => undefined }));
  }
}

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

  writable(): boolean {
    return true;
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
  private readonly faceIndexState = new Map<string, { completedAt: string; engineVersion: number }>();

  databasePath(): string {
    return path.join('.ai-video-cataloger', 'catalog.db');
  }

  flush(): Promise<Result<void, AppError>> {
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

  acquireLease(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  releaseLease(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
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
          missing: file.missingAt !== null,
          score: 1,
        };
      })
      .filter((row): row is CatalogSearchRow => row !== null)
      .slice(input.offset, input.offset + input.limit);
    return Promise.resolve(ok(rows));
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
    this.driveRuns.set(run.runId, structuredClone(run));
    return Promise.resolve(ok(undefined));
  }

  updateDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>> {
    this.driveRuns.set(run.runId, structuredClone(run));
    return Promise.resolve(ok(undefined));
  }

  latestDriveRun(): Promise<Result<DriveRunRecord | null, AppError>> {
    const runs = [...this.driveRuns.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return Promise.resolve(ok(runs[0] ?? null));
  }

  unfinishedDriveRuns(root: string): Promise<Result<DriveRunRecord[], AppError>> {
    const runs = [...this.driveRuns.values()]
      .filter((run) => run.root === root && run.finishedAt === null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return Promise.resolve(ok(runs));
  }

  listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexCandidate[], AppError>> {
    const candidates: FaceIndexCandidate[] = [];
    for (const file of this.files.values()) {
      const folder = this.folders.get(file.folderId);
      const analysis = this.analyses.get(file.fingerprint);
      if (folder === undefined || analysis === undefined) continue;
      if (folder.currentPath !== rootPath && !folder.currentPath.startsWith(`${rootPath}${path.sep}`)) continue;
      const state = this.faceIndexState.get(file.fingerprint);
      if (state !== undefined && state.engineVersion >= FACE_ENGINE_VERSION) continue;
      candidates.push({ file, analysis, folder, previousEngineVersion: state?.engineVersion ?? null });
    }
    return Promise.resolve(ok(candidates));
  }

  completeFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>> {
    this.faceIndexState.set(fingerprint, { completedAt: new Date().toISOString(), engineVersion });
    return Promise.resolve(ok(undefined));
  }

  deleteFaceObservationsForFile(fingerprint: string): Promise<Result<{ cropPaths: string[] }, AppError>> {
    const cropPaths: string[] = [];
    for (const observation of [...this.faceObservations.values()]) {
      if (observation.fingerprint !== fingerprint) continue;
      if (typeof observation.cropPath === 'string' && observation.cropPath.length > 0) cropPaths.push(observation.cropPath);
      this.faceObservations.delete(observation.obsId);
    }
    return Promise.resolve(ok({ cropPaths }));
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
      staleVersionFiles: [...this.faceIndexState.values()].filter((state) => state.engineVersion < FACE_ENGINE_VERSION).length,
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

  delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const existed = this.values.delete(providerId);
    return Promise.resolve(ok({ cleared: existed ? ['file'] : [], retained: [] }));
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

  homeDirectory(): string {
    return path.join(this.workingDirectory, 'home');
  }
}

class InMemoryMediaPort implements MediaPort {
  probe(): Promise<Result<MediaProbe, AppError>> {
    return Promise.resolve(ok({
      duration: null,
      width: null,
      height: null,
      rotation: null,
      gpsLat: null,
      gpsLon: null,
    }));
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
