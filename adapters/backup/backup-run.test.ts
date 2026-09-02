import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';
import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  appError,
  ok,
  type AppError,
  type BackupManifest,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';
import { enqueueBackup, runBackup, type BackupRunDeps } from '@core/server/index.js';
import type { JobExecutionContext, JobProgress, JobRecord, SecretsAvailability, SecretsStore } from '@core/server/index.js';

import {
  createBackupEncryptionKey,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  loadBackupEncryptionKey,
} from './envelope.js';
import { MemoryBackupDestination } from './memory-destination.js';
import { BackupStateFile } from './state-store.js';
import { extractTarZstd, writeTarZstd } from './tar.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

describe('backup run pipeline', () => {
  it.each(['critical', 'optional'] as const)('runs a %s backup and removes staging', async (tier) => {
    const fixture = await createFixture();
    const events: JobProgress[] = [];
    const result = await runBackup(fixture.deps, {
      tier,
      keepLast: 7,
      keepWeekly: 8,
    }, context('direct-job', events));

    expect(result).toMatchObject({ ok: true, value: { tier } });
    if (!result.ok) return;
    const inspection = path.join(fixture.home, 'inspection');
    const encryptedPath = path.join(inspection, result.value.name);
    const archivePath = path.join(inspection, 'backup.tar.zst');
    expect(await fixture.destination.download(result.value.remoteId, encryptedPath, new AbortController().signal)).toMatchObject({ ok: true });
    expect(await decryptBackupEnvelope(encryptedPath, archivePath, Buffer.alloc(32, 3))).toMatchObject({ ok: true });
    const extracted = await extractTarZstd(archivePath, path.join(inspection, 'files'));
    expect(extracted).toMatchObject({ ok: true });
    if (extracted.ok) {
      expect(extracted.value.files).toEqual(tier === 'critical'
        ? ['catalog.db', 'config.json', 'folders/22222222-2222-4222-8222-222222222222/config.json', 'manifest.json', 'photos.db']
        : ['manifest.json', 'photo-artifacts/proxies/photo.jpg']);
    }
    expect(events.map((event) => event.step)).toEqual([
      'fingerprinting',
      'snapshotting',
      'archiving',
      'encrypting',
      'uploading',
      'pruning',
    ]);
    expect(existsSync(path.join(fixture.home, '.ai-video-cataloger', 'backup-staging', 'direct-job'))).toBe(false);
    expect(await fixture.state.read()).toEqual(tier === 'critical'
      ? { ok: true, value: expect.objectContaining({ lastSuccessAt: '2026-09-02T12:00:00.000Z' }) }
      : ok(null));
  });

  it('keeps backup key material out of captured logs, NDJSON events, manifest, and uploaded bytes', async () => {
    const secrets = new MemorySecrets();
    const created = await createBackupEncryptionKey(secrets);
    if (!created.ok) throw new Error(created.error.message);
    const rawKey = secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT) ?? '';
    const fixture = await createFixture();
    const deps: BackupRunDeps = {
      ...fixture.deps,
      loadEncryptionKey: () => loadBackupEncryptionKey(secrets),
    };
    const events: JobProgress[] = [];
    const logLines: string[] = [];
    const result = await runBackup(deps, { tier: 'critical', keepLast: 7, keepWeekly: 8 }, {
      jobId: 'key-leak',
      signal: new AbortController().signal,
      reportProgress: (progress) => {
        events.push(progress);
        logLines.push(JSON.stringify({ level: 'debug', progress }));
        return Promise.resolve(ok(undefined));
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    logLines.push(JSON.stringify({ level: 'debug', remote: result.value }));
    const inspection = path.join(fixture.home, 'key-inspection');
    const encryptedPath = path.join(inspection, result.value.name);
    const archivePath = path.join(inspection, 'backup.tar.zst');
    expect(await fixture.destination.download(result.value.remoteId, encryptedPath, new AbortController().signal)).toMatchObject({ ok: true });
    const encryptedBytes = readFileSync(encryptedPath);
    expect(encryptedBytes.toString('utf8')).not.toContain(rawKey);
    expect(encryptedBytes.toString('utf8')).not.toContain(created.value.recoveryKey);
    expect(await decryptBackupEnvelope(encryptedPath, archivePath, Buffer.from(rawKey, 'base64'))).toMatchObject({ ok: true });
    expect(await extractTarZstd(archivePath, path.join(inspection, 'files'))).toMatchObject({ ok: true });
    const manifest = readFileSync(path.join(inspection, 'files', 'manifest.json'), 'utf8');
    const ndjson = events.map((event) => JSON.stringify({ type: 'progress', data: event })).join('\n');
    for (const output of [...logLines, ndjson, manifest]) {
      expect(output).not.toContain(rawKey);
      expect(output).not.toContain(created.value.recoveryKey);
    }
  });

  it('records a failing upload without leaving a remote artifact', async () => {
    const fixture = await createFixture(new MemoryBackupDestination({ failUpload: true }));
    const result = await runBackup(fixture.deps, { tier: 'critical', keepLast: 7, keepWeekly: 8 }, context('failed-job'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_destination_error' } });
    expect(await fixture.destination.list(null, new AbortController().signal)).toEqual(ok([]));
    expect(await fixture.state.read()).toEqual(ok({
      lastSuccessAt: null,
      lastFingerprint: null,
      lastErrorCode: 'backup_destination_error',
      lastArchiveName: null,
      lastRestoreAt: null,
    }));
    expect(existsSync(path.join(fixture.home, '.ai-video-cataloger', 'backup-staging', 'failed-job'))).toBe(false);
  });

  it('cancels upload, removes staging, and leaves state unchanged', async () => {
    const barrier = deferred();
    const destination = new MemoryBackupDestination({ uploadBarrier: barrier.promise });
    const fixture = await createFixture(destination);
    const jobs = new InProcessJobsPort();
    const enqueued = await enqueueBackup(jobs, fixture.deps, {
      tier: 'critical',
      keepLast: 7,
      keepWeekly: 8,
      manual: true,
    });
    if (!enqueued.ok) throw new Error(enqueued.error.message);
    await waitForJob(jobs, enqueued.value.jobId, (record) => record.progress?.step === 'uploading');
    expect(await jobs.cancel(enqueued.value.jobId)).toMatchObject({ ok: true, value: { cancelled: true } });
    barrier.resolve();
    const terminal = await waitForJob(jobs, enqueued.value.jobId, (record) => record.status === 'cancelled');

    expect(terminal.status).toBe('cancelled');
    expect(await destination.list(null, new AbortController().signal)).toEqual(ok([]));
    expect(await fixture.state.read()).toEqual(ok(null));
    expect(existsSync(path.join(fixture.home, '.ai-video-cataloger', 'backup-staging', enqueued.value.jobId))).toBe(false);
  }, scaledTimeout(30_000));

  it('cleans staging when the archive writer reports a full disk', async () => {
    const fixture = await createFixture();
    const deps: BackupRunDeps = {
      ...fixture.deps,
      archive: () => Promise.resolve({ ok: false, error: appError('internal', 'ENOSPC') }),
    };
    const result = await runBackup(deps, { tier: 'critical', keepLast: 7, keepWeekly: 8 }, context('disk-full'));

    expect(result).toMatchObject({ ok: false, error: { message: 'ENOSPC' } });
    expect(await fixture.state.read()).toEqual(ok({
      lastSuccessAt: null,
      lastFingerprint: null,
      lastErrorCode: 'internal',
      lastArchiveName: null,
      lastRestoreAt: null,
    }));
    expect(existsSync(path.join(fixture.home, '.ai-video-cataloger', 'backup-staging', 'disk-full'))).toBe(false);
  });

  it('reports a prune failure as a warning without failing the backup', async () => {
    const fixture = await createFixture(new MemoryBackupDestination({ failList: true }));
    const events: JobProgress[] = [];
    const result = await runBackup(
      fixture.deps,
      { tier: 'critical', keepLast: 7, keepWeekly: 8 },
      context('prune-warning', events),
    );

    expect(result).toMatchObject({ ok: true });
    expect(events.find((event) => event.step === 'pruning')).toMatchObject({
      data: { warning: 'Memory destination list failed' },
    });
  });

  it('prunes only the completed run tier', async () => {
    const destination = new TrackingBackupDestination([
      backup('critical-new', 'critical', '2026-09-01T12:00:00.000Z'),
      backup('critical-old', 'critical', '2026-08-01T12:00:00.000Z'),
      backup('optional-new', 'optional', '2026-09-01T12:00:00.000Z'),
      backup('optional-old', 'optional', '2026-08-01T12:00:00.000Z'),
    ]);
    const fixture = await createFixture(destination);
    const result = await runBackup(fixture.deps, { tier: 'critical', keepLast: 2, keepWeekly: 0 }, context('critical-prune'));

    expect(result).toMatchObject({ ok: true });
    expect(destination.listedTiers).toEqual(['critical']);
    expect(destination.removedIds).toEqual(['critical-old']);
  });

  it('rejects a backup while an analysis job is active and blocks analysis while backup is active', async () => {
    const fixture = await createFixture();
    const jobs = new InProcessJobsPort();
    const analysisGate = deferred();
    const analysis = await jobs.enqueue({
      kind: 'process',
      payload: {},
      run: async () => {
        await analysisGate.promise;
        return ok({});
      },
    });
    expect(analysis).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(await enqueueBackup(jobs, fixture.deps, {
      tier: 'critical', keepLast: 7, keepWeekly: 8, manual: true,
    })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    analysisGate.resolve();
    if (analysis.ok) await waitForJob(jobs, analysis.value.jobId, (record) => record.status === 'completed');

    const uploadGate = deferred();
    const blockedFixture = await createFixture(new MemoryBackupDestination({ uploadBarrier: uploadGate.promise }));
    const backup = await enqueueBackup(jobs, blockedFixture.deps, {
      tier: 'critical', keepLast: 7, keepWeekly: 8, manual: true,
    });
    if (!backup.ok) throw new Error(backup.error.message);
    await waitForJob(jobs, backup.value.jobId, (record) => record.progress?.step === 'uploading');
    expect(await jobs.enqueue({ kind: 'photo_scan', payload: {}, run: () => Promise.resolve(ok({})) })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    uploadGate.resolve();
    await waitForJob(jobs, backup.value.jobId, (record) => record.status === 'completed');
  }, scaledTimeout(30_000));

  it('claims the catalog-write resource around the snapshot phase', async () => {
    const fixture = await createFixture();
    const jobs = new InProcessJobsPort();
    const held = await jobs.acquireResource('catalog-write');
    if (!held.ok) throw new Error(held.error.message);
    const snapshot = vi.spyOn(fixture.deps.globalCatalog, 'snapshotTo');
    const backup = await enqueueBackup(jobs, fixture.deps, {
      tier: 'critical', keepLast: 7, keepWeekly: 8, manual: true,
    });
    if (!backup.ok) throw new Error(backup.error.message);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(snapshot).not.toHaveBeenCalled();
    held.value();
    await waitForJob(jobs, backup.value.jobId, (record) => record.status === 'completed');
    expect(snapshot).toHaveBeenCalledOnce();
  }, scaledTimeout(30_000));
});

class TrackingBackupDestination extends MemoryBackupDestination {
  readonly listedTiers: Array<'critical' | 'optional' | null> = [];
  readonly removedIds: string[] = [];
  private readonly existing: RemoteBackup[];

  constructor(existing: RemoteBackup[]) {
    super();
    this.existing = existing;
  }

  override list(tier: 'critical' | 'optional' | null, signal: AbortSignal): Promise<Result<RemoteBackup[], AppError>> {
    this.listedTiers.push(tier);
    if (signal.aborted) return super.list(tier, signal);
    return Promise.resolve(ok(this.existing.filter((remote) => tier === null || remote.tier === tier)));
  }

  override upload(
    input: { sourcePath: string; name: string; manifest: BackupManifest },
    signal: AbortSignal,
  ): Promise<Result<RemoteBackup, AppError>> {
    if (signal.aborted) return super.upload(input, signal);
    const remote = backup('uploaded-critical', input.manifest.tier, input.manifest.createdAt);
    this.existing.unshift(remote);
    return Promise.resolve(ok(remote));
  }

  override remove(remoteId: string, signal: AbortSignal): Promise<Result<{ removed: boolean }, AppError>> {
    this.removedIds.push(remoteId);
    const index = this.existing.findIndex((remote) => remote.remoteId === remoteId);
    if (index >= 0) this.existing.splice(index, 1);
    return signal.aborted ? super.remove(remoteId, signal) : Promise.resolve(ok({ removed: index >= 0 }));
  }
}

class MemorySecrets implements SecretsStore {
  readonly values = new Map<string, string>();

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

const backup = (remoteId: string, tier: 'critical' | 'optional', createdAt: string): RemoteBackup => ({
  remoteId,
  name: `${remoteId}.avcbak`,
  tier,
  createdAt,
  sizeBytes: 100,
  appVersion: '1.0.0',
  schemaVersions: { globalCatalog: 16, photos: 6 },
});

const createFixture = async (destination = new MemoryBackupDestination()): Promise<{
  home: string;
  destination: MemoryBackupDestination;
  state: BackupStateFile;
  deps: BackupRunDeps;
}> => {
  const home = mkdtempSync(path.join(tmpdir(), 'avc-backup-run-'));
  const appRoot = path.join(home, '.ai-video-cataloger');
  const mediaRoot = path.join(home, 'media');
  mkdirSync(path.join(appRoot, 'photo-artifacts', 'proxies'), { recursive: true });
  mkdirSync(path.join(mediaRoot, '.ai-video-cataloger'), { recursive: true });
  writeFileSync(path.join(appRoot, 'config.json'), '{"backup_enabled":true}\n');
  writeFileSync(path.join(mediaRoot, '.ai-video-cataloger', 'config.json'), '{}\n');
  writeFileSync(path.join(appRoot, 'photo-artifacts', 'proxies', 'photo.jpg'), 'proxy');
  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  await globalCatalog.upsertFolder({
    folderId: '22222222-2222-4222-8222-222222222222',
    currentPath: mediaRoot,
    displayName: 'media',
    firstSeenAt: '2026-09-02T12:00:00.000Z',
    lastSeenAt: '2026-09-02T12:00:00.000Z',
  });
  const photos = new SqlJsPhotosStore({ homeDirectory: home });
  await photos.upsertFolder({
    folderId: 'path-aaaaaaaa',
    currentPath: mediaRoot,
    displayName: 'media',
    firstSeenAt: '2026-09-02T12:00:00.000Z',
    lastSeenAt: '2026-09-02T12:00:00.000Z',
    defaultConfigId: null,
  });
  await photos.flush();
  const state = new BackupStateFile({ homeDirectory: home });
  const fs = new NodeFileSystemPort({ homeDirectory: home, workingDirectory: home });
  return {
    home,
    destination,
    state,
    deps: {
      homeDirectory: home,
      appVersion: '1.0.0',
      fs,
      globalCatalog,
      photos,
      destination,
      state,
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      loadEncryptionKey: () => Promise.resolve(ok(Buffer.alloc(32, 3))),
      archive: (entries, targetPath, createdAt, signal) => writeTarZstd(entries, targetPath, createdAt, { signal }),
      encrypt: encryptBackupEnvelope,
    },
  };
};

const context = (jobId: string, events: JobProgress[] = []): JobExecutionContext => ({
  jobId,
  signal: new AbortController().signal,
  reportProgress: (progress) => {
    events.push(progress);
    return Promise.resolve(ok(undefined));
  },
});

const deferred = (): { promise: Promise<void>; resolve(): void } => {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
};

const waitForJob = async (
  jobs: InProcessJobsPort,
  jobId: string,
  predicate: (record: JobRecord) => boolean,
): Promise<JobRecord> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await jobs.get(jobId);
    if (result.ok && result.value !== null && predicate(result.value)) return result.value;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
};
