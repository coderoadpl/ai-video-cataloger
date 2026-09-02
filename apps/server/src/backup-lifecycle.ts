import { randomUUID } from 'node:crypto';

import { BackupStateFile } from '@adapters/backup/state-store.js';
import { encryptBackupEnvelope, loadBackupEncryptionKey } from '@adapters/backup/envelope.js';
import { writeTarZstd } from '@adapters/backup/tar.js';
import {
  appError,
  configValueSchema,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import {
  cleanupBackupStaging,
  enqueueBackup,
  evaluateScheduledBackup,
  prepareBackupScope,
  type BackupRunDeps,
  type BackupDestinationPort,
  type ConfigStore,
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
  destination(): Promise<Result<BackupDestinationPort, AppError>>;
  now?: (() => Date) | undefined;
}

export interface BackupLifecycle {
  cleanup(): Promise<Result<void, AppError>>;
  evaluate(): Promise<Result<void, AppError>>;
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
      archive: (entries, targetPath, createdAt, signal) => writeTarZstd(entries, targetPath, createdAt, { signal }),
      encrypt: encryptBackupEnvelope,
    });
  };
  const enqueue = async (): Promise<Result<{ jobId: string }, AppError>> => {
    const retention = await readRetention(options.config);
    if (!retention.ok) return retention;
    const deps = await runDeps();
    if (!deps.ok) return deps;
    const critical = await enqueueBackup(options.jobs, deps.value, {
      tier: 'critical',
      keepLast: retention.value.keepLast,
      keepWeekly: retention.value.keepWeekly,
      manual: false,
    });
    if (!critical.ok) return critical;
    if (retention.value.includeOptional) {
      options.jobs.onSettled(critical.value.jobId, async () => {
        const completed = await options.jobs.get(critical.value.jobId);
        if (!completed.ok || completed.value?.status !== 'completed') return;
        await enqueueBackup(options.jobs, deps.value, {
          tier: 'optional',
          keepLast: retention.value.keepLast,
          keepWeekly: retention.value.keepWeekly,
          manual: false,
        });
      });
    }
    return critical;
  };
  return {
    cleanup: () => cleanupBackupStaging(options.fs, options.homeDirectory),
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
  };
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
  const stored = await config.get({ kind: 'home' }, 'backup_enabled');
  if (!stored.ok) return stored;
  const parsed = configValueSchema.shape.backup_enabled.safeParse(stored.value ?? undefined);
  return parsed.success
    ? ok(parsed.data)
    : { ok: false, error: appError('invalid_config_value', 'Invalid backup_enabled value') };
};

const readRetention = async (
  config: ConfigStore,
): Promise<Result<{ keepLast: number; keepWeekly: number; includeOptional: boolean }, AppError>> => {
  const values = await Promise.all([
    config.get({ kind: 'home' }, 'backup_keep_last'),
    config.get({ kind: 'home' }, 'backup_keep_weekly'),
    config.get({ kind: 'home' }, 'backup_include_optional'),
  ]);
  const failure = values.find((value) => !value.ok);
  if (failure !== undefined && !failure.ok) return failure;
  const keepLast = configValueSchema.shape.backup_keep_last.safeParse(values[0]?.ok === true ? values[0].value ?? undefined : undefined);
  const keepWeekly = configValueSchema.shape.backup_keep_weekly.safeParse(values[1]?.ok === true ? values[1].value ?? undefined : undefined);
  const includeOptional = configValueSchema.shape.backup_include_optional.safeParse(values[2]?.ok === true ? values[2].value ?? undefined : undefined);
  if (!keepLast.success || !keepWeekly.success || !includeOptional.success) {
    return { ok: false, error: appError('invalid_config_value', 'Invalid backup retention configuration') };
  }
  return ok({ keepLast: keepLast.data, keepWeekly: keepWeekly.data, includeOptional: includeOptional.data });
};
