import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { InProcessJobsPort } from '@adapters/jobs/index.js';
import {
  appError,
  ok,
  type AppError,
  type BackupManifest,
  type BackupState,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';
import {
  enqueueRestore,
  performRestoreStartupRecovery,
  restoreAdmissionError,
  runBackup,
  runRestore,
  type BackupRestoreDeps,
  type BackupRunDeps,
} from '@core/server/index.js';
import type { JobExecutionContext, JobProgress, JobRecord } from '@core/server/index.js';

import { backupKeyFingerprint, encryptBackupEnvelope, parseRecoveryKey, renderRecoveryKey } from './envelope.js';
import { MemoryBackupDestination } from './memory-destination.js';
import { BackupStateFile } from './state-store.js';
import { extractTarZstd, writeTarZstd } from './tar.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

const TEST_OWNER = { pid: process.pid, hostname: 'test-host' } as const;

describe('backup restore pipeline', () => {
  it('restores a critical backup and reports relaunch required', async () => {
    const fixture = await createRestoreFixture();
    const events: JobProgress[] = [];

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('restore-job', events));

    expect(result).toMatchObject({ ok: true, value: { relaunchRequired: true, restored: expect.objectContaining({ remoteId: fixture.remoteId }) } });
    expect(events.map((event) => event.step)).toEqual(['downloading', 'decrypting', 'verifying', 'restoring']);
    await expectCatalogCounts(fixture.targetHome, { folders: 1, files: 1 });
    expect(readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8')).toContain('from-backup');
    expect(await fixture.restoreState.read()).toEqual(ok({
      lastSuccessAt: null,
      lastFingerprint: null,
      lastErrorCode: null,
      lastArchiveName: null,
      lastRestoreAt: '2026-09-02T13:00:00.000Z',
    }));
    expect(existsSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'backup-staging', 'restore-job'))).toBe(false);
  });

  it('refuses a manifest hash mismatch before touching live files', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted, manifest) => {
      const changed = {
        ...manifest,
        files: manifest.files.map((file) => file.path === 'config.json' ? { ...file, sha256: '0'.repeat(64) } : file),
      };
      await writeFile(path.join(extracted, 'manifest.json'), `${JSON.stringify(changed, null, 2)}\n`);
    });
    const before = readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8');

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('hash-mismatch'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
    expect(readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8')).toBe(before);
  });

  it('refuses a database that fails sqlite integrity_check before touching live files', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted) => {
      await writeFile(path.join(extracted, 'catalog.db'), 'not sqlite');
      await rewriteManifestForExtractedTree(extracted, fixture.backupManifest);
    });
    const before = readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8');

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('bad-sqlite'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
    expect(readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8')).toBe(before);
  });

  it('refuses a newer schema before download', async () => {
    const fixture = await createRestoreFixture();
    const destination = new TrackingDownloadDestination();
    const newer = {
      ...fixture.remote,
      schemaVersions: { globalCatalog: 999, photos: fixture.remote.schemaVersions.photos },
      appVersion: '9.9.9',
    };
    destination.seed(newer, await fixture.remoteBytes());
    const deps: BackupRestoreDeps = { ...fixture.restoreDeps, destination };

    const result = await runRestore(deps, { remoteId: fixture.remoteId }, context('newer-schema'));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'snapshot_incompatible', message: expect.stringContaining('9.9.9') },
    });
    expect(destination.downloads).toBe(0);
  });

  it('refuses while a conflicting job is running', async () => {
    const fixture = await createRestoreFixture();
    const jobs = new InProcessJobsPort();
    const gate = deferred();
    const holder = await jobs.enqueue({ kind: 'process', payload: {}, run: async () => {
      await gate.promise;
      return ok({});
    } });
    if (!holder.ok) throw new Error(holder.error.message);
    await Promise.resolve();
    const destination = new TrackingDownloadDestination();
    destination.seed(fixture.remote, await fixture.remoteBytes());

    const result = await enqueueRestore(jobs, { ...fixture.restoreDeps, destination }, { remoteId: fixture.remoteId });

    expect(result).toMatchObject({ ok: false, error: { code: 'restore_refused' } });
    expect(destination.downloads).toBe(0);
    gate.resolve();
    await waitForJob(jobs, holder.value.jobId, (record) => record.status === 'completed');
  }, scaledTimeout(30_000));

  it('uses the supplied recovery key when keychain lookup cannot decrypt', async () => {
    const fixture = await createRestoreFixture();
    const rendered = renderRecoveryKey(fixture.key);

    const result = await runRestore({
      ...fixture.restoreDeps,
      loadEncryptionKey: () => Promise.resolve(ok(Buffer.alloc(32, 99))),
    }, { remoteId: fixture.remoteId, recoveryKey: rendered }, context('recovery-key'));

    expect(result).toMatchObject({ ok: true });
    await expectCatalogCounts(fixture.targetHome, { folders: 1, files: 1 });
  });

  it('creates a readable pre-restore backup before swap', async () => {
    const fixture = await createRestoreFixture();

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('pre-restore'));

    expect(result).toMatchObject({ ok: true });
    const preRestoreRoot = path.join(fixture.targetHome, '.ai-video-cataloger', 'pre-restore');
    const listed = await fixture.fs.listDirectory(preRestoreRoot);
    const entries = listed.ok ? listed.value : [];
    expect(entries).toHaveLength(1);
    const catalogPath = path.join(entries[0]?.path ?? '', 'catalog.db');
    expect(await sqliteIntegrity(catalogPath)).toBe(true);
    expect(readFileSync(path.join(entries[0]?.path ?? '', 'config.json'), 'utf8')).toContain('current-target');
  });

  it('rolls back from the marker after a swap failure', async () => {
    const fixture = await createRestoreFixture();
    const failingFs = new FailingRenameFs(fixture.fs, 2);
    const result = await runRestore({ ...fixture.restoreDeps, fs: failingFs }, { remoteId: fixture.remoteId }, context('swap-failure'));

    expect(result).toMatchObject({ ok: false, error: { code: 'restore_incomplete' } });
    const marker = path.join(fixture.targetHome, '.ai-video-cataloger', 'restore-incomplete.json');
    expect(existsSync(marker)).toBe(true);
    expect(await performRestoreStartupRecovery({
      fs: fixture.fs,
      homeDirectory: fixture.targetHome,
      isOwnerAlive: () => false,
    })).toEqual(ok(undefined));
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(path.join(fixture.targetHome, '.ai-video-cataloger', 'config.json'), 'utf8')).toContain('current-target');
    await expectCatalogCounts(fixture.targetHome, { folders: 0, files: 0 });
  });

  it('restores a folder config when the extracted staging path cannot be renamed across devices', async () => {
    const fixture = await createRestoreFixture();
    const folder = fixture.backupManifest.folders[0];
    if (folder === undefined) throw new Error('expected a backed-up folder');
    const liveFolderConfig = path.join(folder.path, '.ai-video-cataloger', 'config.json');
    await fixture.replaceRemoteArchive(async (extracted, manifest) => {
      await writeFile(path.join(extracted, 'folders', folder.folderId, 'config.json'), '{"marker":"restored-folder-config"}\n');
      await rewriteManifestForExtractedTree(extracted, manifest);
    });
    const failingFs = new FailingCrossDeviceRestoreRenameFs(fixture.fs, liveFolderConfig);

    const result = await runRestore({ ...fixture.restoreDeps, fs: failingFs }, { remoteId: fixture.remoteId }, context('exdev-folder-config'));

    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(liveFolderConfig, 'utf8')).toContain('restored-folder-config');
  });

  it('fsyncs the staged file and live directory before completing a cross-device restore swap', async () => {
    const fixture = await createRestoreFixture();
    const folder = fixture.backupManifest.folders[0];
    if (folder === undefined) throw new Error('expected a backed-up folder');
    const liveFolderConfig = path.join(folder.path, '.ai-video-cataloger', 'config.json');
    await fixture.replaceRemoteArchive(async (extracted, manifest) => {
      await writeFile(path.join(extracted, 'folders', folder.folderId, 'config.json'), '{"marker":"restored-folder-config"}\n');
      await rewriteManifestForExtractedTree(extracted, manifest);
    });
    const fsyncingFs = new FsyncingCrossDeviceRestoreRenameFs(fixture.fs, liveFolderConfig);

    const result = await runRestore({ ...fixture.restoreDeps, fs: fsyncingFs }, { remoteId: fixture.remoteId }, context('exdev-fsync'));

    expect(result).toMatchObject({ ok: true });
    expect(fsyncingFs.syncedFiles).toContain(`${liveFolderConfig}.restore-tmp`);
    expect(fsyncingFs.syncedDirectories).toContain(path.dirname(liveFolderConfig));
  });

  it('keeps the rollback marker when post-restore state persistence fails', async () => {
    const fixture = await createRestoreFixture();
    const marker = path.join(fixture.targetHome, '.ai-video-cataloger', 'restore-incomplete.json');

    const result = await runRestore({
      ...fixture.restoreDeps,
      state: new FailingBackupState(),
    }, { remoteId: fixture.remoteId }, context('state-failure'));

    expect(result).toMatchObject({ ok: false, error: { code: 'restore_incomplete' } });
    expect(existsSync(marker)).toBe(true);
  });

  it('leaves the rollback marker and live files untouched while another live process owns the restore', async () => {
    const fixture = await createRestoreFixture();
    const failingFs = new FailingRenameFs(fixture.fs, 2);
    const owner = { pid: 424242, hostname: 'test-host' } as const;
    const result = await runRestore(
      { ...fixture.restoreDeps, fs: failingFs, owner },
      { remoteId: fixture.remoteId },
      context('foreign-owner'),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'restore_incomplete' } });
    const marker = path.join(fixture.targetHome, '.ai-video-cataloger', 'restore-incomplete.json');
    await expectCatalogCounts(fixture.targetHome, { folders: 1, files: 1 });

    const recovered = await performRestoreStartupRecovery({
      fs: fixture.fs,
      homeDirectory: fixture.targetHome,
      isOwnerAlive: (candidate) => candidate.pid === owner.pid,
    });

    expect(recovered).toEqual(ok(undefined));
    expect(existsSync(marker)).toBe(true);
    await expectCatalogCounts(fixture.targetHome, { folders: 1, files: 1 });
  });

  it('refuses an unknown remote id', async () => {
    const fixture = await createRestoreFixture();

    const result = await runRestore(fixture.restoreDeps, { remoteId: 'not-a-real-remote-id' }, context('unknown-remote'));

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a missing backup manifest after extraction', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted) => {
      await rm(path.join(extracted, 'manifest.json'));
    });

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('missing-manifest'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
  });

  it('refuses an unreadable backup manifest after extraction', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted) => {
      await writeFile(path.join(extracted, 'manifest.json'), 'not json');
    });

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('unreadable-manifest'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
  });

  it('refuses a manifest that fails schema validation', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted) => {
      await writeFile(path.join(extracted, 'manifest.json'), `${JSON.stringify({ notAManifest: true }, null, 2)}\n`);
    });

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('invalid-manifest'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
  });

  it('refuses a file size mismatch before touching live files', async () => {
    const fixture = await createRestoreFixture();
    await fixture.replaceRemoteArchive(async (extracted) => {
      await writeFile(path.join(extracted, 'config.json'), '{}');
      await writeFile(path.join(extracted, 'manifest.json'), `${JSON.stringify(fixture.backupManifest, null, 2)}\n`);
    });

    const result = await runRestore(fixture.restoreDeps, { remoteId: fixture.remoteId }, context('size-mismatch'));

    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed', message: expect.stringContaining('size mismatch') } });
  });
});

describe('restoreAdmissionError', () => {
  const baseRecord = (overrides: Partial<JobRecord>): JobRecord => ({
    jobId: 'job-1',
    kind: 'process',
    status: 'running',
    progress: null,
    progressEvents: [],
    error: null,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
    ...overrides,
  });

  it('allows a restore when nothing conflicting is active', () => {
    expect(restoreAdmissionError([baseRecord({ status: 'completed', kind: 'process' })])).toBeNull();
  });

  it('blocks on an active catalog-write resource lease', () => {
    const blocked = restoreAdmissionError([baseRecord({ resourceKey: 'catalog-write' })]);
    expect(blocked).toMatchObject({ code: 'restore_refused' });
  });

  it('blocks on an active backup resource lease', () => {
    const blocked = restoreAdmissionError([baseRecord({ resourceKey: 'backup' })]);
    expect(blocked).toMatchObject({ code: 'restore_refused' });
  });

  it('blocks on an in-flight backup job', () => {
    const blocked = restoreAdmissionError([baseRecord({ kind: 'backup' })]);
    expect(blocked).toMatchObject({ code: 'restore_refused' });
  });

  it('blocks on an in-flight restore job', () => {
    const blocked = restoreAdmissionError([baseRecord({ kind: 'restore' })]);
    expect(blocked).toMatchObject({ code: 'restore_refused' });
  });

  it('ignores queued/running jobs of unrelated kinds with no shared resource', () => {
    expect(restoreAdmissionError([baseRecord({ kind: 'variant_projection', status: 'queued' })])).toBeNull();
  });

  it('blocks while photo proxy and grid thumbnail jobs are active', () => {
    expect(restoreAdmissionError([baseRecord({ kind: 'photo_proxies', status: 'queued' })])).toMatchObject({ code: 'restore_refused' });
    expect(restoreAdmissionError([baseRecord({ kind: 'photo_grid_thumbs', status: 'running' })])).toMatchObject({ code: 'restore_refused' });
  });
});

class TrackingDownloadDestination extends MemoryBackupDestination {
  downloads = 0;

  override async download(remoteId: string, destinationPath: string, signal: AbortSignal): Promise<Result<{ sizeBytes: number }, AppError>> {
    this.downloads += 1;
    return super.download(remoteId, destinationPath, signal);
  }
}

class FailingRenameFs extends NodeFileSystemPort {
  private count = 0;

  constructor(
    private readonly delegate: NodeFileSystemPort,
    private readonly failAt: number,
  ) {
    super({ homeDirectory: delegate.homeDirectory(), workingDirectory: delegate.cwd() });
  }

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    this.count += 1;
    if (this.count === this.failAt) return Promise.resolve({ ok: false, error: appError('internal', 'Injected rename failure') });
    return this.delegate.renamePath(from, to);
  }
}

class FailingCrossDeviceRestoreRenameFs extends NodeFileSystemPort {
  constructor(
    private readonly delegate: NodeFileSystemPort,
    private readonly livePath: string,
  ) {
    super({ homeDirectory: delegate.homeDirectory(), workingDirectory: delegate.cwd() });
  }

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    if (from.includes(`${path.sep}backup-staging${path.sep}`) && to === this.livePath) {
      return Promise.resolve({ ok: false, error: appError('internal', 'EXDEV: cross-device link not permitted') });
    }
    return this.delegate.renamePath(from, to);
  }
}

class FsyncingCrossDeviceRestoreRenameFs extends FailingCrossDeviceRestoreRenameFs {
  readonly syncedFiles: string[] = [];
  readonly syncedDirectories: string[] = [];

  override syncFile(filePath: string): Promise<Result<void, AppError>> {
    this.syncedFiles.push(filePath);
    return Promise.resolve(ok(undefined));
  }

  override syncDirectory(directoryPath: string): Promise<Result<void, AppError>> {
    this.syncedDirectories.push(directoryPath);
    return Promise.resolve(ok(undefined));
  }
}

class FailingBackupState {
  read(): Promise<Result<BackupState | null, AppError>> {
    return Promise.resolve({ ok: false, error: appError('internal', 'Injected state read failure') });
  }

  write(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }
}

const createRestoreFixture = async (): Promise<{
  targetHome: string;
  destination: MemoryBackupDestination;
  remoteId: string;
  remote: RemoteBackup;
  backupManifest: BackupManifest;
  restoreState: BackupStateFile;
  restoreDeps: BackupRestoreDeps;
  fs: NodeFileSystemPort;
  key: Buffer;
  remoteBytes(): Promise<Buffer>;
  replaceRemoteArchive(edit: (extractedDirectory: string, manifest: BackupManifest) => Promise<void>): Promise<void>;
}> => {
  const source = await createCatalogHome('source', 'from-backup');
  const target = await createCatalogHome('target', 'current-target');
  const seededFolder = await source.globalCatalog.upsertFolder({
    folderId: '22222222-2222-4222-8222-222222222222',
    currentPath: source.mediaRoot,
    displayName: 'media',
    firstSeenAt: '2026-09-02T12:00:00.000Z',
    lastSeenAt: '2026-09-02T12:00:00.000Z',
  });
  if (!seededFolder.ok) throw new Error(seededFolder.error.message);
  const seededFile = await source.globalCatalog.upsertFile({
    fingerprint: 'source-file',
    folderId: '22222222-2222-4222-8222-222222222222',
    fileName: 'clip.mp4',
    size: 10,
    durationS: null,
    width: null,
    height: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-09-02T12:00:00.000Z',
    analyzer: null,
    model: null,
    missingAt: null,
    capturedAt: null,
    capturedAtSource: null,
    gpsSource: null,
    gpsAccuracyM: null,
    gpsIntervalKind: null,
    gpsResolvedAt: null,
    place: null,
  });
  if (!seededFile.ok) throw new Error(seededFile.error.message);
  const destination = new MemoryBackupDestination();
  const state = new BackupStateFile({ homeDirectory: source.home });
  const key = Buffer.alloc(32, 7);
  const backupDeps: BackupRunDeps = {
    homeDirectory: source.home,
    owner: TEST_OWNER,
    appVersion: '1.0.0',
    fs: source.fs,
    globalCatalog: source.globalCatalog,
    photos: source.photos,
    destination,
    state,
    now: () => new Date('2026-09-02T12:00:00.000Z'),
    loadEncryptionKey: () => Promise.resolve(ok(key)),
    fingerprintKey: backupKeyFingerprint,
    archive: (entries, targetPath, createdAt, signal) => writeTarZstd(entries, targetPath, createdAt, { signal }),
    encrypt: encryptBackupEnvelope,
  };
  const backedUp = await runBackup(backupDeps, { tier: 'critical', keepLast: 7, keepWeekly: 8 }, context('seed-backup'));
  if (!backedUp.ok) throw new Error(backedUp.error.message);

  const remote = backedUp.value;
  const restoreState = new BackupStateFile({ homeDirectory: target.home });
  const restoreDeps: BackupRestoreDeps = {
    homeDirectory: target.home,
    owner: TEST_OWNER,
    supportedSchemaVersions: { globalCatalog: 16, photos: 6 },
    fs: target.fs,
    globalCatalog: target.globalCatalog,
    photos: target.photos,
    destination,
    state: restoreState,
    now: () => new Date('2026-09-02T13:00:00.000Z'),
    loadEncryptionKey: () => Promise.resolve(ok(key)),
    parseRecoveryKey,
    verifyDatabase: sqliteIntegrityResult,
    decrypt: async (sourcePath, destinationPath, restoreKey, signal) => {
      const { decryptBackupEnvelope } = await import('./envelope.js');
      return decryptBackupEnvelope(sourcePath, destinationPath, restoreKey, signal);
    },
    extract: extractTarZstd,
  };
  const remoteBytes = async (): Promise<Buffer> => {
    const downloadPath = path.join(target.home, 'remote-copy.avcbak');
    const downloaded = await destination.download(remote.remoteId, downloadPath, new AbortController().signal);
    if (!downloaded.ok) throw new Error(downloaded.error.message);
    return readFile(downloadPath);
  };
  const manifest = await readManifestFromRemote(destination, remote.remoteId, key);
  return {
    targetHome: target.home,
    destination,
    remoteId: remote.remoteId,
    remote,
    backupManifest: manifest,
    restoreState,
    restoreDeps,
    fs: target.fs,
    key,
    remoteBytes,
    replaceRemoteArchive: async (edit) => {
      const scratch = await mkdtemp(path.join(tmpdir(), 'avc-restore-edit-'));
      const encrypted = path.join(scratch, 'backup.avcbak');
      const archive = path.join(scratch, 'backup.tar.zst');
      const extracted = path.join(scratch, 'extracted');
      const downloaded = await destination.download(remote.remoteId, encrypted, new AbortController().signal);
      if (!downloaded.ok) throw new Error(downloaded.error.message);
      const { decryptBackupEnvelope } = await import('./envelope.js');
      const decrypted = await decryptBackupEnvelope(encrypted, archive, key);
      if (!decrypted.ok) throw new Error(decrypted.error.message);
      const extractedResult = await extractTarZstd(archive, extracted);
      if (!extractedResult.ok) throw new Error(extractedResult.error.message);
      await edit(extracted, manifest);
      const replacementArchive = path.join(scratch, 'replacement.tar.zst');
      const entries = await tarEntriesFromManifest(extracted, manifest);
      const archived = await writeTarZstd(entries, replacementArchive, manifest.createdAt);
      if (!archived.ok) throw new Error(archived.error.message);
      const replacementEncrypted = path.join(scratch, remote.name);
      const encryptedResult = await encryptBackupEnvelope(replacementArchive, replacementEncrypted, key);
      if (!encryptedResult.ok) throw new Error(encryptedResult.error.message);
      destination.seed(remote, await readFile(replacementEncrypted));
      await rm(scratch, { recursive: true, force: true });
    },
  };
};

const createCatalogHome = async (label: string, configMarker: string): Promise<{
  home: string;
  mediaRoot: string;
  fs: NodeFileSystemPort;
  globalCatalog: SqlJsGlobalCatalogStore;
  photos: SqlJsPhotosStore;
}> => {
  const home = await mkdtemp(path.join(tmpdir(), `avc-restore-${label}-`));
  const appRoot = path.join(home, '.ai-video-cataloger');
  const mediaRoot = path.join(home, 'media');
  mkdirSync(path.join(mediaRoot, '.ai-video-cataloger'), { recursive: true });
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(path.join(appRoot, 'config.json'), `{"marker":"${configMarker}"}\n`);
  writeFileSync(path.join(mediaRoot, '.ai-video-cataloger', 'config.json'), '{}\n');
  const fs = new NodeFileSystemPort({ homeDirectory: home, workingDirectory: home });
  return {
    home,
    mediaRoot,
    fs,
    globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
    photos: new SqlJsPhotosStore({ homeDirectory: home }),
  };
};

const readManifestFromRemote = async (
  destination: MemoryBackupDestination,
  remoteId: string,
  key: Buffer,
): Promise<BackupManifest> => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'avc-restore-manifest-'));
  const encrypted = path.join(scratch, 'backup.avcbak');
  const archive = path.join(scratch, 'backup.tar.zst');
  const extracted = path.join(scratch, 'extracted');
  const downloaded = await destination.download(remoteId, encrypted, new AbortController().signal);
  if (!downloaded.ok) throw new Error(downloaded.error.message);
  const { decryptBackupEnvelope } = await import('./envelope.js');
  const decrypted = await decryptBackupEnvelope(encrypted, archive, key);
  if (!decrypted.ok) throw new Error(decrypted.error.message);
  const extractedResult = await extractTarZstd(archive, extracted);
  if (!extractedResult.ok) throw new Error(extractedResult.error.message);
  const parsed = JSON.parse(readFileSync(path.join(extracted, 'manifest.json'), 'utf8'));
  const { backupManifestSchema } = await import('@core/domain/index.js');
  const manifest = backupManifestSchema.parse(parsed);
  await rm(scratch, { recursive: true, force: true });
  return manifest;
};

const rewriteManifestForExtractedTree = async (extracted: string, manifest: BackupManifest): Promise<void> => {
  const files = [];
  let totalBytes = 0;
  for (const file of manifest.files) {
    const filePath = path.join(extracted, file.path);
    const bytes = await readFile(filePath);
    files.push({ ...file, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    totalBytes += bytes.length;
  }
  await writeFile(path.join(extracted, 'manifest.json'), `${JSON.stringify({ ...manifest, files, totalBytes }, null, 2)}\n`);
};

const tarEntriesFromManifest = async (extracted: string, manifest: BackupManifest) => [
  ...manifest.files.map((file) => ({ archivePath: file.path, sourcePath: path.join(extracted, file.path), kind: 'file' as const })),
  ...(existsSync(path.join(extracted, 'manifest.json'))
    ? [{ archivePath: 'manifest.json', sourcePath: path.join(extracted, 'manifest.json'), kind: 'file' as const }]
    : []),
];

const expectCatalogCounts = async (
  home: string,
  expected: { folders: number; files: number },
): Promise<void> => {
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  const counts = await store.counts();
  expect(counts).toEqual(ok(expect.objectContaining(expected)));
  await store.dispose();
};

const sqliteIntegrity = async (databasePath: string): Promise<boolean> => {
  const result = await sqliteIntegrityResult(databasePath, 'catalog.db');
  return result.ok;
};

const sqliteIntegrityResult = async (databasePath: string, archivePath: string): Promise<Result<void, AppError>> => {
  try {
    const SQL = await initSqlJs();
    const client = new SQL.Database(readFileSync(databasePath));
    try {
      return client.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] === 'ok'
        ? ok(undefined)
        : { ok: false, error: appError('backup_integrity_failed', `Backup database failed integrity_check: ${archivePath}`) };
    } finally {
      client.close();
    }
  } catch {
    return { ok: false, error: appError('backup_integrity_failed', `Backup database failed integrity_check: ${archivePath}`) };
  }
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
