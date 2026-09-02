import { describe, expect, it } from 'vitest';

import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import { InMemoryConfig, InMemoryJobs } from '../../../test/server/usecases/test-fakes.js';
import type { BackupConnectInput, BackupConnectionReport, BackupDestinationPort } from '../ports.js';
import {
  confirmBackupRecoveryKey,
  connectBackupDestination,
  createRecoveryKeyCeremony,
  disableBackup,
  enableBackup,
  exportBackupRecoveryKey,
  runBackupNow,
  type BackupEnablementDeps,
} from './backup-enablement.js';

const report: BackupConnectionReport = {
  accountEmail: 'service@example.com',
  driveName: 'Company Backups',
  folderName: 'AI Video Cataloger Backups',
  remainingQuotaBytes: null,
};

class RecordingDestination implements BackupDestinationPort {
  readonly connectInputs: BackupConnectInput[] = [];

  describe(): Result<{ provider: 'service_account'; folderName: string }, AppError> {
    return ok({ provider: 'service_account', folderName: report.folderName });
  }
  connect(input: BackupConnectInput): Promise<Result<BackupConnectionReport, AppError>> {
    this.connectInputs.push(input);
    return Promise.resolve(ok(report));
  }
  test(): Promise<Result<BackupConnectionReport, AppError>> {
    return Promise.resolve(ok(report));
  }
  ensureFolder(): Promise<Result<{ folderId: string; name: string }, AppError>> {
    return Promise.resolve(ok({ folderId: 'folder', name: report.folderName }));
  }
  list(): Promise<Result<[], AppError>> {
    return Promise.resolve(ok([]));
  }
  upload(): Promise<Result<never, AppError>> {
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'unused' } });
  }
  download(): Promise<Result<never, AppError>> {
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'unused' } });
  }
  remove(): Promise<Result<{ removed: boolean }, AppError>> {
    return Promise.resolve(ok({ removed: false }));
  }
}

class MemorySecrets {
  readonly values = new Map<string, string>();
  availability(): Promise<'available'> {
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
    const existed = this.values.delete(account);
    return Promise.resolve(ok({ existed }));
  }
}

interface Harness {
  deps: BackupEnablementDeps;
  config: InMemoryConfig;
  secrets: MemorySecrets;
  destination: RecordingDestination;
  saved: Array<{ suggestedName: string; contents: string }>;
}

const emptySecrets = (): MemorySecrets => new MemorySecrets();

const harness = (options: { savePath?: string | null } = {}): Harness => {
  const config = new InMemoryConfig();
  const secrets = new MemorySecrets();
  const destination = new RecordingDestination();
  const saved: Array<{ suggestedName: string; contents: string }> = [];
  const deps: BackupEnablementDeps = {
    config,
    secrets,
    jobs: new InMemoryJobs(),
    ceremony: createRecoveryKeyCeremony(),
    destination: () => Promise.resolve(ok(destination)),
    enqueueBackup: () => Promise.resolve(ok({ jobId: 'backup-1' })),
    recoveryKey: async () => {
      const existing = await secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
      if (!existing.ok) return existing;
      if (existing.value === null) await secrets.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, 'stored-key-material');
      return ok({ fingerprint: 'sha256:0123456789ab', document: 'recovery document stored-key-material' });
    },
    fileSave: {
      save: (input) => {
        saved.push(input);
        const path = options.savePath === undefined ? '/tmp/recovery-key.txt' : options.savePath;
        return Promise.resolve(ok(path === null ? null : { path }));
      },
    },
  };
  return { deps, config, secrets, destination, saved };
};

describe('backup enablement', () => {
  it('stores the chosen provider before the destination connects', async () => {
    const { deps, config, destination } = harness();

    const connected = await connectBackupDestination(deps, {
      provider: 'service_account',
      keyJson: '{"type":"service_account"}',
      sharedDriveId: 'drive-1',
    }, new AbortController().signal);

    expect(connected).toMatchObject({ ok: true, value: { provider: 'service_account', connection: report } });
    expect(await config.get({ kind: 'home' }, 'backup_provider')).toEqual(ok('service_account'));
    expect(destination.connectInputs).toEqual([{ keyJson: '{"type":"service_account"}', sharedDriveId: 'drive-1' }]);
  });

  it('refuses to enable before the recovery key was exported and confirmed', async () => {
    const { deps, config } = harness();
    await config.set({ kind: 'home' }, 'backup_account_email', 'person@example.com');

    const enabled = await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false });

    expect(enabled).toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    expect(await config.get({ kind: 'home' }, 'backup_enabled')).toEqual(ok(null));
  });

  it('refuses to enable without a connected destination', async () => {
    const { deps } = harness();
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);

    expect(await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false }))
      .toMatchObject({ ok: false, error: { code: 'backup_auth_required' } });
  });

  it('sends the recovery document to the native save dialog and returns only its fingerprint', async () => {
    const { deps, secrets, saved } = harness();

    const exported = await exportBackupRecoveryKey(deps);

    expect(exported).toEqual(ok({ fingerprint: 'sha256:0123456789ab', path: '/tmp/recovery-key.txt' }));
    expect(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe('stored-key-material');
    expect(saved).toEqual([{
      suggestedName: 'ai-video-cataloger-recovery-key.txt',
      contents: 'recovery document stored-key-material',
    }]);
    expect(JSON.stringify(exported)).not.toContain('stored-key-material');
  });

  it('reports a cancelled save dialog as a still-required recovery key', async () => {
    const { deps } = harness({ savePath: null });

    expect(await exportBackupRecoveryKey(deps)).toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    expect(await confirmBackupRecoveryKey({ ...deps, secrets: emptySecrets() }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
  });

  it('enables backup and runs the first backup after the ceremony', async () => {
    const { deps, config } = harness();
    await connectBackupDestination(deps, { provider: 'service_account', keyJson: '{}', sharedDriveId: 'drive-1' }, new AbortController().signal);
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);

    const enabled = await enableBackup(deps, { includeOptional: true, keepLast: 14, keepWeekly: 4, runFirstBackup: true });

    expect(enabled).toEqual(ok({ enabled: true, jobId: 'backup-1' }));
    expect(await config.get({ kind: 'home' }, 'backup_enabled')).toEqual(ok('true'));
    expect(await config.get({ kind: 'home' }, 'backup_include_optional')).toEqual(ok('true'));
    expect(await config.get({ kind: 'home' }, 'backup_keep_last')).toEqual(ok('14'));
    expect(await config.get({ kind: 'home' }, 'backup_keep_weekly')).toEqual(ok('4'));
  });

  it('purges credentials only for an abandoned enablement', async () => {
    const { deps, config, secrets } = harness();
    await connectBackupDestination(deps, { provider: 'service_account', keyJson: '{}', sharedDriveId: 'drive-1' }, new AbortController().signal);
    await exportBackupRecoveryKey(deps);
    secrets.values.set(BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT, '{}');

    expect(await disableBackup(deps, { purgeCredentials: true })).toEqual(ok({ enabled: false }));
    expect(secrets.values.size).toBe(0);
    expect(await config.get({ kind: 'home' }, 'backup_account_email')).toEqual(ok(''));
  });

  it('keeps credentials when disabling an enabled backup', async () => {
    const { deps, config, secrets } = harness();
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);
    await config.set({ kind: 'home' }, 'backup_account_email', 'person@example.com');
    await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false });

    expect(await disableBackup(deps, { purgeCredentials: true })).toEqual(ok({ enabled: false }));
    expect(await config.get({ kind: 'home' }, 'backup_enabled')).toEqual(ok('false'));
    expect(secrets.values.has(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(true);
  });

  it('requires the ceremony again after disabling', async () => {
    const { deps, config } = harness();
    await config.set({ kind: 'home' }, 'backup_account_email', 'person@example.com');
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);
    await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false });
    await disableBackup(deps, { purgeCredentials: false });

    expect(await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
  });

  it('refuses a manual backup while backup is disabled', async () => {
    const { deps } = harness();

    expect(await runBackupNow(deps, { tier: 'critical' })).toMatchObject({
      ok: false,
      error: { code: 'backup_disabled' },
    });
  });

  it('runs a manual backup with the configured retention', async () => {
    const { deps, config } = harness();
    const enqueued: unknown[] = [];
    const runDeps: BackupEnablementDeps = {
      ...deps,
      enqueueBackup: (input) => {
        enqueued.push(input);
        return Promise.resolve(ok({ jobId: 'backup-9' }));
      },
    };
    await config.set({ kind: 'home' }, 'backup_enabled', 'true');
    await config.set({ kind: 'home' }, 'backup_keep_last', '3');

    expect(await runBackupNow(runDeps, { tier: 'optional' })).toEqual(ok({ jobId: 'backup-9' }));
    expect(enqueued).toEqual([{ tier: 'optional', keepLast: 3, keepWeekly: 8, manual: true }]);
  });
});
