import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appError,
  ok,
  type AppError,
  type BackupTier,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';
import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type BackupConnectionReport,
  type BackupDestinationDescription,
  type BackupDestinationPort,
} from '@core/server/index.js';

export interface MemoryBackupDestinationOptions {
  failUpload?: boolean | undefined;
  uploadBarrier?: Promise<void> | undefined;
  failList?: boolean | undefined;
}

interface StoredBackup {
  metadata: RemoteBackup;
  bytes: Buffer;
}

export class MemoryBackupDestination implements BackupDestinationPort {
  private readonly backups = new Map<string, StoredBackup>();
  private readonly failUpload: boolean;
  private readonly uploadBarrier: Promise<void> | undefined;
  private readonly failList: boolean;
  private nextId = 1;

  constructor(options: MemoryBackupDestinationOptions = {}) {
    this.failUpload = options.failUpload ?? false;
    this.uploadBarrier = options.uploadBarrier;
    this.failList = options.failList ?? false;
  }

  describe(): Result<BackupDestinationDescription, AppError> {
    return ok({ provider: 'memory', folderName: 'AI Video Cataloger Backups' });
  }

  test(signal: AbortSignal): Promise<Result<BackupConnectionReport, AppError>> {
    if (signal.aborted) return Promise.resolve(cancelled());
    return Promise.resolve(ok({
      accountEmail: null,
      driveName: null,
      folderName: 'AI Video Cataloger Backups',
      remainingQuotaBytes: null,
    }));
  }

  ensureFolder(signal: AbortSignal): Promise<Result<{ folderId: string; name: string }, AppError>> {
    if (signal.aborted) return Promise.resolve(cancelled());
    return Promise.resolve(ok({ folderId: 'memory-folder', name: 'AI Video Cataloger Backups' }));
  }

  list(tier: BackupTier | null, signal: AbortSignal): Promise<Result<RemoteBackup[], AppError>> {
    if (signal.aborted) return Promise.resolve(cancelled());
    if (this.failList) return Promise.resolve({ ok: false, error: appError('backup_destination_error', 'Memory destination list failed') });
    const backups = [...this.backups.values()]
      .map((stored) => stored.metadata)
      .filter((backup) => tier === null || backup.tier === tier)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return Promise.resolve(ok(backups));
  }

  async upload(
    input: Parameters<BackupDestinationPort['upload']>[0],
    signal: AbortSignal,
  ): Promise<Result<RemoteBackup, AppError>> {
    if (this.failUpload) return { ok: false, error: appError('backup_destination_error', 'Memory destination upload failed') };
    if (this.uploadBarrier !== undefined) {
      const waited = await waitForBarrier(this.uploadBarrier, signal);
      if (!waited.ok) return waited;
    }
    if (signal.aborted) return cancelled();
    let bytes: Buffer;
    try {
      bytes = await readFile(input.sourcePath);
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Memory destination could not read the upload') };
    }
    if (signal.aborted) return cancelled();
    const remoteId = `memory-backup-${String(this.nextId)}`;
    this.nextId += 1;
    const metadata: RemoteBackup = {
      remoteId,
      name: input.name,
      tier: input.manifest.tier,
      createdAt: input.manifest.createdAt,
      sizeBytes: bytes.length,
      appVersion: input.manifest.appVersion,
      schemaVersions: input.manifest.schemaVersions,
    };
    this.backups.set(remoteId, { metadata, bytes });
    return ok(metadata);
  }

  async download(remoteId: string, destinationPath: string, signal: AbortSignal): Promise<Result<{ sizeBytes: number }, AppError>> {
    if (signal.aborted) return cancelled();
    const stored = this.backups.get(remoteId);
    if (stored === undefined) return { ok: false, error: appError('not_found', 'Remote backup not found') };
    try {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, stored.bytes, { mode: 0o600 });
      return ok({ sizeBytes: stored.bytes.length });
    } catch {
      return { ok: false, error: appError('backup_destination_error', 'Memory destination could not write the download') };
    }
  }

  remove(remoteId: string, signal: AbortSignal): Promise<Result<{ removed: boolean }, AppError>> {
    if (signal.aborted) return Promise.resolve(cancelled());
    return Promise.resolve(ok({ removed: this.backups.delete(remoteId) }));
  }
}

const waitForBarrier = (
  barrier: Promise<void>,
  signal: AbortSignal,
): Promise<Result<void, AppError>> => new Promise((resolve) => {
  if (signal.aborted) {
    resolve(cancelled());
    return;
  }
  const onAbort = (): void => resolve(cancelled());
  signal.addEventListener('abort', onAbort, { once: true });
  void barrier.then(() => {
    signal.removeEventListener('abort', onAbort);
    resolve(signal.aborted ? cancelled() : ok(undefined));
  });
});

const cancelled = <T>(): Result<T, AppError> => ({
  ok: false,
  error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE),
});
