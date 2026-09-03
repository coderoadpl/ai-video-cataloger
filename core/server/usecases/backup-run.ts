import { randomUUID } from 'node:crypto';

import {
  appError,
  backupManifestSchema,
  ok,
  type AppError,
  type BackupManifest,
  type BackupState,
  type BackupTier,
  type RemoteBackup,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type BackupDestinationPort,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobKind,
  type JobRecord,
  type JobsPort,
  type PhotosStore,
} from '../ports.js';
import { computeBackupFingerprint } from './backup-fingerprint.js';
import {
  BACKUP_STAGING_OWNER_SUFFIX,
  backupStagingRoot,
  claimBackupStaging,
  readBackupStagingOwner,
  releaseBackupStaging,
  type BackupOwner,
  type BackupOwnerLiveness,
} from './backup-owner.js';
import { selectForDeletion } from './backup-retention.js';
import { collectBackupScope, type BackupScopeEntry } from './backup-scope.js';

export const BACKUP_CONFLICTING_JOB_KINDS: ReadonlySet<JobKind> = new Set([
  'process',
  'process_drive',
  'photo_scan',
  'photo_process',
  'photo_proxies',
  'photo_grid_thumbs',
  'photo_import_libra',
  'faces_index',
  'faces_recluster',
  'faces_exemplars',
  'materialize',
  'thumbnails',
  'gps_backfill',
  'photo_gps_backfill',
]);

export interface BackupStatePort {
  read(): Promise<Result<BackupState | null, AppError>>;
  write(state: BackupState): Promise<Result<void, AppError>>;
}

export interface BackupPreparationDeps {
  homeDirectory: string;
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore | null;
}

export interface BackupRunDeps extends BackupPreparationDeps {
  appVersion: string;
  owner: BackupOwner;
  destination: BackupDestinationPort;
  state: BackupStatePort;
  now(): Date;
  loadEncryptionKey(): Promise<Result<Buffer, AppError>>;
  fingerprintKey(key: Buffer): string;
  archive(
    entries: readonly BackupScopeEntry[],
    targetPath: string,
    createdAt: string,
    signal: AbortSignal,
  ): Promise<Result<{ sizeBytes: number }, AppError>>;
  encrypt(
    sourcePath: string,
    destinationPath: string,
    key: Buffer,
    signal: AbortSignal,
  ): Promise<Result<{ frameCount: number; sizeBytes: number }, AppError>>;
}

export interface BackupRunInput {
  tier: BackupTier;
  keepLast: number;
  keepWeekly: number;
}

export interface PreparedBackupScope {
  entries: BackupScopeEntry[];
  folders: Array<{ folderId: string; path: string }>;
  fingerprint: string;
  snapshots: { globalSchema: number; photosSchema: number };
}

export const runBackup = async (
  deps: BackupRunDeps,
  input: BackupRunInput,
  context: JobExecutionContext,
  resources?: Pick<JobsPort, 'acquireResource'> | undefined,
): Promise<Result<RemoteBackup, AppError>> => {
  const result = await runBackupAttempt(deps, input, context, resources);
  if (!result.ok && !context.signal.aborted && !isCancellation(result.error)) {
    await recordBackupFailure(deps.state, result.error);
  }
  return result;
};

const runBackupAttempt = async (
  deps: BackupRunDeps,
  input: BackupRunInput,
  context: JobExecutionContext,
  resources?: Pick<JobsPort, 'acquireResource'> | undefined,
): Promise<Result<RemoteBackup, AppError>> => {
  const jobId = context.jobId ?? randomUUID();
  const stagingDirectory = deps.fs.join(deps.homeDirectory, '.ai-video-cataloger', 'backup-staging', jobId);
  let uploaded: RemoteBackup | null = null;
  let completed = false;
  try {
    const staging = await claimBackupStaging(deps.fs, stagingDirectory, deps.owner);
    if (!staging.ok) return staging;
    const fingerprinting = await report(context, 'fingerprinting', 5);
    if (!fingerprinting.ok) return fingerprinting;
    const snapshotting = await report(context, 'snapshotting', 15);
    if (!snapshotting.ok) return snapshotting;
    const prepared = await prepareBackupScope(deps, input.tier, stagingDirectory, context.signal, resources);
    if (!prepared.ok) return prepared;
    const createdAt = deps.now().toISOString();
    const key = await deps.loadEncryptionKey();
    if (!key.ok) return key;
    const keyFingerprint = deps.fingerprintKey(key.value);
    const manifest = await createManifest(
      deps,
      input.tier,
      createdAt,
      prepared.value.fingerprint,
      prepared.value.entries,
      prepared.value.folders,
      prepared.value.snapshots,
      keyFingerprint,
    );
    if (!manifest.ok) return manifest;
    const manifestPath = deps.fs.join(stagingDirectory, 'manifest.json');
    const manifestWrite = await deps.fs.writeTextFile(manifestPath, `${JSON.stringify(manifest.value, null, 2)}\n`);
    if (!manifestWrite.ok) return manifestWrite;
    const archiveEntries: BackupScopeEntry[] = [
      ...prepared.value.entries,
      { sourcePath: manifestPath, archivePath: 'manifest.json', kind: 'file' },
    ];
    const archiving = await report(context, 'archiving', 35);
    if (!archiving.ok) return archiving;
    const archivePath = deps.fs.join(stagingDirectory, 'backup.tar.zst');
    const archived = await deps.archive(archiveEntries, archivePath, createdAt, context.signal);
    if (!archived.ok) return archived;
    const encrypting = await report(context, 'encrypting', 55);
    if (!encrypting.ok) return encrypting;
    const encryptedPath = deps.fs.join(stagingDirectory, archiveName(input.tier, createdAt));
    const encrypted = await deps.encrypt(archivePath, encryptedPath, key.value, context.signal);
    if (!encrypted.ok) return encrypted;
    const uploading = await report(context, 'uploading', 75);
    if (!uploading.ok) return uploading;
    const folder = await deps.destination.ensureFolder(context.signal);
    if (!folder.ok) return folder;
    const uploadedResult = await deps.destination.upload({
      sourcePath: encryptedPath,
      name: archiveName(input.tier, createdAt),
      manifest: manifest.value,
    }, context.signal);
    if (!uploadedResult.ok) return uploadedResult;
    uploaded = uploadedResult.value;
    const pruneWarning = await pruneBestEffort(deps.destination, input, deps.now(), keyFingerprint, context.signal);
    const pruning = await report(
      context,
      'pruning',
      90,
      pruneWarning === null ? undefined : { warning: pruneWarning },
    );
    if (!pruning.ok) return pruning;
    if (input.tier === 'critical') {
      const previous = await deps.state.read();
      if (!previous.ok) return previous;
      const written = await deps.state.write({
        lastSuccessAt: createdAt,
        lastFingerprint: prepared.value.fingerprint,
        lastErrorCode: null,
        lastArchiveName: uploaded.name,
        lastRestoreAt: previous.value?.lastRestoreAt ?? null,
      });
      if (!written.ok) return written;
    }
    completed = true;
    return ok(uploaded);
  } finally {
    if (!completed && uploaded !== null) {
      await deps.destination.remove(uploaded.remoteId, new AbortController().signal);
    }
    await releaseBackupStaging(deps.fs, stagingDirectory);
  }
};

export const enqueueBackup = async (
  jobs: JobsPort,
  deps: BackupRunDeps,
  input: BackupRunInput & { manual: boolean },
): Promise<Result<{ jobId: string }, AppError>> => {
  const listed = await jobs.list();
  if (!listed.ok) return listed;
  const admission = backupAdmissionError('backup', listed.value);
  if (admission !== null) return { ok: false, error: admission };
  return jobs.enqueue({
    kind: 'backup',
    payload: { tier: input.tier, manual: input.manual },
    resourceKey: 'backup',
    run: (context) => runBackup(deps, input, context, jobs),
  });
};

export const backupAdmissionError = (incoming: JobKind, records: readonly JobRecord[]): AppError | null => {
  const active = records.filter((record) => record.status === 'queued' || record.status === 'running');
  if (incoming === 'backup' && active.some((record) => BACKUP_CONFLICTING_JOB_KINDS.has(record.kind))) {
    return appError('conflict', 'A catalog job is already queued or running');
  }
  if (BACKUP_CONFLICTING_JOB_KINDS.has(incoming) && active.some((record) => record.kind === 'backup' || record.kind === 'restore')) {
    return appError('conflict', 'A backup or restore job is already queued or running');
  }
  return null;
};

export const cleanupBackupStaging = async (
  fs: FileSystemPort,
  homeDirectory: string,
  isOwnerAlive: BackupOwnerLiveness,
): Promise<Result<void, AppError>> => {
  const root = backupStagingRoot(fs, homeDirectory);
  const exists = await fs.isDirectory(root);
  if (!exists.ok) return exists;
  if (!exists.value) return ok(undefined);
  const listed = await fs.listDirectory(root);
  if (!listed.ok) return listed;
  for (const entry of listed.value) {
    const ownerMarker = entry.kind !== 'directory' && entry.name.endsWith(BACKUP_STAGING_OWNER_SUFFIX);
    if (entry.kind !== 'directory' && !ownerMarker) {
      const removed = await fs.deleteFile(entry.path);
      if (!removed.ok) return removed;
      continue;
    }
    const stagingDirectory = ownerMarker
      ? entry.path.slice(0, entry.path.length - BACKUP_STAGING_OWNER_SUFFIX.length)
      : entry.path;
    const owner = await readBackupStagingOwner(fs, stagingDirectory);
    if (!owner.ok) return owner;
    if (owner.value !== null && isOwnerAlive(owner.value)) continue;
    const removed = await releaseBackupStaging(fs, stagingDirectory);
    if (!removed.ok) return removed;
  }
  return ok(undefined);
};

export const prepareBackupScope = async (
  deps: BackupPreparationDeps,
  tier: BackupTier,
  stagingDirectory: string,
  signal?: AbortSignal | undefined,
  resources?: Pick<JobsPort, 'acquireResource'> | undefined,
): Promise<Result<PreparedBackupScope, AppError>> => {
  const snapshots = await takeSnapshotsWithResource(deps, tier, stagingDirectory, signal, resources);
  if (!snapshots.ok) return snapshots;
  const folders = await deps.globalCatalog.listFolders();
  if (!folders.ok) return folders;
  const folderPaths = folders.value.map((folder) => ({ folderId: folder.folderId, path: folder.currentPath }));
  const scope = await collectBackupScope(deps.fs, {
    tier,
    homeDirectory: deps.homeDirectory,
    globalCatalogSnapshot: snapshots.value.globalCatalog,
    photosSnapshot: snapshots.value.photos,
    folders: folderPaths,
  });
  if (!scope.ok) return scope;
  const fingerprint = await computeBackupFingerprint(deps.fs, scope.value.entries);
  if (!fingerprint.ok) return fingerprint;
  return ok({
    entries: scope.value.entries,
    folders: scope.value.folders,
    fingerprint: fingerprint.value,
    snapshots: { globalSchema: snapshots.value.globalSchema, photosSchema: snapshots.value.photosSchema },
  });
};

const takeSnapshotsWithResource = async (
  deps: BackupPreparationDeps,
  tier: BackupTier,
  stagingDirectory: string,
  signal?: AbortSignal | undefined,
  resources?: Pick<JobsPort, 'acquireResource'> | undefined,
): Promise<Result<{ globalCatalog: string; photos: string | null; globalSchema: number; photosSchema: number }, AppError>> => {
  if (resources === undefined) return takeSnapshots(deps, tier, stagingDirectory, signal);
  const acquired = await resources.acquireResource('catalog-write', signal);
  if (!acquired.ok) return acquired;
  try {
    return await takeSnapshots(deps, tier, stagingDirectory, signal);
  } finally {
    acquired.value();
  }
};

const takeSnapshots = async (
  deps: BackupPreparationDeps,
  tier: BackupTier,
  stagingDirectory: string,
  signal?: AbortSignal | undefined,
): Promise<Result<{ globalCatalog: string; photos: string | null; globalSchema: number; photosSchema: number }, AppError>> => {
  const globalPath = deps.fs.join(stagingDirectory, 'catalog.db');
  if (tier === 'optional') return ok({ globalCatalog: globalPath, photos: null, globalSchema: 0, photosSchema: 0 });
  const global = await deps.globalCatalog.snapshotTo(globalPath, signal);
  if (!global.ok) return global;
  let photosPath: string | null = null;
  let photosSchema = 0;
  if (deps.photos !== null) {
    const exists = await deps.fs.isFile(deps.photos.databasePath());
    if (!exists.ok) return exists;
    if (exists.value) {
      photosPath = deps.fs.join(stagingDirectory, 'photos.db');
      const photos = await deps.photos.snapshotTo(photosPath, signal);
      if (!photos.ok) return photos;
      photosSchema = photos.value.schemaVersion;
    }
  }
  return ok({
    globalCatalog: globalPath,
    photos: photosPath,
    globalSchema: global.value.schemaVersion,
    photosSchema,
  });
};

const createManifest = async (
  deps: BackupRunDeps,
  tier: BackupTier,
  createdAt: string,
  contentFingerprint: string,
  entries: readonly BackupScopeEntry[],
  folders: readonly { folderId: string; path: string }[],
  snapshots: { globalSchema: number; photosSchema: number },
  keyFingerprint: string,
): Promise<Result<BackupManifest, AppError>> => {
  const files: BackupManifest['files'] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const stats = await deps.fs.stat(entry.sourcePath);
    if (!stats.ok) return stats;
    const digest = await deps.fs.fullContentHash(entry.sourcePath);
    if (!digest.ok) return digest;
    if (digest.value === null) {
      return { ok: false, error: appError('backup_integrity_failed', `Could not hash ${entry.archivePath}`) };
    }
    files.push({ path: entry.archivePath, sizeBytes: stats.value.size, sha256: digest.value });
    totalBytes += stats.value.size;
  }
  const parsed = backupManifestSchema.safeParse({
    formatVersion: 1,
    tier,
    createdAt,
    appVersion: deps.appVersion,
    schemaVersions: { globalCatalog: snapshots.globalSchema, photos: snapshots.photosSchema },
    contentFingerprint,
    totalBytes,
    files,
    folders,
    keyFingerprint,
  });
  return parsed.success
    ? ok(parsed.data)
    : { ok: false, error: appError('internal', 'Could not construct backup manifest') };
};

const pruneBestEffort = async (
  destination: BackupDestinationPort,
  input: BackupRunInput,
  now: Date,
  keyFingerprint: string,
  signal: AbortSignal,
): Promise<string | null> => {
  const listed = await destination.list(input.tier, signal);
  if (!listed.ok) return listed.error.message;
  for (const backup of selectForDeletion(listed.value.backups, input, now, keyFingerprint)) {
    const removed = await destination.remove(backup.remoteId, signal);
    if (!removed.ok) return removed.error.message;
  }
  return null;
};

const report = async (
  context: JobExecutionContext,
  step: 'fingerprinting' | 'snapshotting' | 'archiving' | 'encrypting' | 'uploading' | 'pruning',
  percentage: number,
  data?: Record<string, unknown> | undefined,
): Promise<Result<void, AppError>> => {
  if (context.signal.aborted) return cancelled();
  return context.reportProgress({ step, percentage, ...(data === undefined ? {} : { data }) });
};

const cancelled = (): Result<never, AppError> => ({
  ok: false,
  error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE),
});

const isCancellation = (error: AppError): boolean =>
  error.code === 'processing_error' && error.message === JOB_CANCELLED_ERROR_MESSAGE;

const recordBackupFailure = async (state: BackupStatePort, error: AppError): Promise<void> => {
  const previous = await state.read();
  if (!previous.ok) return;
  await state.write({
    lastSuccessAt: previous.value?.lastSuccessAt ?? null,
    lastFingerprint: previous.value?.lastFingerprint ?? null,
    lastErrorCode: error.code,
    lastArchiveName: previous.value?.lastArchiveName ?? null,
    lastRestoreAt: previous.value?.lastRestoreAt ?? null,
  });
};

const archiveName = (tier: BackupTier, createdAt: string): string => {
  const timestamp = createdAt.replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
  return `avc-${tier}-${timestamp}.avcbak`;
};
