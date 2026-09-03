import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  BACKUP_FOLDER_NAME,
  backupPhaseSchema,
  ok,
  type AppError,
  type BackupIndicatorState,
  type BackupPhase,
  type BackupProvider,
  type BackupSchemaVersions,
  type ErrorCode,
  type Result,
} from '@core/domain/index.js';

import type {
  BackupConnectionReport,
  BackupDestinationPort,
  ConfigStore,
  JobRecord,
  JobsPort,
  SecretsStore,
} from '../ports.js';
import type { BackupStatePort } from './backup-run.js';
import { readBackupSettings } from './backup-settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupIndicator {
  indicator: BackupIndicatorState;
  phase: BackupPhase;
  percentage: number | null;
  activeJobId: string | null;
}

export interface BackupStatusView extends BackupIndicator {
  enabled: boolean;
  provider: BackupProvider;
  googleOAuthAvailable: boolean;
  connected: boolean;
  accountEmail: string | null;
  serviceAccountFingerprint: string | null;
  sharedDriveId: string | null;
  folderName: string;
  includeOptional: boolean;
  keepLast: number;
  keepWeekly: number;
  lastSuccessAt: string | null;
  lastArchiveName: string | null;
  lastErrorCode: ErrorCode | null;
  lastRestoreAt: string | null;
  nextDueAt: string | null;
  supportedSchemaVersions: BackupSchemaVersions;
  connection: BackupConnectionReport | null;
  recoveryKeyStored: boolean;
  recoveryKeyFingerprint: string | null;
}

export interface BackupStatusDeps {
  config: ConfigStore;
  state: BackupStatePort;
  jobs: Pick<JobsPort, 'list'>;
  secrets: SecretsStore;
  supportedSchemaVersions: BackupSchemaVersions;
  googleOAuthAvailable: boolean;
  destination(): Promise<Result<BackupDestinationPort, AppError>>;
  fingerprintKey(key: Buffer): string;
}

export const deriveBackupIndicator = (input: {
  enabled: boolean;
  jobs: readonly JobRecord[];
  lastErrorCode: ErrorCode | null;
}): BackupIndicator => {
  if (!input.enabled) return { indicator: 'disabled', phase: 'idle', percentage: null, activeJobId: null };
  const active = input.jobs.find((job) =>
    (job.kind === 'backup' || job.kind === 'restore') && (job.status === 'queued' || job.status === 'running'));
  if (active !== undefined) {
    const phase = backupPhaseSchema.safeParse(active.progress?.step);
    return {
      indicator: 'running',
      phase: phase.success ? phase.data : 'idle',
      percentage: active.progress?.percentage ?? null,
      activeJobId: active.jobId,
    };
  }
  return {
    indicator: input.lastErrorCode === null ? 'idle' : 'failed',
    phase: 'idle',
    percentage: null,
    activeJobId: null,
  };
};

export const nextBackupDueAt = (lastSuccessAt: string | null): string | null => {
  if (lastSuccessAt === null) return null;
  const elapsed = new Date(lastSuccessAt).getTime();
  return Number.isFinite(elapsed) ? new Date(elapsed + DAY_MS).toISOString() : null;
};

export const readBackupStatus = async (
  deps: BackupStatusDeps,
  input: { testConnection: boolean },
): Promise<Result<BackupStatusView, AppError>> => {
  const settings = await readBackupSettings(deps.config);
  if (!settings.ok) return settings;
  const state = await deps.state.read();
  if (!state.ok) return state;
  const jobs = await deps.jobs.list();
  if (!jobs.ok) return jobs;
  const connection = input.testConnection ? await testConnection(deps) : ok(null);
  if (!connection.ok) return connection;
  const storedKey = await deps.secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!storedKey.ok && storedKey.error.code !== 'keychain_unavailable') return storedKey;
  const storedKeyMaterial = storedKey.ok ? storedKey.value : null;
  const recoveryKeyStored = storedKeyMaterial !== null;
  const indicator = deriveBackupIndicator({
    enabled: settings.value.enabled,
    jobs: jobs.value,
    lastErrorCode: state.value?.lastErrorCode ?? null,
  });
  return ok({
    ...indicator,
    enabled: settings.value.enabled,
    provider: settings.value.provider,
    googleOAuthAvailable: deps.googleOAuthAvailable,
    connected: settings.value.accountEmail.length > 0 || settings.value.serviceAccountFingerprint.length > 0,
    accountEmail: emptyToNull(settings.value.accountEmail),
    serviceAccountFingerprint: emptyToNull(settings.value.serviceAccountFingerprint),
    sharedDriveId: emptyToNull(settings.value.sharedDriveId),
    folderName: BACKUP_FOLDER_NAME,
    includeOptional: settings.value.includeOptional,
    keepLast: settings.value.keepLast,
    keepWeekly: settings.value.keepWeekly,
    lastSuccessAt: state.value?.lastSuccessAt ?? null,
    lastArchiveName: state.value?.lastArchiveName ?? null,
    lastErrorCode: state.value?.lastErrorCode ?? null,
    lastRestoreAt: state.value?.lastRestoreAt ?? null,
    nextDueAt: nextBackupDueAt(state.value?.lastSuccessAt ?? null),
    supportedSchemaVersions: deps.supportedSchemaVersions,
    connection: connection.value,
    recoveryKeyStored,
    recoveryKeyFingerprint: storedKeyMaterial === null ? null : deps.fingerprintKey(Buffer.from(storedKeyMaterial, 'base64')),
  });
};

const testConnection = async (deps: BackupStatusDeps): Promise<Result<BackupConnectionReport, AppError>> => {
  const destination = await deps.destination();
  if (!destination.ok) return destination;
  return destination.value.test(new AbortController().signal);
};

const emptyToNull = (value: string): string | null => (value.length === 0 ? null : value);
