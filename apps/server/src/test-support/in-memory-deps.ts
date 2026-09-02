import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { access, constants, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import packageJson from '../../../../package.json' with { type: 'json' };
import { z } from 'zod';

import { PHOTOS_SCHEMA_VERSION } from '@adapters/db/index.js';
import { backupKeyFingerprint, ensureBackupRecoveryKey, parseRecoveryKey } from '@adapters/backup/envelope.js';
import { MemoryBackupDestination } from '@adapters/backup/memory-destination.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import { FakeExifPort, FakePhotoMediaPort, InMemoryPhotosStore } from '../../../../test/server/usecases/test-fakes.js';
import {
  FACE_ENGINE_VERSION,
  GLOBAL_CATALOG_SCHEMA_VERSION,
  LEGACY_CONFIG_ID,
  acceptsGpsWrite,
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  appError,
  canonicalPath,
  compareUtf8Bytes,
  ok,
  type AnalysisLanguageResolution,
  type BackupPhase,
  type BackupState,
  type BackupTier,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type ConfigKey,
  type CredentialDeletion,
  type CredentialsBackendStatus,
  type FaceObservation,
  type FileArtifact,
  type Person,
  type Result,
  type RemoteBackup,
  type SpendLedgerEntry,
  type WhisperModelName,
} from '@core/domain/index.js';
import {
  ReadinessCache,
  confirmBackupRecoveryKey,
  importBackupRecoveryKey,
  connectBackupDestination,
  createRecoveryKeyCeremony,
  disableBackup,
  enableBackup,
  exportBackupRecoveryKey,
  readBackupStatus,
  runBackupNow,
  testBackupDestination,
  type BackupConnectRequest,
  type BackupEnableRequest,
  type BackupEnablementDeps,
  type BackupStatePort,
  type FileSavePort,
  type SecretsAvailability,
  type SecretsStore,
} from '@core/server/index.js';
import type {
  AlignedFaceCrop,
  AnalyzedFileLocation,
  AnalyzePhotosInput,
  AnalyzePhotosOutput,
  AnalyzerPort,
  ApplyGeoBackfillInput,
  ApplyGeoBackfillResult,
  CatalogFilePerson,
  CatalogFileRecord,
  CatalogLockSnapshot,
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  CatalogLocationRow,
  CatalogLocationsSnapshot,
  CatalogSearchInput,
  CatalogSearchResults,
  CatalogSearchRow,
  CatalogTagAlias,
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
  FaceFrameInput,
  FaceIndexCandidate,
  FaceIndexScope,
  FaceStatusCounts,
  FileArtifactStatus,
  FileStat,
  FileSystemPort,
  FolderWatchHandle,
  FolderWatcherPort,
  ForgetEntryResult,
  GeoBackfillCandidate,
  GlobalCatalogCounts,
  GlobalCatalogStore,
  JobExecutionContext,
  JobKind,
  JobRecord,
  JobsPort,
  LibraryFacets,
  LocalAiRuntimePort,
  MediaPort,
  MediaProbe,
  ModelDownloadPort,
  PlacesPort,
  ProvidersPort,
  ProviderTestResult,
  ReconcileFolderInput,
  ReconcileFolderResult,
  SpendLedgerPort,
  SpendLedgerTotal,
  TagTermExpansion,
  ThumbnailFromFrameInput,
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
  files?: readonly string[];
  textFiles?: Readonly<Record<string, string>>;
  saveFile?: FileSavePort['save'] | undefined;
}

export const createInMemoryDeps = (config: InMemoryDepsConfig = {}) => {
  const readiness = new ReadinessCache();
  const jobs = new InvalidatingJobsPort(new InProcessJobsPort(), readiness);
  const configStore = new InvalidatingConfigStore(new InMemoryConfigStore(), readiness);
  const credentials = new InvalidatingCredentialsStore(new InMemoryCredentialsStore(), readiness);
  const backupDestination = new MemoryBackupDestination();
  seedMemoryBackups(backupDestination, process.env.AVC_TEST_MEMORY_BACKUPS);
  const secrets = new InMemorySecrets();
  const backupState = new InMemoryBackupState();
  const backupEnablement: BackupEnablementDeps = {
    config: configStore,
    secrets,
    jobs,
    ceremony: createRecoveryKeyCeremony(),
    fileSave: { save: config.saveFile ?? (() => Promise.resolve(memoryModeUnavailable())) },
    destination: () => Promise.resolve(ok(backupDestination)),
    enqueueBackup: (input) => enqueueSimulatedBackup(jobs, backupDestination, backupState, secrets, {
      ...input,
      appVersion: config.version ?? packageJson.version,
    }),
    recoveryKey: () => ensureBackupRecoveryKey(secrets),
    parseRecoveryKey,
    fingerprintKey: backupKeyFingerprint,
  };
  return {
    version: config.version ?? packageJson.version,
    cliPath: stubCliPathPort,
    catalogs: new InMemoryCatalogRepositoryFactory(),
    globalCatalog: new InMemoryGlobalCatalogStore(),
    photos: new InMemoryPhotosStore(),
    photoMedia: new FakePhotoMediaPort(),
    exif: new FakeExifPort(),
    config: configStore,
    credentials,
    fs: new InMemoryFileSystemPort(config.workingDirectory ?? process.cwd(), config.files ?? [], config.textFiles ?? {}),
    folderWatcher: new InertFolderWatcherPort(),
    media: new InMemoryMediaPort(),
    transcriber: new InMemoryTranscriberPort(),
    whisperRuntime: new InMemoryWhisperRuntimePort(),
    analyzer: new InMemoryAnalyzerPort(),
    providers: new ProvidersNotWiredPort(),
    spendLedger: new InMemorySpendLedger(),
    localAi: new InMemoryLocalAiRuntimePort(),
    downloads: new InMemoryModelDownloadPort(),
    faceEngine: new InMemoryFaceEnginePort(),
    places: new InMemoryPlacesPort(),
    jobs,
    backupDestination: () => Promise.resolve(ok(backupDestination)),
    cleanupBackupStaging: () => Promise.resolve(ok(undefined)),
    evaluateScheduledBackup: () => Promise.resolve(ok(undefined)),
    listBackups: (tier: 'critical' | 'optional' | null, signal: AbortSignal) => backupDestination.list(tier, signal),
    restoreBackup: (input: { remoteId: string; recoveryKey?: string | undefined }) =>
      enqueueSimulatedRestore(jobs, backupDestination, input.remoteId),
    backupStatus: (input: { testConnection: boolean }) => readBackupStatus({
      config: configStore,
      state: backupState,
      jobs,
      secrets,
      supportedSchemaVersions: { globalCatalog: GLOBAL_CATALOG_SCHEMA_VERSION, photos: PHOTOS_SCHEMA_VERSION },
      destination: () => Promise.resolve(ok(backupDestination)),
    }, input),
    connectBackup: (request: BackupConnectRequest, signal: AbortSignal) =>
      connectBackupDestination(backupEnablement, request, signal),
    testBackup: (signal: AbortSignal) => testBackupDestination(backupEnablement, signal),
    enableBackup: (request: BackupEnableRequest) => enableBackup(backupEnablement, request),
    disableBackup: (request: { purgeCredentials: boolean }) => disableBackup(backupEnablement, request),
    exportBackupRecoveryKey: () => exportBackupRecoveryKey(backupEnablement),
    confirmBackupRecoveryKey: () => confirmBackupRecoveryKey(backupEnablement),
    importBackupRecoveryKey: (request: { recoveryKey: string }) =>
      importBackupRecoveryKey(backupEnablement, request),
    runBackup: (request: { tier: BackupTier }) => runBackupNow(backupEnablement, request),
    readiness,
  };
};

class InMemorySecrets implements SecretsStore {
  private readonly values = new Map<string, string>();

  availability(): Promise<SecretsAvailability> {
    return Promise.resolve('available');
  }

  get(account: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }

  set(account: string, secret: string): Promise<Result<void, AppError>> {
    this.values.set(account, secret);
    return Promise.resolve(ok(undefined));
  }

  delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    return Promise.resolve(ok({ existed: this.values.delete(account) }));
  }
}

class InMemoryBackupState implements BackupStatePort {
  private state: BackupState | null = null;

  read(): Promise<Result<BackupState | null, AppError>> {
    return Promise.resolve(ok(this.state));
  }

  write(state: BackupState): Promise<Result<void, AppError>> {
    this.state = state;
    return Promise.resolve(ok(undefined));
  }
}

const BACKUP_PROGRESS: ReadonlyArray<readonly [BackupPhase, number]> = [
  ['fingerprinting', 5],
  ['snapshotting', 15],
  ['archiving', 35],
  ['encrypting', 55],
  ['uploading', 75],
  ['pruning', 90],
];

const RESTORE_PROGRESS: ReadonlyArray<readonly [BackupPhase, number]> = [
  ['downloading', 20],
  ['decrypting', 45],
  ['verifying', 65],
  ['restoring', 85],
];

// The memory driver has no real catalog files to snapshot, so the backup and restore
// jobs replay the phase sequence the GUI renders and exchange a placeholder archive
// with the memory destination; the real pipeline is covered by the adapter suites.
const enqueueSimulatedBackup = (
  jobs: JobsPort,
  destination: MemoryBackupDestination,
  state: BackupStatePort,
  secrets: SecretsStore,
  input: { tier: BackupTier; manual: boolean; appVersion: string },
): Promise<Result<{ jobId: string }, AppError>> => jobs.enqueue({
  kind: 'backup',
  payload: { tier: input.tier, manual: input.manual },
  resourceKey: 'backup',
  run: async (context) => {
    const createdAt = new Date().toISOString();
    for (const [step, percentage] of BACKUP_PROGRESS) {
      const reported = await context.reportProgress({ step, percentage });
      if (!reported.ok) return reported;
    }
    const storedKey = await secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
    if (!storedKey.ok) return storedKey;
    const archivePath = path.join(tmpdir(), `avc-memory-backup-${randomUUID()}.avcbak`);
    await writeFile(archivePath, Buffer.alloc(1024), { mode: 0o600 });
    try {
      const uploaded = await destination.upload({
        sourcePath: archivePath,
        name: `avc-${input.tier}-${createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.avcbak`,
        manifest: {
          formatVersion: 1,
          tier: input.tier,
          createdAt,
          appVersion: input.appVersion,
          schemaVersions: { globalCatalog: GLOBAL_CATALOG_SCHEMA_VERSION, photos: PHOTOS_SCHEMA_VERSION },
          contentFingerprint: '0'.repeat(64),
          totalBytes: 1024,
          files: [],
          folders: [],
          keyFingerprint: storedKey.value === null
            ? null
            : backupKeyFingerprint(Buffer.from(storedKey.value, 'base64')),
        },
      }, context.signal);
      if (!uploaded.ok) return uploaded;
      const written = await state.write({
        lastSuccessAt: createdAt,
        lastFingerprint: null,
        lastErrorCode: null,
        lastArchiveName: uploaded.value.name,
        lastRestoreAt: null,
      });
      return written.ok ? ok(uploaded.value) : written;
    } finally {
      await rm(archivePath, { force: true });
    }
  },
});

const enqueueSimulatedRestore = (
  jobs: JobsPort,
  destination: MemoryBackupDestination,
  remoteId: string,
): Promise<Result<{ jobId: string }, AppError>> => jobs.enqueue({
  kind: 'restore',
  payload: { remoteId },
  resourceKey: 'backup',
  run: async (context) => {
    const listed = await destination.list(null, context.signal);
    if (!listed.ok) return listed;
    const restored = listed.value.find((backup) => backup.remoteId === remoteId);
    if (restored === undefined) return { ok: false, error: appError('not_found', 'Remote backup not found') };
    for (const [step, percentage] of RESTORE_PROGRESS) {
      const reported = await context.reportProgress({ step, percentage });
      if (!reported.ok) return reported;
    }
    return ok({ restored, relaunchRequired: true, preRestoreDirectory: path.join(tmpdir(), 'avc-memory-pre-restore') });
  },
});

const memoryModeUnavailable = (): { ok: false; error: AppError } => ({
  ok: false,
  error: appError('unavailable', 'Backup management is not available in memory mode'),
});

const memoryBackupSeedSchema = z.array(z.object({
  metadata: z.object({
    remoteId: z.string().min(1),
    name: z.string().min(1),
    tier: z.enum(['critical', 'optional']),
    createdAt: z.iso.datetime(),
    sizeBytes: z.number().int().nonnegative(),
    appVersion: z.string().min(1),
    schemaVersions: z.object({
      globalCatalog: z.number().int().nonnegative(),
      photos: z.number().int().nonnegative(),
    }).strict(),
    keyFingerprint: z.string().min(1).nullable().default(null),
  }).strict(),
  base64: z.string(),
}).strict());

const seedMemoryBackups = (
  destination: MemoryBackupDestination,
  encoded: string | undefined,
): void => {
  if (encoded === undefined || encoded.length === 0) return;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return;
  }
  const parsed = memoryBackupSeedSchema.safeParse(decoded);
  if (!parsed.success) return;
  for (const item of parsed.data) {
    const metadata: RemoteBackup = item.metadata;
    destination.seed(metadata, Buffer.from(item.base64, 'base64'));
  }
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

  async delete(scope: ConfigScope, key: ConfigKey): Promise<Result<{ previousValue: string | null }, AppError>> {
    const result = await this.store.delete(scope, key);
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

  acquireResource(key: string, signal?: AbortSignal | undefined): Promise<Result<() => void, AppError>> {
    return this.jobs.acquireResource(key, signal);
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

  openIfExists(folder: string): Promise<Result<CatalogRepository | null, AppError>> {
    return Promise.resolve(ok(this.repositories.get(folder) ?? null));
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
  private readonly variants = new Map<string, CatalogVariant>();
  private readonly variantLanguageResolutions = new Map<string, AnalysisLanguageResolution>();
  private readonly selectedConfigIds = new Map<string, string>();
  private readonly folderDefaultVariants = new Map<string, string>();
  private readonly driveRuns = new Map<string, DriveRunRecord>();
  private readonly people = new Map<string, Person>();
  private readonly faceObservations = new Map<string, FaceObservation>();
  private readonly faceIndexState = new Map<string, { completedAt: string; engineVersion: number }>();

  databasePath(): string {
    return path.join('.ai-video-cataloger', 'catalog.db');
  }

  snapshotTo(): Promise<Result<{ sizeBytes: number; schemaVersion: number }, AppError>> {
    return Promise.resolve(ok({ sizeBytes: 0, schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION }));
  }

  flush(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  withBatch<T>(operation: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return operation();
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
    this.folders.set(folder.folderId, { ...folder, currentPath: canonicalPath(folder.currentPath) });
    return Promise.resolve(ok(undefined));
  }

  getFile(fingerprint: string): Promise<Result<CatalogFile | null, AppError>> {
    return Promise.resolve(ok(this.files.get(fingerprint) ?? null));
  }

  upsertFile(file: CatalogFile): Promise<Result<void, AppError>> {
    this.files.set(file.fingerprint, { ...file, fileName: canonicalPath(file.fileName) });
    return Promise.resolve(ok(undefined));
  }

  getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>> {
    return Promise.resolve(ok(this.analyses.get(fingerprint) ?? null));
  }

  upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>> {
    this.analyses.set(analysis.fingerprint, analysis);
    const file = this.files.get(analysis.fingerprint);
    this.variants.set(`${analysis.fingerprint}\u0000${LEGACY_CONFIG_ID}`, {
      ...analysis,
      configId: LEGACY_CONFIG_ID,
      descriptor: null,
      analyzer: file?.analyzer ?? null,
      model: file?.model ?? null,
      createdAt: file?.processedAt ?? '1970-01-01T00:00:00.000Z',
      usage: null,
      resolvedOutputLanguage: null,
      resolvedTagLanguage: null,
    });
    if (!this.selectedConfigIds.has(analysis.fingerprint)) {
      this.selectedConfigIds.set(analysis.fingerprint, LEGACY_CONFIG_ID);
    }
    return Promise.resolve(ok(undefined));
  }

  listVariants(fingerprint: string): Promise<Result<CatalogVariant[], AppError>> {
    return Promise.resolve(ok([...this.variants.values()].filter((variant) => variant.fingerprint === fingerprint)));
  }

  getVariant(fingerprint: string, configId: string): Promise<Result<CatalogVariant | null, AppError>> {
    return Promise.resolve(ok(this.variants.get(`${fingerprint}\u0000${configId}`) ?? null));
  }

  upsertVariant(variant: CatalogVariant, languageResolution?: AnalysisLanguageResolution): Promise<Result<void, AppError>> {
    const key = `${variant.fingerprint}\u0000${variant.configId}`;
    this.variants.set(key, {
      ...variant,
      resolvedOutputLanguage: languageResolution?.outputLanguage ?? variant.resolvedOutputLanguage,
      resolvedTagLanguage: languageResolution?.tagLanguage ?? variant.resolvedTagLanguage,
    });
    if (languageResolution !== undefined) this.variantLanguageResolutions.set(key, languageResolution);
    if (!this.analyses.has(variant.fingerprint)) this.analyses.set(variant.fingerprint, variant);
    return Promise.resolve(ok(undefined));
  }

  getVariantLanguageResolution(fingerprint: string, configId: string): Promise<Result<AnalysisLanguageResolution | null, AppError>> {
    return Promise.resolve(ok(this.variantLanguageResolutions.get(`${fingerprint}\u0000${configId}`) ?? null));
  }

  async deleteVariant(fingerprint: string, configId: string): Promise<Result<void, AppError>> {
    const variants = [...this.variants.values()].filter((variant) => variant.fingerprint === fingerprint);
    if (variants.some((variant) => variant.configId === configId) && variants.length === 1) {
      return { ok: false, error: appError('conflict', 'Cannot delete the last analysis variant') };
    }
    const selected = await this.getSelectedConfigId(fingerprint);
    const key = `${fingerprint}\u0000${configId}`;
    this.variants.delete(key);
    this.variantLanguageResolutions.delete(key);
    if (selected.ok && selected.value === configId) {
      const promoted = variants
        .filter((variant) => variant.configId !== configId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId))[0];
      if (promoted !== undefined) {
        this.selectedConfigIds.set(fingerprint, promoted.configId);
        this.analyses.set(fingerprint, promoted);
      }
    }
    return ok(undefined);
  }

  clearAnalysisVariants(fingerprint: string): Promise<Result<void, AppError>> {
    for (const [key, variant] of this.variants) {
      if (variant.fingerprint === fingerprint) {
        this.variants.delete(key);
        this.variantLanguageResolutions.delete(key);
      }
    }
    this.analyses.delete(fingerprint);
    this.selectedConfigIds.delete(fingerprint);
    return Promise.resolve(ok(undefined));
  }

  setSelectedVariant(fingerprint: string, configId: string | null): Promise<Result<void, AppError>> {
    if (configId === null) {
      this.selectedConfigIds.delete(fingerprint);
      return Promise.resolve(ok(undefined));
    }
    const variant = this.variants.get(`${fingerprint}\u0000${configId}`);
    if (variant !== undefined) {
      this.selectedConfigIds.set(fingerprint, configId);
      this.analyses.set(fingerprint, variant);
    }
    return Promise.resolve(ok(undefined));
  }

  getSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>> {
    const explicit = this.selectedConfigIds.get(fingerprint);
    if (explicit !== undefined && this.variants.has(`${fingerprint}\u0000${explicit}`)) {
      return Promise.resolve(ok(explicit));
    }
    const file = this.files.get(fingerprint);
    const folderDefault = file === undefined ? undefined : this.folderDefaultVariants.get(file.folderId);
    if (folderDefault !== undefined && this.variants.has(`${fingerprint}\u0000${folderDefault}`)) {
      return Promise.resolve(ok(folderDefault));
    }
    const newest = [...this.variants.values()]
      .filter((variant) => variant.fingerprint === fingerprint)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId))[0];
    return Promise.resolve(ok(newest?.configId ?? null));
  }

  getExplicitSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.selectedConfigIds.get(fingerprint) ?? null));
  }

  getFolderDefaultConfigId(folderId: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.folderDefaultVariants.get(folderId) ?? null));
  }

  setFolderDefaultVariant(folderId: string, configId: string | null): Promise<Result<void, AppError>> {
    if (configId === null) this.folderDefaultVariants.delete(folderId);
    else this.folderDefaultVariants.set(folderId, configId);
    return Promise.resolve(ok(undefined));
  }

  listAnalyzedFileLocations(fingerprints: readonly string[]): Promise<Result<AnalyzedFileLocation[], AppError>> {
    const locations = [...new Set(fingerprints)]
      .map((fingerprint) => {
        const file = this.files.get(fingerprint);
        const analysis = this.analyses.get(fingerprint);
        if (file === undefined || analysis === undefined) return null;
        return {
          fingerprint,
          folderId: file.folderId,
          fileName: file.fileName,
          finalName: analysis.finalName,
          folderPath: this.folders.get(file.folderId)?.currentPath ?? null,
        };
      })
      .filter((location): location is AnalyzedFileLocation => location !== null)
      .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    return Promise.resolve(ok(locations));
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

  listTagAliases(): Promise<Result<CatalogTagAlias[], AppError>> {
    return Promise.resolve(ok([]));
  }

  expandTagTerms(): Promise<Result<TagTermExpansion[], AppError>> {
    return Promise.resolve(ok([]));
  }

  search(input: CatalogSearchInput): Promise<Result<CatalogSearchResults, AppError>> {
    const matched = [...this.files.values()]
      .map((file) => {
        const analysis = this.analyses.get(file.fingerprint) ?? null;
        const folder = this.folders.get(file.folderId);
        if (folder === undefined) return null;
        if (input.match === null) {
          return {
            fingerprint: file.fingerprint,
            variantCount: [...this.variants.values()].filter((variant) => variant.fingerprint === file.fingerprint).length,
            fileName: file.fileName,
            finalName: analysis?.finalName ?? null,
            description: analysis?.description ?? null,
            snippet: analysis?.description ?? file.fileName,
            tags: analysis?.tags ?? [],
            folder,
            gps: file.gpsLat === null || file.gpsLon === null ? null : { lat: file.gpsLat, lon: file.gpsLon },
            missing: file.missingAt !== null,
            score: 1,
            capturedAt: file.capturedAt,
            place: file.place,
            width: file.width,
            height: file.height,
          };
        }
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
          variantCount: [...this.variants.values()].filter((variant) => variant.fingerprint === file.fingerprint).length,
          fileName: file.fileName,
          finalName: analysis?.finalName ?? null,
          description: analysis?.description ?? null,
          snippet: analysis?.description ?? file.fileName,
          tags: analysis?.tags ?? [],
          folder,
          gps: file.gpsLat === null || file.gpsLon === null ? null : { lat: file.gpsLat, lon: file.gpsLon },
          missing: file.missingAt !== null,
          score: 1,
          capturedAt: file.capturedAt,
          place: file.place,
          width: file.width,
          height: file.height,
        };
      })
      .filter((row): row is CatalogSearchRow => row !== null);
    const rows = matched.slice(input.offset, input.offset + input.limit);
    return Promise.resolve(ok({ total: matched.length, rows }));
  }

  listLocations(): Promise<Result<CatalogLocationsSnapshot, AppError>> {
    const rows = [...this.files.values()]
      .map((file) => {
        if (file.gpsLat === null || file.gpsLon === null) return null;
        const folder = this.folders.get(file.folderId);
        if (folder === undefined) return null;
        const analysis = this.analyses.get(file.fingerprint) ?? null;
        return {
          fingerprint: file.fingerprint,
          fileName: file.fileName,
          finalName: analysis?.finalName ?? null,
          lat: file.gpsLat,
          lon: file.gpsLon,
          missing: file.missingAt !== null,
          folder,
          source: file.gpsSource,
          accuracyM: file.gpsAccuracyM,
          intervalKind: file.gpsIntervalKind,
          place: file.place,
        };
      })
      .filter((row): row is CatalogLocationRow => row !== null)
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
    return Promise.resolve(ok({ totalFiles: this.files.size, rows }));
  }

  listLibraryFacets(): Promise<Result<LibraryFacets, AppError>> {
    const tagCounts = new Map<string, number>();
    for (const analysis of this.analyses.values()) {
      for (const tag of analysis.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    const tags = [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const peopleCounts = new Map<string, number>();
    for (const observation of this.faceObservations.values()) {
      if (observation.personId === null) continue;
      peopleCounts.set(observation.personId, (peopleCounts.get(observation.personId) ?? 0) + 1);
    }
    const people = [...peopleCounts.entries()]
      .map(([personId, count]) => ({ personId, displayName: this.people.get(personId)?.displayName ?? null, count }))
      .sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '') || left.personId.localeCompare(right.personId));

    const placeCounts = new Map<string, { name: string; country: string | null; countryCode: string | null; count: number }>();
    for (const file of this.files.values()) {
      if (file.place === null) continue;
      const key = `${file.place.name} ${file.place.country ?? ''} ${file.place.countryCode ?? ''}`;
      const existing = placeCounts.get(key);
      if (existing === undefined) {
        placeCounts.set(key, { name: file.place.name, country: file.place.country, countryCode: file.place.countryCode, count: 1 });
      } else {
        existing.count += 1;
      }
    }
    const places = [...placeCounts.values()].sort((left, right) => left.name.localeCompare(right.name));

    const yearCounts = new Map<string, number>();
    for (const file of this.files.values()) {
      if (file.capturedAt === null) continue;
      const year = file.capturedAt.slice(0, 4);
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    }
    const years = [...yearCounts.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((left, right) => right.year.localeCompare(left.year));

    const files = [...this.files.values()];
    const counts = {
      total: files.length,
      withGps: files.filter((file) => file.gpsLat !== null && file.gpsLon !== null).length,
      withoutCaptureDate: files.filter((file) => file.capturedAt === null).length,
      missing: files.filter((file) => file.missingAt !== null).length,
    };

    const facetFolders = [...this.folders.values()]
      .map((folder) => ({
        folderId: folder.folderId,
        displayName: folder.displayName,
        currentPath: folder.currentPath,
        count: files.filter((file) => file.folderId === folder.folderId).length,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    return Promise.resolve(ok({ tags, people, places, years, folders: facetFolders, counts }));
  }

  listPeopleForFile(fingerprint: string): Promise<Result<CatalogFilePerson[], AppError>> {
    const personIds = new Set<string>();
    for (const observation of this.faceObservations.values()) {
      if (observation.fingerprint === fingerprint && observation.personId !== null) personIds.add(observation.personId);
    }
    const result = [...personIds]
      .map((personId) => ({ personId, displayName: this.people.get(personId)?.displayName ?? null }))
      .sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '') || left.personId.localeCompare(right.personId));
    return Promise.resolve(ok(result));
  }

  listFingerprintsForPeople(
    input: { personIds: readonly string[]; media: FaceObservation['media'] },
  ): Promise<Result<string[], AppError>> {
    const wanted = new Set(input.personIds);
    const fingerprints = new Set<string>();
    for (const observation of this.faceObservations.values()) {
      if (observation.personId === null || !wanted.has(observation.personId)) continue;
      if (observation.media !== input.media) continue;
      fingerprints.add(observation.fingerprint);
    }
    return Promise.resolve(ok([...fingerprints].sort(compareUtf8Bytes)));
  }

  listGeoBackfillCandidates(input: { root: string | null }): Promise<Result<GeoBackfillCandidate[], AppError>> {
    const root = input.root === null ? null : canonicalPath(input.root);
    const rows = [...this.files.values()]
      .filter((file) => file.missingAt === null)
      .map((file) => {
        const folder = this.folders.get(file.folderId);
        if (folder === undefined) return null;
        if (root !== null && folder.currentPath !== root && !folder.currentPath.startsWith(`${root}/`)) return null;
        const candidate: GeoBackfillCandidate = {
          fingerprint: file.fingerprint,
          folderId: folder.folderId,
          folderPath: folder.currentPath,
          fileName: file.fileName,
          capturedAt: file.capturedAt,
          gpsLat: file.gpsLat,
          gpsLon: file.gpsLon,
          gpsSource: file.gpsSource,
          placeName: file.place?.name ?? null,
        };
        return candidate;
      })
      .filter((row): row is GeoBackfillCandidate => row !== null)
      .sort((left, right) => `${left.folderPath}/${left.fileName}`.localeCompare(`${right.folderPath}/${right.fileName}`));
    return Promise.resolve(ok(rows));
  }

  applyGeoBackfill(input: ApplyGeoBackfillInput): Promise<Result<ApplyGeoBackfillResult, AppError>> {
    const existing = this.files.get(input.fingerprint);
    if (existing === undefined) return Promise.resolve(ok('skipped_precedence'));

    let outcome: ApplyGeoBackfillResult = 'unchanged';
    const nextCapturedAt = input.capturedAt === undefined ? existing.capturedAt : input.capturedAt.at;
    const nextCapturedAtSource = input.capturedAt === undefined ? existing.capturedAtSource : input.capturedAt.source;
    if (input.capturedAt !== undefined && existing.capturedAt !== input.capturedAt.at) outcome = 'written';

    let nextGpsLat = existing.gpsLat;
    let nextGpsLon = existing.gpsLon;
    let nextGpsSource = existing.gpsSource;
    let nextAccuracyM = existing.gpsAccuracyM;
    let nextIntervalKind = existing.gpsIntervalKind;
    let nextResolvedAt = existing.gpsResolvedAt;
    if (input.location !== undefined) {
      const accepted = acceptsGpsWrite(
        { lat: existing.gpsLat, lon: existing.gpsLon, source: existing.gpsSource },
        { lat: input.location.lat, lon: input.location.lon, source: input.location.source },
      );
      if (!accepted) {
        if (outcome !== 'written') outcome = 'skipped_precedence';
      } else {
        const unchanged = existing.gpsLat === input.location.lat && existing.gpsLon === input.location.lon
          && existing.gpsIntervalKind === input.location.intervalKind;
        nextGpsLat = input.location.lat;
        nextGpsLon = input.location.lon;
        nextGpsSource = input.location.source;
        nextAccuracyM = input.location.accuracyM;
        nextIntervalKind = input.location.intervalKind;
        nextResolvedAt = input.location.resolvedAt;
        if (!unchanged) outcome = 'written';
      }
    }

    let nextPlace = existing.place;
    if (input.place !== undefined && JSON.stringify(existing.place) !== JSON.stringify(input.place)) {
      nextPlace = input.place;
      outcome = 'written';
    }

    if (outcome === 'written') {
      this.files.set(input.fingerprint, {
        ...existing,
        capturedAt: nextCapturedAt,
        capturedAtSource: nextCapturedAtSource,
        gpsLat: nextGpsLat,
        gpsLon: nextGpsLon,
        gpsSource: nextGpsSource,
        gpsAccuracyM: nextAccuracyM,
        gpsIntervalKind: nextIntervalKind,
        gpsResolvedAt: nextResolvedAt,
        place: nextPlace,
      });
    }
    return Promise.resolve(ok(outcome));
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
    for (const key of this.variants.keys()) {
      if (key.startsWith(`${fingerprint}\u0000`)) this.variants.delete(key);
    }
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
      analyses: this.variants.size,
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

  listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexScope, AppError>> {
    const canonicalRoot = canonicalPath(rootPath);
    const matchedFolderIds = new Set(
      [...this.folders.values()]
        .filter((folder) => folder.currentPath === canonicalRoot || folder.currentPath.startsWith(`${canonicalRoot}${path.sep}`))
        .map((folder) => folder.folderId),
    );
    const candidates: FaceIndexCandidate[] = [];
    let filesInScope = 0;
    for (const file of this.files.values()) {
      const folder = this.folders.get(file.folderId);
      if (folder === undefined || !matchedFolderIds.has(folder.folderId)) continue;
      const analysis = this.analyses.get(file.fingerprint);
      if (analysis === undefined) continue;
      filesInScope += 1;
      const state = this.faceIndexState.get(file.fingerprint);
      if (state !== undefined && state.engineVersion >= FACE_ENGINE_VERSION) continue;
      candidates.push({ file, analysis, folder, previousEngineVersion: state?.engineVersion ?? null });
    }
    return Promise.resolve(ok({ foldersMatched: matchedFolderIds.size, filesInScope, candidates }));
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
      videosIndexed: new Set(observations.filter((observation) => observation.media === 'video').map((observation) => observation.fingerprint)).size,
      photosWithFaces: new Set(observations.filter((observation) => observation.media === 'photo').map((observation) => observation.fingerprint)).size,
      staleVersionFiles: [...this.faceIndexState.values()].filter((state) => state.engineVersion < FACE_ENGINE_VERSION).length,
    }));
  }

  replaceFaceClustering(input: {
    people: readonly Person[];
    assignments: readonly { obsId: string; personId: string | null }[];
  }): Promise<Result<{
    personsDeleted: number;
    personsCreated: number;
    observationsReassigned: number;
    affectedFingerprints: string[];
  }, AppError>> {
    const personsDeleted = this.people.size;
    this.people.clear();
    for (const person of input.people) this.people.set(person.personId, person);
    let observationsReassigned = 0;
    const affected = new Set<string>();
    for (const assignment of input.assignments) {
      const existing = this.faceObservations.get(assignment.obsId);
      if (existing === undefined) continue;
      if (existing.personId !== assignment.personId) {
        observationsReassigned += 1;
        affected.add(existing.fingerprint);
      }
      this.faceObservations.set(assignment.obsId, { ...existing, personId: assignment.personId });
    }
    return Promise.resolve(ok({
      personsDeleted,
      personsCreated: input.people.length,
      observationsReassigned,
      affectedFingerprints: [...affected],
    }));
  }

  private affectedFingerprints(personId: string): string[] {
    return [...new Set([...this.faceObservations.values()]
      .filter((observation) => observation.personId === personId)
      .map((observation) => observation.fingerprint))];
  }
}

class InMemorySpendLedger implements SpendLedgerPort {
  private readonly entries: SpendLedgerEntry[] = [];

  append(entry: SpendLedgerEntry): Promise<Result<void, AppError>> {
    this.entries.push(structuredClone(entry));
    return Promise.resolve(ok(undefined));
  }

  total(input: {
    provider: 'gemini';
    month?: string | undefined;
    runId?: string | undefined;
  }): Promise<Result<SpendLedgerTotal, AppError>> {
    const matching = this.entries.filter((entry) =>
      entry.provider === input.provider
      && (input.month === undefined || entry.month === input.month)
      && (input.runId === undefined || entry.runId === input.runId));
    return Promise.resolve(ok({
      entries: matching.length,
      estimatedCostUsd: matching.reduce((total, entry) => total + entry.estimatedCostUsd, 0),
    }));
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

  delete(scope: ConfigScope, key: ConfigKey): Promise<Result<{ previousValue: string | null }, AppError>> {
    const values = this.scopeValues(scope);
    const previousValue = values.get(key) ?? null;
    values.delete(key);
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
  private readonly files: Set<string>;
  private readonly textFiles: Map<string, string>;

  constructor(
    private readonly workingDirectory: string,
    files: readonly string[],
    textFiles: Readonly<Record<string, string>>,
  ) {
    this.files = new Set(files.map((file) => path.resolve(workingDirectory, file)));
    this.textFiles = new Map(Object.entries(textFiles).map(([file, content]) => [path.resolve(workingDirectory, file), content]));
    for (const file of this.textFiles.keys()) this.files.add(file);
  }

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

  isFile(value: string): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.files.has(path.resolve(this.workingDirectory, value))));
  }

  exists(value: string): Promise<Result<boolean, AppError>> {
    const resolved = path.resolve(this.workingDirectory, value);
    return Promise.resolve(ok(
      resolved === path.resolve(this.workingDirectory)
      || this.files.has(resolved),
    ));
  }

  listDirectory(): Promise<Result<DirectoryEntry[], AppError>> {
    return Promise.resolve(ok([]));
  }

  stat(): Promise<Result<FileStat, AppError>> {
    return Promise.resolve({ ok: false, error: appError('file_not_found', 'File not found') });
  }

  readTextFile(value: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.textFiles.get(path.resolve(this.workingDirectory, value)) ?? null));
  }

  writeTextFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  ensureDirectory(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  linkFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  copyFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  renamePath(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  deleteFile(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  deletePath(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  partialContentHash(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(null));
  }

  fullContentHash(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(null));
  }

  isWritable(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(true));
  }

  tempDirectory(): string {
    return '/tmp';
  }

  homeDirectory(): string {
    return path.join(this.workingDirectory, 'home');
  }
}

export class InMemoryPlacesPort implements PlacesPort {
  matches = new Map<string, { name: string; region: string | null; country: string | null; countryCode: string | null; dataset: string }>();
  installed = false;

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({
      name: 'places',
      available: this.installed,
      version: this.installed ? 'in-memory-places' : null,
      source: this.installed ? 'configured' : null,
      path: null,
      installHint: 'avc models places install',
      warning: this.installed ? undefined : 'Offline place names are not installed.',
    }));
  }

  isReady(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(this.installed));
  }

  resolve(input: { lat: number; lon: number }): Promise<Result<{ name: string; region: string | null; country: string | null; countryCode: string | null; distanceM: number; dataset: string } | null, AppError>> {
    if (!this.installed) return Promise.resolve({ ok: false, error: appError('model_not_installed', 'Offline place dataset is not installed') });
    const key = `${input.lat.toFixed(1)}|${input.lon.toFixed(1)}`;
    const match = this.matches.get(key);
    return Promise.resolve(ok(match === undefined ? null : { ...match, distanceM: 10 }));
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
      createdAtUtc: null,
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

  thumbnailFromFrame(input: ThumbnailFromFrameInput): Promise<Result<ThumbnailGeneration, AppError>> {
    return Promise.resolve(ok({ path: input.thumbnailPath, generated: input.force, skipped: !input.force }));
  }

  dependencies(): Promise<Result<DependencyStatus[], AppError>> {
    return Promise.resolve(ok([dependency('ffmpeg', false), dependency('ffprobe', false)]));
  }
}

class InMemoryTranscriberPort implements TranscriberPort {
  transcribe(): ReturnType<TranscriberPort['transcribe']> {
    return Promise.resolve(ok({ transcriptPath: '', content: '', filteredSegments: 0 }));
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
  promptVersion(): number {
    return 1;
  }

  analyze(): Promise<Result<{ rawResponse: string }, AppError>> {
    return Promise.resolve(ok({ rawResponse: 'DESCRIPTION: Placeholder analysis\nFILENAME: placeholder-video' }));
  }

  analyzePhotos(input: AnalyzePhotosInput): Promise<Result<AnalyzePhotosOutput, AppError>> {
    const elements = input.items.map((item, index) => ({
      index: index + 1,
      description: `photo:${item.fingerprint}`,
      tags: ['placeholder'],
      scene: 'other',
      quality: 'good',
    }));
    return Promise.resolve(ok({ rawResponse: JSON.stringify(elements) }));
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
  private readonly fileArtifactSizes = new Map<string, number>();
  private readonly fileArtifactHashes = new Map<string, string>();

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

  async isFileArtifactDownloaded(artifact: FileArtifact): Promise<Result<boolean, AppError>> {
    const status = await this.fileArtifactStatus(artifact);
    if (!status.ok) return status;
    return ok(status.value.valid);
  }

  fileArtifactStatus(artifact: FileArtifact): Promise<Result<FileArtifactStatus, AppError>> {
    if (!this.fileArtifacts.has(artifact.id)) {
      return Promise.resolve(ok({
        downloaded: false,
        valid: false,
        sizeBytes: null,
        sha256: null,
        reason: 'File is missing.',
        remedy: 'Run: ai-video-cataloger models faces install --force',
      }));
    }
    const sizeBytes = this.fileArtifactSizes.get(artifact.id) ?? artifact.bytes;
    if (artifact.bytes !== null && sizeBytes !== artifact.bytes) {
      return Promise.resolve(ok({
        downloaded: true,
        valid: false,
        sizeBytes,
        sha256: null,
        reason: `Expected ${String(artifact.bytes)} bytes but found ${String(sizeBytes)}.`,
        remedy: 'Run: ai-video-cataloger models faces install --force',
      }));
    }
    const sha256 = this.fileArtifactHashes.get(artifact.id) ?? artifact.sha256;
    if (sha256 !== artifact.sha256) {
      return Promise.resolve(ok({
        downloaded: true,
        valid: false,
        sizeBytes,
        sha256,
        reason: 'SHA-256 checksum does not match the face model manifest.',
        remedy: 'Run: ai-video-cataloger models faces install --force',
      }));
    }
    return Promise.resolve(ok({
      downloaded: true,
      valid: true,
      sizeBytes,
      sha256,
      reason: null,
      remedy: null,
    }));
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
    if (artifact.bytes !== null) this.fileArtifactSizes.set(artifact.id, artifact.bytes);
    this.fileArtifactHashes.set(artifact.id, artifact.sha256);
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

  align(frame: FaceFrameInput | string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    const normalized = typeof frame === 'string' ? { kind: 'image-path' as const, frameJpegPath: frame } : frame;
    return Promise.resolve(ok({ frame: normalized, detection, width: 112, height: 112 }));
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
