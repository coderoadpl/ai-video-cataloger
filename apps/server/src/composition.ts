import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import packageJson from '../../../package.json' with { type: 'json' };
import { z } from 'zod';

import {
  HarnessAnalyzerAdapter,
  OllamaAnalyzerAdapter,
  OpenAiCompatibleAnalyzerAdapter,
} from '@adapters/analyzers/index.js';
import { JsonCredentialsStore, KeychainCredentialsStore, NdjsonMigrationLog } from '@adapters/credentials/index.js';
import {
  HomeLock,
  JsonConfigStore,
  SqlJsCatalogRepositoryFactory,
  SqlJsGlobalCatalogStore,
  SqlJsPhotosStore,
} from '@adapters/db/index.js';
import { ExifrExifAdapter } from '@adapters/exif/index.js';
import { NodeCliPathAdapter } from '@adapters/cli-path/index.js';
import { OnnxFaceEngineAdapter } from '@adapters/faces/index.js';
import { FfmpegMediaAdapter } from '@adapters/ffmpeg/index.js';
import { GeminiNativeAnalyzerAdapter } from '@adapters/gemini/index.js';
import { GeoNamesPlacesAdapter } from '@adapters/places/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { SipsPhotoMediaAdapter } from '@adapters/photo-media/index.js';
import { NodeFolderWatcherPort } from '@adapters/fs/folder-watcher.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import { ManagedOllamaRuntimeAdapter } from '@adapters/ollama-runtime/index.js';
import { KeychainSecretsAdapter } from '@adapters/secrets/index.js';
import { NdjsonSpendLedger } from '@adapters/spend-ledger/index.js';
import { ManagedWhisperRuntimeAdapter } from '@adapters/whisper-runtime/index.js';
import { HuggingFaceWhisperModelDownloader, WhisperTranscriberAdapter } from '@adapters/whisper/index.js';
import {
  appError,
  ok,
  type AnalyzerProviderConfig,
  type AppError,
  type BackupTier,
  type ConfigKey,
  type CredentialDeletion,
  type CredentialsBackendStatus,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';
import { ReadinessCache } from '@core/server/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzePhotosInput,
  AnalyzePhotosOutput,
  AnalyzerBatchPort,
  AnalyzerPort,
  BackupConnectRequest,
  BackupConnectResult,
  BackupConnectionReport,
  BackupDestinationPort,
  BackupEnableRequest,
  BackupStatusView,
  CatalogRepositoryFactory,
  ConfigScope,
  ConfigStore,
  CredentialsStore,
  CredentialValueConflict,
  DependencyStatus,
  ExifPort,
  FaceEnginePort,
  CliPathPort,
  FileSavePort,
  FileSystemPort,
  FolderWatcherPort,
  GlobalCatalogStore,
  JobsPort,
  JobExecutionContext,
  JobKind,
  JobRecord,
  CatalogLockProcessName,
  LocalAiRuntimePort,
  MediaPort,
  ModelDownloadPort,
  PhotoMediaPort,
  PhotosStore,
  PlacesPort,
  ProvidersPort,
  ProviderTestResult,
  SpendLedgerPort,
  TranscriberPort,
  WhisperRuntimePort,
} from '@core/server/index.js';

import { createGoogleBackupDestination } from './backup-destination.js';
import { createBackupLifecycle } from './backup-lifecycle.js';

const unavailableSaveDialog = (): Result<{ path: string } | null, AppError> => ({
  ok: false,
  error: appError('unavailable', 'A native save dialog is not available in this process'),
});

const CLI_COMMAND_NAME = 'ai-video-cataloger';
const CLI_OWNED_INSTALL_PATHS = ['/usr/local/bin/ai-video-cataloger'];

export interface AppDeps {
  version: string;
  cliPath: CliPathPort;
  catalogs: CatalogRepositoryFactory;
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  photoMedia: PhotoMediaPort;
  exif: ExifPort;
  config: ConfigStore;
  credentials: CredentialsStore;
  fs: FileSystemPort;
  folderWatcher: FolderWatcherPort;
  media: MediaPort;
  transcriber: TranscriberPort;
  whisperRuntime: WhisperRuntimePort;
  analyzer: AnalyzerPort;
  analyzerBatch?: AnalyzerBatchPort | undefined;
  providers: ProvidersPort;
  spendLedger: SpendLedgerPort;
  localAi: LocalAiRuntimePort;
  downloads: ModelDownloadPort;
  faceEngine: FaceEnginePort;
  places: PlacesPort;
  jobs: JobsPort;
  backupDestination(): Promise<Result<BackupDestinationPort, AppError>>;
  cleanupBackupStaging(): Promise<Result<void, AppError>>;
  evaluateScheduledBackup(): Promise<Result<void, AppError>>;
  listBackups(tier: BackupTier | null, signal: AbortSignal): Promise<Result<RemoteBackup[], AppError>>;
  restoreBackup(input: { remoteId: string; recoveryKey?: string | undefined }): Promise<Result<{ jobId: string }, AppError>>;
  backupStatus(input: { testConnection: boolean }): Promise<Result<BackupStatusView, AppError>>;
  connectBackup(request: BackupConnectRequest, signal: AbortSignal): Promise<Result<BackupConnectResult, AppError>>;
  testBackup(signal: AbortSignal): Promise<Result<{ connection: BackupConnectionReport }, AppError>>;
  enableBackup(request: BackupEnableRequest): Promise<Result<{ enabled: true; jobId: string | null }, AppError>>;
  disableBackup(request: { purgeCredentials: boolean }): Promise<Result<{ enabled: false }, AppError>>;
  exportBackupRecoveryKey(): Promise<Result<{ fingerprint: string; path: string }, AppError>>;
  confirmBackupRecoveryKey(): Promise<Result<{ confirmed: true }, AppError>>;
  runBackup(request: { tier: BackupTier }): Promise<Result<{ jobId: string }, AppError>>;
  readiness: ReadinessCache;
}

export interface AppConfig {
  version?: string;
  workingDirectory?: string;
  homeDirectory?: string;
  dbDriver?: 'sql-js' | 'memory';
  isPackaged?: boolean;
  processName?: CatalogLockProcessName | undefined;
  catalogLockMode?: 'lazy' | 'eager' | undefined;
  openExternal?: ((url: string) => Promise<void>) | undefined;
  saveFile?: FileSavePort['save'] | undefined;
  googleOAuthClientId?: string | undefined;
  googleOAuthClientSecret?: string | undefined;
}

export interface InMemoryDepsConfig {
  version: string;
  workingDirectory: string;
  saveFile?: FileSavePort['save'] | undefined;
}

export type InMemoryDepsFactory = (config: InMemoryDepsConfig) => AppDeps;

export const createDeps = (config: AppConfig = {}, inMemoryDepsFactory?: InMemoryDepsFactory): AppDeps => {
  const dbDriver = config.dbDriver ?? dbDriverFromEnv(process.env.DB_DRIVER);
  const workingDirectory = config.workingDirectory ?? process.cwd();
  const homeDirectory = config.homeDirectory;
  if (config.isPackaged === true && dbDriver === 'memory') {
    throw new Error('Invalid configuration: packaged app does not support DB_DRIVER=memory');
  }
  if (dbDriver === 'memory') {
    if (inMemoryDepsFactory === undefined) {
      throw new Error('Invalid configuration: DB_DRIVER=memory requires the in-memory test-support composition');
    }
    return inMemoryDepsFactory({
      version: config.version ?? packageJson.version,
      workingDirectory,
      saveFile: config.saveFile,
    });
  }
  const readiness = new ReadinessCache();
  const jobs = new InvalidatingJobsPort(new InProcessJobsPort(), readiness);
  const secrets = new KeychainSecretsAdapter();
  const localAi = new ManagedOllamaRuntimeAdapter({ homeDirectory });
  const credentials = new InvalidatingCredentialsStore(
    new KeychainCredentialsStore(
      secrets,
      new JsonCredentialsStore({ homeDirectory }),
      { migrationLog: new NdjsonMigrationLog({ homeDirectory }) },
    ),
    readiness,
  );
  const harness = new HarnessAnalyzerAdapter({ homeDirectory });
  const configStore = new InvalidatingConfigStore(new JsonConfigStore({ homeDirectory }), readiness);
  const whisperRuntime = new ManagedWhisperRuntimeAdapter({ config: configStore, homeDirectory });
  const ollamaAnalyzer = new OllamaAnalyzerAdapter({ runtime: localAi });
  const apiAnalyzer = new OpenAiCompatibleAnalyzerAdapter({ credentials });
  const geminiAnalyzer = new GeminiNativeAnalyzerAdapter({
    credentials,
    onWarning: (message) => {
      console.warn(`[gemini] ${message}`);
    },
  });
  const downloads = new HuggingFaceWhisperModelDownloader({ homeDirectory });
  const catalogLock = new HomeLock({
    homeDirectory: homeDirectory ?? homedir(),
    processName: config.processName ?? 'cli',
    lockMode: config.catalogLockMode ?? 'lazy',
  });
  const resolvedHomeDirectory = homeDirectory ?? homedir();
  const globalCatalog = new SqlJsGlobalCatalogStore({
    homeDirectory,
    lock: catalogLock,
    processName: config.processName ?? 'cli',
    lockMode: config.catalogLockMode ?? 'lazy',
  });
  const photos = new SqlJsPhotosStore({
    homeDirectory,
    lock: catalogLock,
    processName: config.processName ?? 'cli',
    lockMode: config.catalogLockMode ?? 'lazy',
  });
  const fs = new NodeFileSystemPort({ workingDirectory, homeDirectory });
  const backupDestination = () => createGoogleBackupDestination({
    config: configStore,
    secrets,
    oauthClientId: config.googleOAuthClientId ?? process.env.AVC_GOOGLE_OAUTH_CLIENT_ID ?? '',
    oauthClientSecret: config.googleOAuthClientSecret ?? process.env.AVC_GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    openExternal: config.openExternal ?? (() => Promise.reject(new Error('System browser integration is unavailable'))),
    driveBaseUrl: process.env.AVC_GOOGLE_DRIVE_BASE_URL,
    uploadBaseUrl: process.env.AVC_GOOGLE_UPLOAD_BASE_URL,
  });
  const backupLifecycle = createBackupLifecycle({
    homeDirectory: resolvedHomeDirectory,
    appVersion: config.version ?? packageJson.version,
    fs,
    globalCatalog,
    photos,
    config: configStore,
    secrets,
    jobs,
    destination: backupDestination,
    fileSave: { save: config.saveFile ?? (() => Promise.resolve(unavailableSaveDialog())) },
  });
  return {
    version: config.version ?? packageJson.version,
    cliPath: new NodeCliPathAdapter({ commandName: CLI_COMMAND_NAME, ownedInstallPaths: CLI_OWNED_INSTALL_PATHS }),
    catalogs: new SqlJsCatalogRepositoryFactory(),
    globalCatalog,
    photos,
    photoMedia: new SipsPhotoMediaAdapter(),
    exif: new ExifrExifAdapter(),
    config: configStore,
    credentials,
    fs,
    folderWatcher: new NodeFolderWatcherPort(),
    media: new FfmpegMediaAdapter(),
    transcriber: new WhisperTranscriberAdapter({ credentials, homeDirectory, runtime: whisperRuntime }),
    whisperRuntime,
    analyzer: new ProviderRoutingAnalyzerAdapter(harness, ollamaAnalyzer, apiAnalyzer, geminiAnalyzer),
    analyzerBatch: geminiAnalyzer,
    providers: new ProviderRoutingProvidersPort(harness, ollamaAnalyzer, apiAnalyzer, geminiAnalyzer),
    spendLedger: new NdjsonSpendLedger({ homeDirectory }),
    localAi,
    downloads,
    faceEngine: new OnnxFaceEngineAdapter({ downloads }),
    places: new GeoNamesPlacesAdapter({ fs: new NodeFileSystemPort({ workingDirectory, homeDirectory }), datasetPath: null }),
    jobs,
    backupDestination,
    cleanupBackupStaging: backupLifecycle.cleanup,
    evaluateScheduledBackup: backupLifecycle.evaluate,
    listBackups: backupLifecycle.list,
    restoreBackup: backupLifecycle.restore,
    backupStatus: backupLifecycle.status,
    connectBackup: backupLifecycle.connect,
    testBackup: backupLifecycle.test,
    enableBackup: backupLifecycle.enable,
    disableBackup: backupLifecycle.disable,
    exportBackupRecoveryKey: backupLifecycle.exportRecoveryKey,
    confirmBackupRecoveryKey: backupLifecycle.confirmRecoveryKey,
    runBackup: backupLifecycle.run,
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

// Required<> is the guard: an optional port method the wrapper forgets to forward is a
// compile error here, not a capability that silently disappears behind the decorator.
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

class ProviderRoutingProvidersPort implements ProvidersPort {
  constructor(
    private readonly harness: ProvidersPort,
    private readonly local: ProvidersPort,
    private readonly api: ProvidersPort,
    private readonly gemini: ProvidersPort,
  ) {}

  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family === 'gemini-native') return this.gemini.test(config);
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
    private readonly gemini: AnalyzerPort,
  ) {}

  promptVersion(provider: AnalyzerProviderConfig): number {
    if (provider.family === 'gemini-native') return this.gemini.promptVersion(provider);
    if (provider.family === 'api') return this.api.promptVersion(provider);
    if (provider.family === 'local') return this.local.promptVersion(provider);
    return this.harness.promptVersion(provider);
  }

  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    if (input.provider?.family === 'gemini-native') return this.gemini.analyze(input);
    if (input.provider?.family === 'api') return this.api.analyze(input);
    return input.backend === 'local' ? this.local.analyze(input) : this.harness.analyze(input);
  }

  analyzePhotos(input: AnalyzePhotosInput): Promise<Result<AnalyzePhotosOutput, AppError>> {
    if (input.provider.family === 'gemini-native') return this.gemini.analyzePhotos(input);
    if (input.provider.family === 'api') return this.api.analyzePhotos(input);
    return input.provider.family === 'local' ? this.local.analyzePhotos(input) : this.harness.analyzePhotos(input);
  }

  dependency(input?: { backend: AnalyzeInput['backend']; provider?: AnalyzeInput['provider'] }): Promise<Result<DependencyStatus, AppError>> {
    if (input?.provider?.family === 'gemini-native') return this.gemini.dependency(input);
    if (input?.provider?.family === 'api') return this.api.dependency(input);
    return input?.backend === 'local' ? this.local.dependency(input) : this.harness.dependency(input);
  }
}

const dbDriverSchema = z.enum(['sql-js', 'memory']);

const dbDriverFromEnv = (value: string | undefined): 'sql-js' | 'memory' => {
  const parsed = dbDriverSchema.safeParse(value);
  return parsed.success ? parsed.data : 'sql-js';
};

export const inMemoryDbRequested = (): boolean => dbDriverFromEnv(process.env.DB_DRIVER) === 'memory';
