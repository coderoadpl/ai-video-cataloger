import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  BACKUP_GOOGLE_REFRESH_TOKEN_ACCOUNT,
  BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT,
  appError,
  ok,
  type AppError,
  type BackupProvider,
  type BackupTier,
  type Result,
} from '@core/domain/index.js';

import type {
  BackupConnectionReport,
  BackupDestinationPort,
  ConfigStore,
  FileSavePort,
  JobsPort,
  SecretsStore,
} from '../ports.js';
import { readBackupSettings } from './backup-settings.js';

export interface RecoveryKeyCeremony {
  confirmed(): boolean;
  confirm(): void;
  reset(): void;
}

export interface RecoveryKeyMaterial {
  fingerprint: string;
  document: string;
}

export interface BackupEnablementDeps {
  config: ConfigStore;
  secrets: SecretsStore;
  jobs: Pick<JobsPort, 'list'>;
  ceremony: RecoveryKeyCeremony;
  fileSave: FileSavePort;
  destination(): Promise<Result<BackupDestinationPort, AppError>>;
  enqueueBackup(input: {
    tier: BackupTier;
    keepLast: number;
    keepWeekly: number;
    manual: boolean;
  }): Promise<Result<{ jobId: string }, AppError>>;
  recoveryKey(): Promise<Result<RecoveryKeyMaterial, AppError>>;
  parseRecoveryKey(value: string): Result<Buffer, AppError>;
  fingerprintKey(key: Buffer): string;
}

export interface BackupConnectRequest {
  provider: BackupProvider;
  keyJson: string | null;
  sharedDriveId: string | null;
}

export interface BackupConnectResult {
  provider: BackupProvider;
  connection: BackupConnectionReport;
  serviceAccountFingerprint: string | null;
}

export interface BackupEnableRequest {
  includeOptional: boolean;
  keepLast: number;
  keepWeekly: number;
  runFirstBackup: boolean;
  acknowledgeUnreadableArchives?: boolean | undefined;
}

export const createRecoveryKeyCeremony = (): RecoveryKeyCeremony => {
  let confirmed = false;
  return {
    confirmed: () => confirmed,
    confirm: () => {
      confirmed = true;
    },
    reset: () => {
      confirmed = false;
    },
  };
};

export const connectBackupDestination = async (
  deps: BackupEnablementDeps,
  request: BackupConnectRequest,
  signal: AbortSignal,
): Promise<Result<BackupConnectResult, AppError>> => {
  const stored = await deps.config.set({ kind: 'home' }, 'backup_provider', request.provider);
  if (!stored.ok) return stored;
  const destination = await deps.destination();
  if (!destination.ok) return destination;
  const connected = await destination.value.connect(
    { keyJson: request.keyJson, sharedDriveId: request.sharedDriveId },
    signal,
  );
  if (!connected.ok) return connected;
  const email = await deps.config.set({ kind: 'home' }, 'backup_account_email', connected.value.accountEmail ?? '');
  if (!email.ok) return email;
  const settings = await readBackupSettings(deps.config);
  if (!settings.ok) return settings;
  return ok({
    provider: request.provider,
    connection: connected.value,
    serviceAccountFingerprint:
      settings.value.serviceAccountFingerprint.length === 0 ? null : settings.value.serviceAccountFingerprint,
  });
};

export const testBackupDestination = async (
  deps: BackupEnablementDeps,
  signal: AbortSignal,
): Promise<Result<{ connection: BackupConnectionReport }, AppError>> => {
  const destination = await deps.destination();
  if (!destination.ok) return destination;
  const tested = await destination.value.test(signal);
  return tested.ok ? ok({ connection: tested.value }) : tested;
};

export const exportBackupRecoveryKey = async (
  deps: BackupEnablementDeps,
): Promise<Result<{ fingerprint: string; path: string }, AppError>> => {
  const material = await deps.recoveryKey();
  if (!material.ok) return material;
  const saved = await deps.fileSave.save({
    suggestedName: 'ai-video-cataloger-recovery-key.txt',
    contents: material.value.document,
  });
  if (!saved.ok) return saved;
  if (saved.value === null) {
    return { ok: false, error: appError('recovery_key_required', 'The recovery key was not saved') };
  }
  return ok({ fingerprint: material.value.fingerprint, path: saved.value.path });
};

export const confirmBackupRecoveryKey = async (
  deps: BackupEnablementDeps,
): Promise<Result<{ confirmed: true }, AppError>> => {
  const stored = await deps.secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!stored.ok) return stored;
  if (stored.value === null) {
    return { ok: false, error: appError('recovery_key_required', 'Export the recovery key before confirming it') };
  }
  deps.ceremony.confirm();
  return ok({ confirmed: true });
};

export const importBackupRecoveryKey = async (
  deps: BackupEnablementDeps,
  request: { recoveryKey: string },
): Promise<Result<{ fingerprint: string }, AppError>> => {
  const parsed = deps.parseRecoveryKey(request.recoveryKey);
  if (!parsed.ok) return parsed;
  const fingerprint = deps.fingerprintKey(parsed.value);
  const encoded = parsed.value.toString('base64');
  const stored = await deps.secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!stored.ok) return stored;
  if (stored.value === encoded) return ok({ fingerprint });
  const archived = await archiveKeyFingerprints(deps);
  if (!archived.ok) return archived;
  if (archived.value.size > 0 && !archived.value.has(fingerprint)) {
    return {
      ok: false,
      error: appError(
        'recovery_key_mismatch',
        'No archive in this destination was written with the pasted recovery key',
      ),
    };
  }
  if (stored.value !== null && archived.value.has(deps.fingerprintKey(Buffer.from(stored.value, 'base64')))) {
    return {
      ok: false,
      error: appError(
        'recovery_key_conflict',
        'A different backup key is already stored on this Mac and this destination holds archives written with it',
      ),
    };
  }
  const written = await deps.secrets.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, encoded);
  if (!written.ok) return written;
  return ok({ fingerprint });
};

export const enableBackup = async (
  deps: BackupEnablementDeps,
  request: BackupEnableRequest,
): Promise<Result<{ enabled: true; jobId: string | null }, AppError>> => {
  if (!deps.ceremony.confirmed()) {
    return { ok: false, error: appError('recovery_key_required', 'Export and confirm the recovery key first') };
  }
  const settings = await readBackupSettings(deps.config);
  if (!settings.ok) return settings;
  if (settings.value.accountEmail.length === 0 && settings.value.serviceAccountFingerprint.length === 0) {
    return { ok: false, error: appError('backup_auth_required', 'Connect a backup destination first') };
  }
  if (request.acknowledgeUnreadableArchives !== true) {
    const foreign = await holdsArchivesFromAnotherKey(deps);
    if (!foreign.ok) return foreign;
    if (foreign.value) {
      return {
        ok: false,
        error: appError(
          'recovery_key_required',
          'This destination already holds archives written under another recovery key; import that key or acknowledge that they stay unreadable',
        ),
      };
    }
  }
  const written = await writeAll(deps.config, [
    ['backup_include_optional', String(request.includeOptional)],
    ['backup_keep_last', String(request.keepLast)],
    ['backup_keep_weekly', String(request.keepWeekly)],
    ['backup_enabled', 'true'],
  ]);
  if (!written.ok) return written;
  if (!request.runFirstBackup) return ok({ enabled: true, jobId: null });
  const enqueued = await deps.enqueueBackup({
    tier: 'critical',
    keepLast: request.keepLast,
    keepWeekly: request.keepWeekly,
    manual: true,
  });
  return enqueued.ok ? ok({ enabled: true, jobId: enqueued.value.jobId }) : enqueued;
};

export const disableBackup = async (
  deps: BackupEnablementDeps,
  request: { purgeCredentials: boolean },
): Promise<Result<{ enabled: false }, AppError>> => {
  const settings = await readBackupSettings(deps.config);
  if (!settings.ok) return settings;
  const purge = request.purgeCredentials && !settings.value.enabled;
  const disabled = await deps.config.set({ kind: 'home' }, 'backup_enabled', 'false');
  if (!disabled.ok) return disabled;
  deps.ceremony.reset();
  if (!purge) return ok({ enabled: false });
  for (const account of [
    BACKUP_ENCRYPTION_KEY_ACCOUNT,
    BACKUP_GOOGLE_REFRESH_TOKEN_ACCOUNT,
    BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT,
  ]) {
    const removed = await deps.secrets.delete(account);
    if (!removed.ok) return removed;
  }
  const cleared = await writeAll(deps.config, [
    ['backup_account_email', ''],
    ['backup_service_account_fingerprint', ''],
    ['backup_folder_id', ''],
    ['backup_shared_drive_id', ''],
  ]);
  return cleared.ok ? ok({ enabled: false }) : cleared;
};

export const runBackupNow = async (
  deps: BackupEnablementDeps,
  request: { tier: BackupTier },
): Promise<Result<{ jobId: string }, AppError>> => {
  const settings = await readBackupSettings(deps.config);
  if (!settings.ok) return settings;
  if (!settings.value.enabled) {
    return { ok: false, error: appError('backup_disabled', 'Backup is disabled') };
  }
  return deps.enqueueBackup({
    tier: request.tier,
    keepLast: settings.value.keepLast,
    keepWeekly: settings.value.keepWeekly,
    manual: true,
  });
};

const holdsArchivesFromAnotherKey = async (
  deps: BackupEnablementDeps,
): Promise<Result<boolean, AppError>> => {
  const fingerprint = await storedKeyFingerprint(deps);
  if (!fingerprint.ok) return fingerprint;
  const archived = await archiveKeyFingerprints(deps);
  if (!archived.ok) return archived;
  return ok([...archived.value].some((candidate) => candidate !== fingerprint.value));
};

const archiveKeyFingerprints = async (
  deps: BackupEnablementDeps,
): Promise<Result<Set<string>, AppError>> => {
  const destination = await deps.destination();
  if (!destination.ok) return destination;
  const listed = await destination.value.list(null, new AbortController().signal);
  if (!listed.ok) return listed;
  const fingerprints = new Set<string>();
  for (const backup of listed.value.backups) {
    if (backup.keyFingerprint !== null) fingerprints.add(backup.keyFingerprint);
  }
  return ok(fingerprints);
};

const storedKeyFingerprint = async (
  deps: BackupEnablementDeps,
): Promise<Result<string | null, AppError>> => {
  const stored = await deps.secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!stored.ok) return stored;
  return ok(stored.value === null ? null : deps.fingerprintKey(Buffer.from(stored.value, 'base64')));
};

const writeAll = async (
  config: ConfigStore,
  entries: ReadonlyArray<[Parameters<ConfigStore['set']>[1], string]>,
): Promise<Result<void, AppError>> => {
  for (const [key, value] of entries) {
    const written = await config.set({ kind: 'home' }, key, value);
    if (!written.ok) return written;
  }
  return ok(undefined);
};
