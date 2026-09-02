import { describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';

import { InMemoryConfig, InMemoryJobs } from '../../../test/server/usecases/test-fakes.js';
import type { BackupConnectionReport, BackupDestinationPort, JobRecord } from '../ports.js';
import type { BackupStatePort } from './backup-run.js';
import { deriveBackupIndicator, nextBackupDueAt, readBackupStatus } from './backup-status.js';

const job = (overrides: Partial<JobRecord>): JobRecord => ({
  jobId: 'job-1',
  kind: 'backup',
  status: 'running',
  progress: null,
  progressEvents: [],
  error: null,
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  ...overrides,
});

class StubState implements BackupStatePort {
  constructor(private readonly value: Parameters<BackupStatePort['write']>[0] | null) {}
  read(): Promise<Result<Parameters<BackupStatePort['write']>[0] | null, AppError>> {
    return Promise.resolve(ok(this.value));
  }
  write(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }
}

const connectionReport: BackupConnectionReport = {
  accountEmail: 'person@example.com',
  driveName: null,
  folderName: 'AI Video Cataloger Backups',
  remainingQuotaBytes: 1024,
};

const stubDestination = (report: BackupConnectionReport): BackupDestinationPort => ({
  describe: () => ok({ provider: 'google_oauth', folderName: report.folderName }),
  connect: () => Promise.resolve(ok(report)),
  test: () => Promise.resolve(ok(report)),
  ensureFolder: () => Promise.resolve(ok({ folderId: 'folder', name: report.folderName })),
  list: () => Promise.resolve(ok([])),
  upload: () => Promise.resolve({ ok: false, error: { code: 'internal', message: 'unused' } }),
  download: () => Promise.resolve({ ok: false, error: { code: 'internal', message: 'unused' } }),
  remove: () => Promise.resolve(ok({ removed: false })),
});

describe('backup indicator state', () => {
  it('hides the indicator while backup is disabled', () => {
    expect(deriveBackupIndicator({ enabled: false, jobs: [], lastErrorCode: 'backup_destination_error' })).toEqual({
      indicator: 'disabled',
      phase: 'idle',
      percentage: null,
      activeJobId: null,
    });
  });

  it('reports the running phase of an active backup job', () => {
    expect(deriveBackupIndicator({
      enabled: true,
      jobs: [job({ progress: { step: 'uploading', percentage: 75 } })],
      lastErrorCode: null,
    })).toEqual({ indicator: 'running', phase: 'uploading', percentage: 75, activeJobId: 'job-1' });
  });

  it('reports a running restore job without a backup phase as idle phase', () => {
    expect(deriveBackupIndicator({
      enabled: true,
      jobs: [job({ jobId: 'job-9', kind: 'restore', status: 'queued', progress: { step: 'run-started' } })],
      lastErrorCode: null,
    })).toEqual({ indicator: 'running', phase: 'idle', percentage: null, activeJobId: 'job-9' });
  });

  it('ignores unrelated jobs and surfaces the last failure', () => {
    expect(deriveBackupIndicator({
      enabled: true,
      jobs: [job({ kind: 'process', status: 'running' })],
      lastErrorCode: 'backup_quota_exceeded',
    })).toEqual({ indicator: 'failed', phase: 'idle', percentage: null, activeJobId: null });
  });

  it('is idle when nothing runs and nothing failed', () => {
    expect(deriveBackupIndicator({ enabled: true, jobs: [], lastErrorCode: null })).toEqual({
      indicator: 'idle',
      phase: 'idle',
      percentage: null,
      activeJobId: null,
    });
  });
});

describe('next backup due date', () => {
  it('is unknown before the first success', () => {
    expect(nextBackupDueAt(null)).toBeNull();
  });

  it('is 24 hours after the last success', () => {
    expect(nextBackupDueAt('2026-09-01T12:00:00.000Z')).toBe('2026-09-02T12:00:00.000Z');
  });

  it('ignores an unparsable timestamp', () => {
    expect(nextBackupDueAt('not-a-date')).toBeNull();
  });
});

describe('backup status', () => {
  it('reports defaults on a fresh home without touching the destination', async () => {
    let destinationCalls = 0;
    const status = await readBackupStatus({
      config: new InMemoryConfig(),
      state: new StubState(null),
      jobs: new InMemoryJobs(),
      supportedSchemaVersions: { globalCatalog: 9, photos: 4 },
      destination: () => {
        destinationCalls += 1;
        return Promise.resolve(ok(stubDestination(connectionReport)));
      },
    }, { testConnection: false });

    expect(status).toEqual(ok({
      enabled: false,
      provider: 'google_oauth',
      connected: false,
      accountEmail: null,
      serviceAccountFingerprint: null,
      sharedDriveId: null,
      folderName: 'AI Video Cataloger Backups',
      includeOptional: false,
      keepLast: 7,
      keepWeekly: 8,
      indicator: 'disabled',
      phase: 'idle',
      percentage: null,
      activeJobId: null,
      lastSuccessAt: null,
      lastArchiveName: null,
      lastErrorCode: null,
      lastRestoreAt: null,
      nextDueAt: null,
      supportedSchemaVersions: { globalCatalog: 9, photos: 4 },
      connection: null,
    }));
    expect(destinationCalls).toBe(0);
  });

  it('reports the connected account, retention and last run once enabled', async () => {
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'backup_enabled', 'true');
    await config.set({ kind: 'home' }, 'backup_account_email', 'person@example.com');
    await config.set({ kind: 'home' }, 'backup_keep_last', '14');
    await config.set({ kind: 'home' }, 'backup_include_optional', 'true');

    const status = await readBackupStatus({
      config,
      state: new StubState({
        lastSuccessAt: '2026-09-01T12:00:00.000Z',
        lastFingerprint: null,
        lastErrorCode: null,
        lastArchiveName: 'avc-critical-20260901T120000Z.avcbak',
        lastRestoreAt: null,
      }),
      jobs: new InMemoryJobs(),
      supportedSchemaVersions: { globalCatalog: 9, photos: 4 },
      destination: () => Promise.resolve(ok(stubDestination(connectionReport))),
    }, { testConnection: false });

    expect(status).toMatchObject({
      ok: true,
      value: {
        enabled: true,
        connected: true,
        accountEmail: 'person@example.com',
        includeOptional: true,
        keepLast: 14,
        keepWeekly: 8,
        indicator: 'idle',
        lastSuccessAt: '2026-09-01T12:00:00.000Z',
        lastArchiveName: 'avc-critical-20260901T120000Z.avcbak',
        nextDueAt: '2026-09-02T12:00:00.000Z',
        connection: null,
      },
    });
  });

  it('adds the destination report when a connection test is requested', async () => {
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'backup_enabled', 'true');
    const status = await readBackupStatus({
      config,
      state: new StubState(null),
      jobs: new InMemoryJobs(),
      supportedSchemaVersions: { globalCatalog: 9, photos: 4 },
      destination: () => Promise.resolve(ok(stubDestination(connectionReport))),
    }, { testConnection: true });

    expect(status).toMatchObject({ ok: true, value: { connection: connectionReport } });
  });
});
