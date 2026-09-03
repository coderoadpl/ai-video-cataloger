import { describe, expect, it } from 'vitest';

import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  BACKUP_SERVICE_ACCOUNT_KEY_ACCOUNT,
  ok,
  type AppError,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';

import { InMemoryConfig, InMemoryJobs } from '../../../test/server/usecases/test-fakes.js';
import type { BackupConnectInput, BackupConnectionReport, BackupDestinationPort, BackupListResult } from '../ports.js';
import {
  confirmBackupRecoveryKey,
  connectBackupDestination,
  createRecoveryKeyCeremony,
  disableBackup,
  enableBackup,
  exportBackupRecoveryKey,
  importBackupRecoveryKey,
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
  archives: RemoteBackup[] = [];

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
  list(): Promise<Result<BackupListResult, AppError>> {
    return Promise.resolve(ok({ backups: this.archives, skipped: 0 }));
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

const PASTED_RECOVERY_KEY = 'PASTED-RECOVERY-KEY';

const remoteArchive = (remoteId: string, keyFingerprint: string | null): RemoteBackup => ({
  remoteId,
  name: `${remoteId}.avcbak`,
  tier: 'critical',
  createdAt: '2026-08-01T10:00:00.000Z',
  sizeBytes: 100,
  appVersion: '0.6.24',
  schemaVersions: { globalCatalog: 16, photos: 6 },
  keyFingerprint,
});

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
    parseRecoveryKey: (value) => value === PASTED_RECOVERY_KEY
      ? ok(Buffer.alloc(32, 7))
      : { ok: false, error: { code: 'recovery_key_required', message: 'invalid' } },
    fingerprintKey: (key) => `sha256:${key.toString('base64').slice(0, 12)}`,
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

  it('refuses to enable while the destination holds archives written under another recovery key', async () => {
    const { deps, destination, config } = harness();
    destination.archives = [remoteArchive('other-mac', 'sha256:ffffffffffff')];
    await connectBackupDestination(deps, { provider: 'service_account', keyJson: '{}', sharedDriveId: 'drive-1' }, new AbortController().signal);
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);

    expect(await enableBackup(deps, { includeOptional: false, keepLast: 7, keepWeekly: 8, runFirstBackup: false }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    expect(await config.get({ kind: 'home' }, 'backup_enabled')).toEqual(ok(null));
  });

  it('enables once the user acknowledges that the other key\'s archives stay unreadable', async () => {
    const { deps, destination, config } = harness();
    destination.archives = [remoteArchive('other-mac', 'sha256:ffffffffffff')];
    await connectBackupDestination(deps, { provider: 'service_account', keyJson: '{}', sharedDriveId: 'drive-1' }, new AbortController().signal);
    await exportBackupRecoveryKey(deps);
    await confirmBackupRecoveryKey(deps);

    expect(await enableBackup(deps, {
      includeOptional: false,
      keepLast: 7,
      keepWeekly: 8,
      runFirstBackup: false,
      acknowledgeUnreadableArchives: true,
    })).toEqual(ok({ enabled: true, jobId: null }));
    expect(await config.get({ kind: 'home' }, 'backup_enabled')).toEqual(ok('true'));
  });

  it('imports a pasted recovery key instead of minting a new one', async () => {
    const { deps, secrets } = harness();

    const imported = await importBackupRecoveryKey(deps, { recoveryKey: PASTED_RECOVERY_KEY });

    expect(imported).toMatchObject({ ok: true });
    expect(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(Buffer.alloc(32, 7).toString('base64'));
    expect(JSON.stringify(imported)).not.toContain(Buffer.alloc(32, 7).toString('base64'));
  });

  it('rejects an invalid recovery key and refuses to replace a stored key that already wrote archives', async () => {
    const { deps, secrets, destination } = harness();

    expect(await importBackupRecoveryKey(deps, { recoveryKey: 'nonsense' }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    const otherKey = Buffer.alloc(32, 9);
    secrets.values.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, otherKey.toString('base64'));
    destination.archives = [
      remoteArchive('archive-other', deps.fingerprintKey(otherKey)),
      remoteArchive('archive-pasted', deps.fingerprintKey(Buffer.alloc(32, 7))),
    ];

    expect(await importBackupRecoveryKey(deps, { recoveryKey: PASTED_RECOVERY_KEY }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
    expect(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(otherKey.toString('base64'));
  });

  it('refuses a checksum-valid key that no archive in the destination was written with', async () => {
    const { deps, secrets, destination } = harness();
    destination.archives = [remoteArchive('archive-foreign', 'sha256:ffffffffffff')];

    expect(await importBackupRecoveryKey(deps, { recoveryKey: PASTED_RECOVERY_KEY }))
      .toMatchObject({ ok: false, error: { code: 'recovery_key_mismatch' } });
    expect(secrets.values.has(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(false);
  });

  it('replaces a stored key that no archive in the destination was written with', async () => {
    const { deps, secrets, destination } = harness();
    secrets.values.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, Buffer.alloc(32, 9).toString('base64'));
    destination.archives = [remoteArchive('archive-pasted', deps.fingerprintKey(Buffer.alloc(32, 7)))];

    expect(await importBackupRecoveryKey(deps, { recoveryKey: PASTED_RECOVERY_KEY }))
      .toMatchObject({ ok: true });
    expect(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(Buffer.alloc(32, 7).toString('base64'));
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
