import { z } from 'zod';

import {
  appError,
  backupManifestSchema,
  ok,
  type AppError,
  type BackupManifest,
  type BackupPhase,
  type BackupTier,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type BackupDestinationPort,
  type BackupListResult,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobRecord,
  type JobsPort,
  type PhotosStore,
} from '../ports.js';
import {
  writeBackupStagingOwner,
  backupOwnerSchema,
  type BackupOwner,
  type BackupOwnerLiveness,
} from './backup-owner.js';
import { BACKUP_CONFLICTING_JOB_KINDS, type BackupStatePort, prepareBackupScope } from './backup-run.js';

export interface BackupRestoreDeps {
  homeDirectory: string;
  owner: BackupOwner;
  supportedSchemaVersions: BackupManifest['schemaVersions'];
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  destination: BackupDestinationPort;
  state: BackupStatePort;
  now(): Date;
  loadEncryptionKey(): Promise<Result<Buffer, AppError>>;
  parseRecoveryKey(recoveryKey: string): Result<Buffer, AppError>;
  verifyDatabase(databasePath: string, archivePath: string): Promise<Result<void, AppError>>;
  decrypt(
    sourcePath: string,
    destinationPath: string,
    key: Buffer,
    signal: AbortSignal,
  ): Promise<Result<{ frameCount: number; sizeBytes: number }, AppError>>;
  extract(
    archivePath: string,
    destinationDirectory: string,
    signal: AbortSignal,
  ): Promise<Result<{ files: string[] }, AppError>>;
}

export interface BackupRestoreInput {
  remoteId: string;
  recoveryKey?: string | undefined;
}

export interface BackupRestoreOutcome {
  restored: RemoteBackup;
  relaunchRequired: true;
  preRestoreDirectory: string;
}

export const listBackups = (
  destination: BackupDestinationPort,
  tier: BackupTier | null,
  signal: AbortSignal,
): Promise<Result<BackupListResult, AppError>> => destination.list(tier, signal);

export const enqueueRestore = async (
  jobs: JobsPort,
  deps: BackupRestoreDeps,
  input: BackupRestoreInput,
): Promise<Result<{ jobId: string }, AppError>> => {
  const listed = await jobs.list();
  if (!listed.ok) return listed;
  const admission = restoreAdmissionError(listed.value);
  if (admission !== null) return { ok: false, error: admission };
  return jobs.enqueue({
    kind: 'restore',
    payload: { remoteId: input.remoteId },
    resourceKey: 'backup',
    run: (context) => runRestore(deps, input, context),
  });
};

export const runRestore = async (
  deps: BackupRestoreDeps,
  input: BackupRestoreInput,
  context: JobExecutionContext,
): Promise<Result<BackupRestoreOutcome, AppError>> => {
  const jobId = context.jobId ?? input.remoteId;
  const stagingDirectory = deps.fs.join(deps.homeDirectory, '.ai-video-cataloger', 'backup-staging', jobId);
  try {
    const remote = await findRemoteBackup(deps.destination, input.remoteId, context.signal);
    if (!remote.ok) return remote;
    const compatible = schemaCompatible(remote.value, deps.supportedSchemaVersions);
    if (!compatible.ok) return compatible;
    const created = await deps.fs.ensureDirectory(stagingDirectory);
    if (!created.ok) return created;
    const owned = await writeBackupStagingOwner(deps.fs, stagingDirectory, deps.owner);
    if (!owned.ok) return owned;
    const downloading = await report(context, 'downloading', 15);
    if (!downloading.ok) return downloading;
    const encryptedPath = deps.fs.join(stagingDirectory, remote.value.name);
    const downloaded = await deps.destination.download(remote.value.remoteId, encryptedPath, context.signal);
    if (!downloaded.ok) return downloaded;
    const decrypting = await report(context, 'decrypting', 35);
    if (!decrypting.ok) return decrypting;
    const key = await restoreKey(deps, input.recoveryKey);
    if (!key.ok) return key;
    const archivePath = deps.fs.join(stagingDirectory, 'backup.tar.zst');
    const decrypted = await deps.decrypt(encryptedPath, archivePath, key.value, context.signal);
    if (!decrypted.ok) return decrypted;
    const verifying = await report(context, 'verifying', 60);
    if (!verifying.ok) return verifying;
    const extractedDirectory = deps.fs.join(stagingDirectory, 'extracted');
    const extracted = await deps.extract(archivePath, extractedDirectory, context.signal);
    if (!extracted.ok) return extracted;
    const manifest = await readManifest(deps.fs, deps.fs.join(extractedDirectory, 'manifest.json'));
    if (!manifest.ok) return manifest;
    const manifestCompatible = schemaCompatible({
      ...remote.value,
      schemaVersions: manifest.value.schemaVersions,
      appVersion: manifest.value.appVersion,
    }, deps.supportedSchemaVersions);
    if (!manifestCompatible.ok) return manifestCompatible;
    const verified = await verifyExtractedBackup(deps, extractedDirectory, manifest.value);
    if (!verified.ok) return verified;
    const preRestore = await createPreRestoreBackup(deps, context.signal);
    if (!preRestore.ok) return preRestore;
    const restoring = await report(context, 'restoring', 85);
    if (!restoring.ok) return restoring;
    const plan = restorePlan(deps.fs, deps.homeDirectory, extractedDirectory, manifest.value);
    const marker = await writeRestoreMarker(deps.fs, deps.homeDirectory, {
      owner: deps.owner,
      preRestoreDirectory: preRestore.value.directory,
      restoredFiles: plan.map((entry) => ({ archivePath: entry.archivePath, livePath: entry.livePath })),
      preRestoreArchivePaths: preRestore.value.archivePaths,
    });
    if (!marker.ok) return marker;
    await deps.photos.dispose();
    await deps.globalCatalog.dispose();
    for (const entry of plan) {
      const moved = await stageAndSwapRestoredFile(deps.fs, entry.restoredPath, entry.livePath);
      if (!moved.ok) return restoreIncomplete();
    }
    const previous = await deps.state.read();
    if (!previous.ok) return restoreIncomplete();
    const restoredAt = deps.now().toISOString();
    const stateWritten = await deps.state.write({
      lastSuccessAt: previous.value?.lastSuccessAt ?? null,
      lastFingerprint: previous.value?.lastFingerprint ?? null,
      lastErrorCode: null,
      lastArchiveName: previous.value?.lastArchiveName ?? null,
      lastRestoreAt: restoredAt,
    });
    if (!stateWritten.ok) return restoreIncomplete();
    const pruned = await prunePreRestoreDirectories(deps.fs, deps.homeDirectory);
    if (!pruned.ok) return restoreIncomplete();
    const markerRemoved = await deps.fs.deleteFile(restoreMarkerPath(deps.fs, deps.homeDirectory));
    if (!markerRemoved.ok) return markerRemoved;
    return ok({ restored: remote.value, relaunchRequired: true, preRestoreDirectory: preRestore.value.directory });
  } finally {
    await deps.fs.deletePath(stagingDirectory);
  }
};

export const performRestoreStartupRecovery = async (
  deps: { fs: FileSystemPort; homeDirectory: string; isOwnerAlive: BackupOwnerLiveness },
): Promise<Result<void, AppError>> => {
  const markerPath = restoreMarkerPath(deps.fs, deps.homeDirectory);
  const markerText = await deps.fs.readTextFile(markerPath);
  if (!markerText.ok) return markerText;
  if (markerText.value !== null) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(markerText.value);
    } catch {
      return { ok: false, error: appError('backup_integrity_failed', 'Restore rollback marker is unreadable') };
    }
    const parsed = restoreMarkerSchema.safeParse(decoded);
    if (!parsed.success) return { ok: false, error: appError('backup_integrity_failed', 'Restore rollback marker is invalid') };
    const owner = parsed.data.owner;
    if (owner !== undefined && deps.isOwnerAlive(owner)) return ok(undefined);
    const preRestorePaths = new Set(parsed.data.preRestoreArchivePaths);
    for (const file of parsed.data.restoredFiles) {
      const backupPath = deps.fs.join(parsed.data.preRestoreDirectory, ...file.archivePath.split('/'));
      if (preRestorePaths.has(file.archivePath)) {
        const parent = await deps.fs.ensureDirectory(deps.fs.dirname(file.livePath));
        if (!parent.ok) return parent;
        const copied = await deps.fs.copyFile(backupPath, file.livePath);
        if (!copied.ok) return copied;
      } else {
        const deleted = await deps.fs.deleteFile(file.livePath);
        if (!deleted.ok) return deleted;
      }
    }
    const deleted = await deps.fs.deleteFile(markerPath);
    if (!deleted.ok) return deleted;
  }
  return prunePreRestoreDirectories(deps.fs, deps.homeDirectory);
};

export const restoreAdmissionError = (records: readonly JobRecord[]): AppError | null => {
  const active = records.filter((record) => record.status === 'queued' || record.status === 'running');
  const blocker = active.find((record) =>
    record.resourceKey === 'catalog-write'
    || record.resourceKey === 'backup'
    || BACKUP_CONFLICTING_JOB_KINDS.has(record.kind)
    || record.kind === 'backup'
    || record.kind === 'restore');
  return blocker === undefined
    ? null
    : appError('restore_refused', `Restore is blocked by a ${blocker.kind} job`);
};

const restoreMarkerSchema = z.object({
  owner: backupOwnerSchema.optional(),
  preRestoreDirectory: z.string().min(1),
  restoredFiles: z.array(z.object({
    archivePath: z.string().min(1),
    livePath: z.string().min(1),
  }).strict()),
  preRestoreArchivePaths: z.array(z.string().min(1)),
}).strict();

type RestoreMarker = z.output<typeof restoreMarkerSchema>;

const findRemoteBackup = async (
  destination: BackupDestinationPort,
  remoteId: string,
  signal: AbortSignal,
): Promise<Result<RemoteBackup, AppError>> => {
  const listed = await destination.list(null, signal);
  if (!listed.ok) return listed;
  const remote = listed.value.backups.find((backup) => backup.remoteId === remoteId);
  return remote === undefined
    ? { ok: false, error: appError('not_found', 'Remote backup not found') }
    : ok(remote);
};

const schemaCompatible = (
  remote: Pick<RemoteBackup, 'schemaVersions' | 'appVersion'>,
  supported: BackupManifest['schemaVersions'],
): Result<void, AppError> => {
  if (remote.schemaVersions.globalCatalog > supported.globalCatalog || remote.schemaVersions.photos > supported.photos) {
    return {
      ok: false,
      error: appError('snapshot_incompatible', `Backup was written by app version ${remote.appVersion} and requires a newer app`),
    };
  }
  return ok(undefined);
};

const restoreKey = async (
  deps: BackupRestoreDeps,
  recoveryKey: string | undefined,
): Promise<Result<Buffer, AppError>> => {
  if (recoveryKey !== undefined) return deps.parseRecoveryKey(recoveryKey);
  return deps.loadEncryptionKey();
};

const readManifest = async (
  fs: FileSystemPort,
  manifestPath: string,
): Promise<Result<BackupManifest, AppError>> => {
  const text = await fs.readTextFile(manifestPath);
  if (!text.ok) return text;
  if (text.value === null) return { ok: false, error: appError('backup_integrity_failed', 'Backup manifest is missing') };
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.value);
  } catch {
    return { ok: false, error: appError('backup_integrity_failed', 'Backup manifest is unreadable') };
  }
  const parsed = backupManifestSchema.safeParse(decoded);
  return parsed.success
    ? ok(parsed.data)
    : { ok: false, error: appError('backup_integrity_failed', 'Backup manifest is invalid') };
};

const verifyExtractedBackup = async (
  deps: BackupRestoreDeps,
  extractedDirectory: string,
  manifest: BackupManifest,
): Promise<Result<void, AppError>> => {
  for (const file of manifest.files) {
    const extractedPath = deps.fs.join(extractedDirectory, ...file.path.split('/'));
    const stats = await deps.fs.stat(extractedPath);
    if (!stats.ok) return mapIntegrity(stats);
    if (stats.value.size !== file.sizeBytes) {
      return { ok: false, error: appError('backup_integrity_failed', `Backup file size mismatch: ${file.path}`) };
    }
    const hash = await deps.fs.fullContentHash(extractedPath);
    if (!hash.ok) return hash;
    if (hash.value !== file.sha256) {
      return { ok: false, error: appError('backup_integrity_failed', `Backup file hash mismatch: ${file.path}`) };
    }
    if (file.path === 'catalog.db' || file.path === 'photos.db') {
      const integrity = await deps.verifyDatabase(extractedPath, file.path);
      if (!integrity.ok) return integrity;
    }
  }
  return ok(undefined);
};

const createPreRestoreBackup = async (
  deps: BackupRestoreDeps,
  signal: AbortSignal,
): Promise<Result<{ directory: string; archivePaths: string[] }, AppError>> => {
  const directory = deps.fs.join(
    deps.homeDirectory,
    '.ai-video-cataloger',
    'pre-restore',
    deps.now().toISOString().replaceAll(':', '-'),
  );
  const created = await deps.fs.ensureDirectory(directory);
  if (!created.ok) return created;
  const prepared = await prepareBackupScope(deps, 'critical', directory, signal);
  if (!prepared.ok) return prepared;
  const archivePaths: string[] = [];
  for (const entry of prepared.value.entries) {
    const targetPath = deps.fs.join(directory, ...entry.archivePath.split('/'));
    archivePaths.push(entry.archivePath);
    if (entry.sourcePath === targetPath) continue;
    const parent = await deps.fs.ensureDirectory(deps.fs.dirname(targetPath));
    if (!parent.ok) return parent;
    const copied = await deps.fs.copyFile(entry.sourcePath, targetPath);
    if (!copied.ok) return copied;
  }
  const verified = await verifyLocalBackup(deps, directory, archivePaths);
  if (!verified.ok) return verified;
  return ok({ directory, archivePaths });
};

const verifyLocalBackup = async (
  deps: BackupRestoreDeps,
  directory: string,
  archivePaths: readonly string[],
): Promise<Result<void, AppError>> => {
  for (const archivePath of archivePaths) {
    const filePath = deps.fs.join(directory, ...archivePath.split('/'));
    const exists = await deps.fs.isFile(filePath);
    if (!exists.ok) return exists;
    if (!exists.value) return { ok: false, error: appError('backup_integrity_failed', `Pre-restore file is missing: ${archivePath}`) };
    if (archivePath === 'catalog.db' || archivePath === 'photos.db') {
      const integrity = await deps.verifyDatabase(filePath, archivePath);
      if (!integrity.ok) return integrity;
    }
  }
  return ok(undefined);
};

const restorePlan = (
  fs: FileSystemPort,
  homeDirectory: string,
  extractedDirectory: string,
  manifest: BackupManifest,
): Array<{ archivePath: string; restoredPath: string; livePath: string }> =>
  manifest.files.flatMap((file) => {
    const livePath = livePathForArchivePath(fs, homeDirectory, file.path, manifest.folders);
    return livePath === null
      ? []
      : [{ archivePath: file.path, restoredPath: fs.join(extractedDirectory, ...file.path.split('/')), livePath }];
  });

const stageAndSwapRestoredFile = async (
  fs: FileSystemPort,
  restoredPath: string,
  livePath: string,
): Promise<Result<void, AppError>> => {
  const parentPath = fs.dirname(livePath);
  const parent = await fs.ensureDirectory(parentPath);
  if (!parent.ok) return parent;
  const stagedPath = `${livePath}.restore-tmp`;
  const copied = await fs.copyFile(restoredPath, stagedPath);
  if (!copied.ok) return copied;
  const fileSynced = await fs.syncFile(stagedPath);
  if (!fileSynced.ok) {
    await fs.deleteFile(stagedPath);
    return fileSynced;
  }
  const renamed = await fs.renamePath(stagedPath, livePath);
  if (renamed.ok) {
    const directorySynced = await fs.syncDirectory(parentPath);
    if (!directorySynced.ok) return directorySynced;
    return renamed;
  }
  await fs.deleteFile(stagedPath);
  return renamed;
};

const restoreIncomplete = (): Result<never, AppError> => ({
  ok: false,
  error: appError(
    'restore_incomplete',
    'Restore did not finish. Restart the app so it can roll back from the local pre-restore copy.',
  ),
});

const livePathForArchivePath = (
  fs: FileSystemPort,
  homeDirectory: string,
  archivePath: string,
  folders: readonly { folderId: string; path: string }[],
): string | null => {
  const appRoot = fs.join(homeDirectory, '.ai-video-cataloger');
  if (archivePath === 'catalog.db') return fs.join(appRoot, 'catalog.db');
  if (archivePath === 'photos.db') return fs.join(appRoot, 'photos.db');
  if (archivePath === 'config.json') return fs.join(appRoot, 'config.json');
  if (archivePath.startsWith('faces/obs/')) return fs.join(appRoot, ...archivePath.split('/'));
  if (archivePath.startsWith('photo-artifacts/') || archivePath.startsWith('read-only-folders/')) {
    return fs.join(appRoot, ...archivePath.split('/'));
  }
  const match = /^folders\/([^/]+)\/config\.json$/.exec(archivePath);
  if (match === null) return null;
  const folderId = match[1];
  const folder = folders.find((entry) => entry.folderId === folderId);
  return folder === undefined ? null : fs.join(folder.path, '.ai-video-cataloger', 'config.json');
};

const writeRestoreMarker = async (
  fs: FileSystemPort,
  homeDirectory: string,
  marker: RestoreMarker,
): Promise<Result<void, AppError>> => {
  const parsed = restoreMarkerSchema.safeParse(marker);
  if (!parsed.success) return { ok: false, error: appError('internal', 'Restore marker is invalid') };
  return fs.writeTextFile(restoreMarkerPath(fs, homeDirectory), `${JSON.stringify(parsed.data, null, 2)}\n`);
};

const restoreMarkerPath = (fs: FileSystemPort, homeDirectory: string): string =>
  fs.join(homeDirectory, '.ai-video-cataloger', 'restore-incomplete.json');

const prunePreRestoreDirectories = async (
  fs: FileSystemPort,
  homeDirectory: string,
): Promise<Result<void, AppError>> => {
  const root = fs.join(homeDirectory, '.ai-video-cataloger', 'pre-restore');
  const exists = await fs.isDirectory(root);
  if (!exists.ok) return exists;
  if (!exists.value) return ok(undefined);
  const listed = await fs.listDirectory(root);
  if (!listed.ok) return listed;
  const directories = listed.value
    .filter((entry) => entry.kind === 'directory')
    .sort((left, right) => right.name.localeCompare(left.name));
  for (const entry of directories.slice(3)) {
    const deleted = await fs.deletePath(entry.path);
    if (!deleted.ok) return deleted;
  }
  return ok(undefined);
};

const mapIntegrity = <T>(result: Result<T, AppError>): Result<T, AppError> =>
  result.ok ? result : { ok: false, error: appError('backup_integrity_failed', result.error.message) };

const report = async (
  context: JobExecutionContext,
  step: Extract<BackupPhase, 'downloading' | 'decrypting' | 'verifying' | 'restoring'>,
  percentage: number,
): Promise<Result<void, AppError>> => {
  if (context.signal.aborted) {
    return {
      ok: false,
      error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE),
    };
  }
  return context.reportProgress({ step, percentage });
};
