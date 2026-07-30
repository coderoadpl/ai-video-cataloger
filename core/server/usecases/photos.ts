import {
  appError,
  derivedFolderId,
  deriveCapturedAt,
  isSupportedPhotoExtension,
  ok,
  photoExtensionSchema,
  photoFingerprintFromSha256,
  type AppError,
  type PhotoExtension,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type ExifPort,
  type FileSystemPort,
  type JobExecutionContext,
  type JobsPort,
  type PhotoFolderRecord,
  type PhotoRecord,
  type PhotoRunRecord,
  type PhotoSightingRecord,
  type PhotosCounts,
  type PhotosStore,
} from '../ports.js';
import { reportStep as report } from './process-drive-batch.js';
import { shouldSkipDirectory } from './shared.js';

export const PHOTO_SCAN_BATCH_SIZE = 500;

export interface PhotosDeps {
  photos: PhotosStore;
  fs: FileSystemPort;
  exif: ExifPort;
  jobs: JobsPort;
}

export interface PhotoScanSummary {
  media: 'photo';
  root: string;
  runId: string;
  filesTotal: number;
  photosNew: number;
  photosUpdated: number;
  pathsSeen: number;
  skippedUnchanged: number;
  readFailed: number;
  exifRead: number;
  exifFailed: number;
  missingMarked: number;
}

export interface PhotosStatusOutput {
  media: 'photo';
  root: string | null;
  counts: PhotosCounts;
}

export interface PhotosForgetOutput {
  media: 'photo';
  root: string;
  pathsRemoved: number;
  photosDeleted: number;
  photosRepointed: number;
}

const hostUtcOffsetMinutes = (atLocalWallClock: string): number => {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(atLocalWallClock);
  if (match === null) return 0;
  const [, year, month, day, hour, minute, second] = match;
  const asLocal = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return -asLocal.getTimezoneOffset();
};

export const enqueuePhotoScan = async (
  deps: PhotosDeps,
  input: { root: string },
): Promise<Result<{ jobId: string }, AppError>> => {
  const root = deps.fs.resolve(input.root);
  const exists = await deps.fs.exists(root);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('folder_not_found', `Root not found: ${root}`) };
  const directory = await deps.fs.isDirectory(root);
  if (!directory.ok) return directory;
  if (!directory.value) return { ok: false, error: appError('not_a_directory', `Root is not a directory: ${root}`) };

  return deps.jobs.enqueue({
    kind: 'photo_scan',
    payload: { root },
    resourceKey: `photo-scan:${root}`,
    run: (context) => runPhotoScan(deps, { root }, context),
  });
};

export const runPhotoScan = async (
  deps: PhotosDeps,
  input: { root: string },
  progress?: JobExecutionContext,
): Promise<Result<PhotoScanSummary, AppError>> => {
  const root = deps.fs.resolve(input.root);
  const runId = `photo-run-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = new Date().toISOString();

  await report(progress, 'run-started', { root });

  const candidatePaths: string[] = [];
  await walkPhotoTree(deps.fs, root, candidatePaths);
  candidatePaths.sort((left, right) => left.localeCompare(right));

  const counters = {
    photosNew: 0,
    photosUpdated: 0,
    pathsSeen: 0,
    skippedUnchanged: 0,
    readFailed: 0,
    exifRead: 0,
    exifFailed: 0,
    missingMarked: 0,
  };

  let run: PhotoRunRecord = {
    runId,
    root,
    stage: 'scan',
    startedAt,
    finishedAt: null,
    filesTotal: candidatePaths.length,
    filesDone: 0,
    filesSkipped: 0,
    filesFailed: 0,
    lastActivityAt: startedAt,
    batchJson: null,
  };
  const started = await deps.photos.startPhotoRun(run);
  if (!started.ok) return started;

  const batches = chunk(candidatePaths, PHOTO_SCAN_BATCH_SIZE);
  const supersededFingerprints = new Set<string>();
  let processed = 0;
  for (const batch of batches) {
    if (progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const batchResult = await deps.photos.withBatch(async () => {
      for (const filePath of batch) {
        const outcome = await processCandidate(deps, filePath, counters, supersededFingerprints, progress);
        if (!outcome.ok) return outcome;
        processed += 1;
        run = {
          ...run,
          filesDone: run.filesDone + (outcome.value === 'done' ? 1 : 0),
          filesSkipped: run.filesSkipped + (outcome.value === 'skipped' ? 1 : 0),
          filesFailed: run.filesFailed + (outcome.value === 'failed' ? 1 : 0),
          lastActivityAt: new Date().toISOString(),
        };
        await report(progress, 'photo-file', { path: filePath, current: processed, total: candidatePaths.length });
      }
      return deps.photos.updatePhotoRun(run);
    });
    if (!batchResult.ok) return batchResult;
  }

  const reconciled = await reconcileRoot(deps, root, candidatePaths, supersededFingerprints, counters);
  if (!reconciled.ok) return reconciled;

  const finishedAt = new Date().toISOString();
  run = { ...run, finishedAt, lastActivityAt: finishedAt };
  const finalUpdate = await deps.photos.updatePhotoRun(run);
  if (!finalUpdate.ok) return finalUpdate;
  const flushed = await deps.photos.flush();
  if (!flushed.ok) return flushed;

  await report(progress, 'photo-run-summary', { root, runId });

  return ok({
    media: 'photo',
    root,
    runId,
    filesTotal: candidatePaths.length,
    photosNew: counters.photosNew,
    photosUpdated: counters.photosUpdated,
    pathsSeen: counters.pathsSeen,
    skippedUnchanged: counters.skippedUnchanged,
    readFailed: counters.readFailed,
    exifRead: counters.exifRead,
    exifFailed: counters.exifFailed,
    missingMarked: counters.missingMarked,
  });
};

type CandidateOutcome = 'done' | 'skipped' | 'failed';

interface ScanCounters {
  photosNew: number;
  photosUpdated: number;
  pathsSeen: number;
  skippedUnchanged: number;
  readFailed: number;
  exifRead: number;
  exifFailed: number;
  missingMarked: number;
}

const processCandidate = async (
  deps: PhotosDeps,
  filePath: string,
  counters: ScanCounters,
  supersededFingerprints: Set<string>,
  progress: JobExecutionContext | undefined,
): Promise<Result<CandidateOutcome, AppError>> => {
  const stat = await deps.fs.stat(filePath);
  if (!stat.ok) {
    counters.readFailed += 1;
    await report(progress, 'photo-file-skipped', { path: filePath, reason: 'read_failed' });
    return ok('failed');
  }

  const existingSighting = await deps.photos.getSightingByPath(filePath);
  if (!existingSighting.ok) return existingSighting;
  if (existingSighting.value !== null
    && existingSighting.value.size === stat.value.size
    && existingSighting.value.mtimeMs === stat.value.mtimeMs) {
    const refreshed = await deps.photos.upsertSighting({
      ...existingSighting.value,
      lastSeenAt: new Date().toISOString(),
    });
    if (!refreshed.ok) return refreshed;
    counters.skippedUnchanged += 1;
    counters.pathsSeen += 1;
    await report(progress, 'photo-file-skipped', { path: filePath, reason: 'unchanged' });
    return ok('skipped');
  }

  const hash = await deps.fs.fullContentHash(filePath);
  if (!hash.ok) return hash;
  if (hash.value === null) {
    counters.readFailed += 1;
    await report(progress, 'photo-file-skipped', { path: filePath, reason: 'read_failed' });
    return ok('failed');
  }
  const fingerprint = photoFingerprintFromSha256(hash.value);

  if (existingSighting.value !== null && existingSighting.value.fingerprint !== fingerprint) {
    const dropped = await deps.photos.deleteSighting(existingSighting.value.fingerprint, filePath);
    if (!dropped.ok) return dropped;
    supersededFingerprints.add(existingSighting.value.fingerprint);
  }

  const folderPath = deps.fs.dirname(filePath);
  const folderId = derivedFolderId(folderPath);
  const now = new Date().toISOString();
  const folder: PhotoFolderRecord = {
    folderId,
    currentPath: folderPath,
    displayName: deps.fs.basename(folderPath),
    firstSeenAt: now,
    lastSeenAt: now,
    defaultConfigId: null,
  };
  const existingFolder = await deps.photos.getFolder(folderId);
  if (!existingFolder.ok) return existingFolder;
  const upsertedFolder = await deps.photos.upsertFolder({
    ...folder,
    firstSeenAt: existingFolder.value?.firstSeenAt ?? now,
    defaultConfigId: existingFolder.value?.defaultConfigId ?? null,
  });
  if (!upsertedFolder.ok) return upsertedFolder;

  const existingPhoto = await deps.photos.getPhoto(fingerprint);
  if (!existingPhoto.ok) return existingPhoto;

  if (existingPhoto.value === null) {
    const ext = extensionOf(deps.fs, filePath);
    const exifResult = await deps.exif.read(filePath);
    let exifSummary = exifResult.ok ? exifResult.value : null;
    if (!exifResult.ok) {
      await report(progress, 'photo-exif-failed', { path: filePath });
    } else if (exifResult.value === null) {
      await report(progress, 'photo-exif-failed', { path: filePath });
    } else {
      exifSummary = exifResult.value;
      counters.exifRead += 1;
    }
    if (exifSummary === null) counters.exifFailed += 1;
    const captured = deriveCapturedAt(exifSummary, stat.value.mtimeMs, hostUtcOffsetMinutes);
    const photo: PhotoRecord = {
      fingerprint,
      folderId,
      fileName: deps.fs.basename(filePath),
      currentPath: filePath,
      ext,
      size: stat.value.size,
      width: exifSummary?.width ?? null,
      height: exifSummary?.height ?? null,
      orientation: exifSummary?.orientation ?? null,
      cameraMake: exifSummary?.cameraMake ?? null,
      cameraModel: exifSummary?.cameraModel ?? null,
      lens: exifSummary?.lens ?? null,
      iso: exifSummary?.iso ?? null,
      fNumber: exifSummary?.fNumber ?? null,
      exposureTime: exifSummary?.exposureTime ?? null,
      exifRating: exifSummary?.rating ?? null,
      capturedAt: captured.capturedAt,
      capturedAtSource: captured.source,
      gpsLat: exifSummary?.gpsLat ?? null,
      gpsLon: exifSummary?.gpsLon ?? null,
      gpsSource: exifSummary?.gpsLat !== null && exifSummary?.gpsLat !== undefined
        && exifSummary.gpsLon !== null ? 'camera' : null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      placeName: null,
      placeRegion: null,
      placeCountry: null,
      placeCountryCode: null,
      placeDistanceM: null,
      placeDataset: null,
      discoveredAt: now,
      exifReadAt: exifSummary !== null ? now : null,
      proxyState: 'pending',
      proxyWidth: null,
      proxyHeight: null,
      thumbState: 'pending',
      missingAt: null,
      selectedConfigId: null,
    };
    const upsertedPhoto = await deps.photos.upsertPhoto(photo);
    if (!upsertedPhoto.ok) return upsertedPhoto;
    counters.photosNew += 1;
  } else {
    const stillAtOwnerPath = await deps.fs.exists(existingPhoto.value.currentPath);
    if (!stillAtOwnerPath.ok) return stillAtOwnerPath;
    if (!stillAtOwnerPath.value || existingPhoto.value.currentPath === filePath) {
      const repointed = await deps.photos.upsertPhoto({
        ...existingPhoto.value,
        folderId,
        fileName: deps.fs.basename(filePath),
        currentPath: filePath,
        missingAt: null,
      });
      if (!repointed.ok) return repointed;
    }
    counters.photosUpdated += 1;
  }

  const sighting: PhotoSightingRecord = {
    fingerprint,
    currentPath: filePath,
    folderId,
    size: stat.value.size,
    mtimeMs: stat.value.mtimeMs,
    lastSeenAt: now,
  };
  const upsertedSighting = await deps.photos.upsertSighting(sighting);
  if (!upsertedSighting.ok) return upsertedSighting;
  counters.pathsSeen += 1;
  return ok('done');
};

const reconcileRoot = async (
  deps: PhotosDeps,
  root: string,
  seenPaths: readonly string[],
  supersededFingerprints: ReadonlySet<string>,
  counters: ScanCounters,
): Promise<Result<void, AppError>> => {
  return deps.photos.withBatch(async () => {
    const seen = new Set(seenPaths);
    const existing = await deps.photos.listSightingsUnderRoot(root);
    if (!existing.ok) return existing;
    const stale = existing.value.filter((sighting) => !seen.has(sighting.currentPath));
    const affectedFingerprints = new Set([...stale.map((sighting) => sighting.fingerprint), ...supersededFingerprints]);
    for (const sighting of stale) {
      const deleted = await deps.photos.deleteSighting(sighting.fingerprint, sighting.currentPath);
      if (!deleted.ok) return deleted;
    }
    for (const fingerprint of affectedFingerprints) {
      const remaining = await deps.photos.listSightings(fingerprint);
      if (!remaining.ok) return remaining;
      const photoRecord = await deps.photos.getPhoto(fingerprint);
      if (!photoRecord.ok) return photoRecord;
      if (photoRecord.value === null) continue;
      const ownerUnderRoot = photoRecord.value.currentPath === root || photoRecord.value.currentPath.startsWith(`${root}/`);
      if (remaining.value.length === 0) {
        if (ownerUnderRoot) {
          const marked = await deps.photos.upsertPhoto({ ...photoRecord.value, missingAt: Date.now() });
          if (!marked.ok) return marked;
          counters.missingMarked += 1;
        }
        continue;
      }
      const ownerStillPresent = remaining.value.some((sighting) => sighting.currentPath === photoRecord.value?.currentPath);
      if (!ownerStillPresent) {
        const newest = [...remaining.value].sort((left, right) =>
          right.lastSeenAt.localeCompare(left.lastSeenAt) || left.currentPath.localeCompare(right.currentPath))[0];
        if (newest !== undefined) {
          const repointed = await deps.photos.upsertPhoto({
            ...photoRecord.value,
            folderId: newest.folderId,
            currentPath: newest.currentPath,
            missingAt: null,
          });
          if (!repointed.ok) return repointed;
        }
      }
    }
    return ok(undefined);
  });
};

const walkPhotoTree = async (fs: FileSystemPort, folder: string, candidates: string[]): Promise<void> => {
  const listed = await fs.listDirectory(folder);
  if (!listed.ok) return;
  const entries = listed.value.sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of entries) {
    if (entry.kind === 'file') {
      const name = fs.basename(entry.path);
      if (name.startsWith('.') || name.startsWith('._')) continue;
      if (!isSupportedPhotoExtension(name)) continue;
      candidates.push(entry.path);
    } else if (entry.kind === 'directory' && !shouldSkipDirectory(entry.name)) {
      await walkPhotoTree(fs, entry.path, candidates);
    }
  }
};

const extensionOf = (fs: FileSystemPort, filePath: string): PhotoExtension => {
  const extension = fs.extname(filePath).replace(/^\./, '').toLowerCase();
  return photoExtensionSchema.parse(extension);
};

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

export const photosStatus = async (
  deps: PhotosDeps,
  input: { root?: string | undefined },
): Promise<Result<PhotosStatusOutput, AppError>> => {
  const root = input.root === undefined ? null : deps.fs.resolve(input.root);
  const counts = await deps.photos.counts(root);
  if (!counts.ok) return counts;
  return ok({ media: 'photo', root, counts: counts.value });
};

export const photosForget = async (
  deps: PhotosDeps,
  input: { root: string },
): Promise<Result<PhotosForgetOutput, AppError>> => {
  const root = deps.fs.resolve(input.root);
  return deps.photos.withBatch(async (): Promise<Result<PhotosForgetOutput, AppError>> => {
    const sightings = await deps.photos.listSightingsUnderRoot(root);
    if (!sightings.ok) return sightings;
    const byFingerprint = new Map<string, PhotoSightingRecord[]>();
    for (const sighting of sightings.value) {
      const list = byFingerprint.get(sighting.fingerprint) ?? [];
      list.push(sighting);
      byFingerprint.set(sighting.fingerprint, list);
    }
    let pathsRemoved = 0;
    let photosDeleted = 0;
    let photosRepointed = 0;
    for (const [fingerprint, toRemove] of byFingerprint) {
      for (const sighting of toRemove) {
        const deleted = await deps.photos.deleteSighting(fingerprint, sighting.currentPath);
        if (!deleted.ok) return deleted;
        pathsRemoved += 1;
      }
      const remaining = await deps.photos.listSightings(fingerprint);
      if (!remaining.ok) return remaining;
      if (remaining.value.length === 0) {
        const deletedPhoto = await deps.photos.deletePhoto(fingerprint);
        if (!deletedPhoto.ok) return deletedPhoto;
        photosDeleted += 1;
        continue;
      }
      const photoRecord = await deps.photos.getPhoto(fingerprint);
      if (!photoRecord.ok) return photoRecord;
      if (photoRecord.value === null) continue;
      const ownerRemoved = toRemove.some((sighting) => sighting.currentPath === photoRecord.value?.currentPath);
      if (ownerRemoved) {
        const newest = [...remaining.value].sort((left, right) =>
          right.lastSeenAt.localeCompare(left.lastSeenAt) || left.currentPath.localeCompare(right.currentPath))[0];
        if (newest !== undefined) {
          const repointed = await deps.photos.upsertPhoto({
            ...photoRecord.value,
            folderId: newest.folderId,
            currentPath: newest.currentPath,
            missingAt: null,
          });
          if (!repointed.ok) return repointed;
          photosRepointed += 1;
        }
      }
    }
    return ok({ media: 'photo', root, pathsRemoved, photosDeleted, photosRepointed });
  });
};
