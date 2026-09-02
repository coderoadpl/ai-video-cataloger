import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

import { PHOTOS_SCHEMA_VERSION, sqlJsWasmConfig } from '@adapters/db/index.js';
import { BackupStateFile } from '@adapters/backup/state-store.js';
import {
  backupKeyFingerprint,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  ensureBackupRecoveryKey,
  loadBackupEncryptionKey,
  parseRecoveryKey,
} from '@adapters/backup/envelope.js';
import { extractTarZstd, writeTarZstd } from '@adapters/backup/tar.js';
import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  appError,
  ok,
  uiLanguageSchema,
  type AppError,
  type BackupTier,
  type Result,
} from '@core/domain/index.js';
import {
  cleanupBackupStaging,
  confirmBackupRecoveryKey,
  connectBackupDestination,
  createRecoveryKeyCeremony,
  disableBackup,
  enableBackup,
  enqueueBackup,
  enqueueRestore,
  evaluateScheduledBackup,
  exportBackupRecoveryKey,
  importBackupRecoveryKey,
  listBackups,
  performRestoreStartupRecovery,
  prepareBackupScope,
  readBackupSettings,
  readBackupStatus,
  runBackupNow,
  testBackupDestination,
  type BackupConnectRequest,
  type BackupConnectResult,
  type BackupConnectionReport,
  type BackupEnableRequest,
  type BackupEnablementDeps,
  type BackupListResult,
  type BackupRestoreDeps,
  type BackupRestoreInput,
  type BackupRunDeps,
  type BackupStatusView,
  type BackupDestinationPort,
  type ConfigStore,
  type FileSavePort,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobsPort,
  type PhotosStore,
  type SecretsStore,
} from '@core/server/index.js';

export interface BackupLifecycleOptions {
  homeDirectory: string;
  appVersion: string;
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  config: ConfigStore;
  secrets: SecretsStore;
  jobs: JobsPort;
  fileSave: FileSavePort;
  destination(): Promise<Result<BackupDestinationPort, AppError>>;
  now?: (() => Date) | undefined;
}

export interface BackupLifecycle {
  cleanup(): Promise<Result<void, AppError>>;
  evaluate(): Promise<Result<void, AppError>>;
  list(tier: BackupTier | null, signal: AbortSignal): Promise<Result<BackupListResult, AppError>>;
  restore(input: BackupRestoreInput): Promise<Result<{ jobId: string }, AppError>>;
  status(input: { testConnection: boolean }): Promise<Result<BackupStatusView, AppError>>;
  connect(request: BackupConnectRequest, signal: AbortSignal): Promise<Result<BackupConnectResult, AppError>>;
  test(signal: AbortSignal): Promise<Result<{ connection: BackupConnectionReport }, AppError>>;
  enable(request: BackupEnableRequest): Promise<Result<{ enabled: true; jobId: string | null }, AppError>>;
  disable(request: { purgeCredentials: boolean }): Promise<Result<{ enabled: false }, AppError>>;
  exportRecoveryKey(): Promise<Result<{ fingerprint: string; path: string }, AppError>>;
  confirmRecoveryKey(): Promise<Result<{ confirmed: true }, AppError>>;
  importRecoveryKey(request: { recoveryKey: string }): Promise<Result<{ fingerprint: string }, AppError>>;
  run(request: { tier: BackupTier }): Promise<Result<{ jobId: string }, AppError>>;
}

export const createBackupLifecycle = (options: BackupLifecycleOptions): BackupLifecycle => {
  const state = new BackupStateFile({ homeDirectory: options.homeDirectory });
  const now = options.now ?? (() => new Date());
  const runDeps = async (): Promise<Result<BackupRunDeps, AppError>> => {
    const destination = await options.destination();
    if (!destination.ok) return destination;
    return ok({
      homeDirectory: options.homeDirectory,
      appVersion: options.appVersion,
      fs: options.fs,
      globalCatalog: options.globalCatalog,
      photos: options.photos,
      destination: destination.value,
      state,
      now,
      loadEncryptionKey: () => loadBackupEncryptionKey(options.secrets),
      fingerprintKey: backupKeyFingerprint,
      archive: (entries, targetPath, createdAt, signal) => writeTarZstd(entries, targetPath, createdAt, { signal }),
      encrypt: encryptBackupEnvelope,
    });
  };
  const restoreDeps = async (): Promise<Result<BackupRestoreDeps, AppError>> => {
    const destination = await options.destination();
    if (!destination.ok) return destination;
    return ok({
      homeDirectory: options.homeDirectory,
      supportedSchemaVersions: { globalCatalog: GLOBAL_CATALOG_SCHEMA_VERSION, photos: PHOTOS_SCHEMA_VERSION },
      fs: options.fs,
      globalCatalog: options.globalCatalog,
      photos: options.photos,
      destination: destination.value,
      state,
      now,
      loadEncryptionKey: () => loadBackupEncryptionKey(options.secrets),
      parseRecoveryKey,
      verifyDatabase: verifySqliteIntegrity,
      decrypt: decryptBackupEnvelope,
      extract: extractTarZstd,
    });
  };
  const enqueueTier = async (
    input: { tier: BackupTier; keepLast: number; keepWeekly: number; manual: boolean },
  ): Promise<Result<{ jobId: string }, AppError>> => {
    const deps = await runDeps();
    if (!deps.ok) return deps;
    return enqueueBackup(options.jobs, deps.value, input);
  };
  const enqueue = async (): Promise<Result<{ jobId: string }, AppError>> => {
    const settings = await readBackupSettings(options.config);
    if (!settings.ok) return settings;
    const critical = await enqueueTier({
      tier: 'critical',
      keepLast: settings.value.keepLast,
      keepWeekly: settings.value.keepWeekly,
      manual: false,
    });
    if (!critical.ok) return critical;
    if (settings.value.includeOptional) {
      options.jobs.onSettled(critical.value.jobId, async () => {
        const completed = await options.jobs.get(critical.value.jobId);
        if (!completed.ok || completed.value?.status !== 'completed') return;
        await enqueueTier({
          tier: 'optional',
          keepLast: settings.value.keepLast,
          keepWeekly: settings.value.keepWeekly,
          manual: false,
        });
      });
    }
    return critical;
  };
  const enablementDeps: BackupEnablementDeps = {
    config: options.config,
    secrets: options.secrets,
    jobs: options.jobs,
    ceremony: createRecoveryKeyCeremony(),
    fileSave: options.fileSave,
    destination: options.destination,
    enqueueBackup: enqueueTier,
    recoveryKey: async () => {
      const locale = await options.config.get({ kind: 'home' }, 'ui_language');
      if (!locale.ok) return locale;
      const parsed = uiLanguageSchema.safeParse(locale.value ?? undefined);
      return ensureBackupRecoveryKey(options.secrets, parsed.success ? parsed.data : 'en');
    },
    parseRecoveryKey,
    fingerprintKey: backupKeyFingerprint,
  };
  return {
    cleanup: async () => {
      const recovered = await performRestoreStartupRecovery({ fs: options.fs, homeDirectory: options.homeDirectory });
      if (!recovered.ok) return recovered;
      return cleanupBackupStaging(options.fs, options.homeDirectory);
    },
    evaluate: async () => {
      const evaluated = await evaluateScheduledBackup({
        enabled: () => readEnabled(options.config),
        fingerprint: () => scheduledFingerprint(options),
        readState: () => state.read(),
        listJobs: () => options.jobs.list(),
        enqueue,
        now,
      });
      return evaluated.ok ? ok(undefined) : evaluated;
    },
    list: async (tier, signal) => {
      const destination = await options.destination();
      if (!destination.ok) return destination;
      return listBackups(destination.value, tier, signal);
    },
    restore: async (input) => {
      const deps = await restoreDeps();
      if (!deps.ok) return deps;
      return enqueueRestore(options.jobs, deps.value, input);
    },
    status: (input) => readBackupStatus({
      config: options.config,
      state,
      jobs: options.jobs,
      secrets: options.secrets,
      supportedSchemaVersions: { globalCatalog: GLOBAL_CATALOG_SCHEMA_VERSION, photos: PHOTOS_SCHEMA_VERSION },
      destination: options.destination,
    }, input),
    connect: (request, signal) => connectBackupDestination(enablementDeps, request, signal),
    test: (signal) => testBackupDestination(enablementDeps, signal),
    enable: (request) => enableBackup(enablementDeps, request),
    disable: (request) => disableBackup(enablementDeps, request),
    exportRecoveryKey: () => exportBackupRecoveryKey(enablementDeps),
    confirmRecoveryKey: () => confirmBackupRecoveryKey(enablementDeps),
    importRecoveryKey: (request) => importBackupRecoveryKey(enablementDeps, request),
    run: (request) => runBackupNow(enablementDeps, request),
  };
};

const verifySqliteIntegrity = async (
  databasePath: string,
  archivePath: string,
): Promise<Result<void, AppError>> => {
  try {
    const SQL = await initSqlJs(sqlJsWasmConfig());
    const client = new SQL.Database(readFileSync(databasePath));
    try {
      if (client.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') {
        return { ok: false, error: appError('backup_integrity_failed', `Backup database failed integrity_check: ${archivePath}`) };
      }
      return ok(undefined);
    } finally {
      client.close();
    }
  } catch {
    return { ok: false, error: appError('backup_integrity_failed', `Backup database failed integrity_check: ${archivePath}`) };
  }
};

const scheduledFingerprint = async (
  options: BackupLifecycleOptions,
): Promise<Result<string, AppError>> => {
  const stagingDirectory = options.fs.join(
    options.homeDirectory,
    '.ai-video-cataloger',
    'backup-staging',
    `schedule-${randomUUID()}`,
  );
  const created = await options.fs.ensureDirectory(stagingDirectory);
  if (!created.ok) return created;
  try {
    const prepared = await prepareBackupScope(options, 'critical', stagingDirectory, undefined, options.jobs);
    return prepared.ok ? ok(prepared.value.fingerprint) : prepared;
  } finally {
    await options.fs.deletePath(stagingDirectory);
  }
};

const readEnabled = async (config: ConfigStore): Promise<Result<boolean, AppError>> => {
  const settings = await readBackupSettings(config);
  return settings.ok ? ok(settings.value.enabled) : settings;
};
