import {
  appError,
  analyzerProviderConfigSchema,
  buildPhotoConfigDescriptor,
  canonicalJson,
  clampPhotoBatchSize,
  configValueSchema,
  derivedFolderId,
  deriveCapturedAt,
  geminiCostEstimateFromUsage,
  isSupportedPhotoExtension,
  ok,
  outputLanguageSchema,
  parsePhotoBatchResponse,
  photoConfigId,
  resolveDescriptorLanguages,
  resolvePromptLanguage,
  type PhotoConfigDescriptor,
  photoExtensionSchema,
  photoFingerprintFromSha256,
  spendLedgerEntrySchema,
  spendMonth,
  splitPhotoBatch,
  PHOTO_ANALYSIS_PROMPT_VERSION,
  uiLanguageSchema,
  type AnalyzerProviderConfig,
  type AppConfig,
  type AppError,
  type GeminiCostEstimate,
  type PhotoExtension,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AnalyzePhotoItem,
  type AnalyzerPort,
  type CatalogFilePerson,
  type ConfigStore,
  type ExifPort,
  type FileSystemPort,
  type FaceEnginePort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobsPort,
  type MediaPort,
  type ModelDownloadPort,
  type PhotoFolderRecord,
  type PhotoAnalysisError,
  type PhotoListItem,
  type PhotoMediaPort,
  type PhotoProxyCandidate,
  type PhotoRecord,
  type PhotoRootSummary,
  type PhotoRunRecord,
  type PhotoSearchRow,
  type PhotoSightingRecord,
  type PhotosCounts,
  type PhotosStore,
  type PhotoVariantRecord,
  type SpendLedgerPort,
} from '../ports.js';
import { geminiMonthlyBudget, monthlyBudgetExceeded, type BudgetExceeded } from './budget.js';
import { resolveConfigValues } from './config-resolution.js';
import { photoArtifactsRoot, photoGridThumbPath, photoProxyPath, photoThumbPath } from './photo-artifacts.js';
import { reportStep as report } from './process-drive-batch.js';
import { buildSearchMatch, sanitizeSearchQuery } from './search.js';
import { isUnderExcludedDirectory, shouldSkipDirectory } from './shared.js';
import { generateGridThumbnail, type GridThumbnailCandidate } from './thumbnail.js';
import { faceArtifactsInstalled, facesEnabled, runPhotoFacesIndexPass } from './faces.js';

export const PHOTO_SCAN_BATCH_SIZE = 500;
export const PHOTO_PROXY_CONCURRENCY = 4;
export const PHOTO_PROXY_CHECKPOINT_SIZE = 50;

export interface PhotosDeps {
  photos: PhotosStore;
  fs: FileSystemPort;
  exif: ExifPort;
  jobs: JobsPort;
  photoMedia: PhotoMediaPort;
  media: MediaPort;
  config: ConfigStore;
  analyzer: AnalyzerPort;
  downloads?: ModelDownloadPort | undefined;
  faceEngine?: FaceEnginePort | undefined;
  globalCatalog?: GlobalCatalogStore | undefined;
  spendLedger?: SpendLedgerPort | undefined;
}

export interface PhotoScanProxiesSummary {
  ran: boolean;
  generated: number;
  skippedExisting: number;
  failed: number;
  skippedReason: string | null;
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
  folderReadErrors: number;
  proxies: PhotoScanProxiesSummary;
}

export interface PhotoProxiesSummary {
  media: 'photo';
  root: string;
  force: boolean;
  candidates: number;
  generated: number;
  skippedExisting: number;
  failed: number;
  thumbFailed: number;
  gridFailed: number;
}

export interface PhotosStatusOutput {
  media: 'photo';
  root: string | null;
  durability: ReturnType<PhotosStore['durabilityStatus']>;
  counts: PhotosCounts;
}

export interface PhotosForgetOutput {
  media: 'photo';
  root: string;
  pathsRemoved: number;
  photosDeleted: number;
  photosRepointed: number;
  artifactPaths: string[];
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
  const unreadableFolders: string[] = [];
  await walkPhotoTree(deps.fs, root, candidatePaths, unreadableFolders);
  candidatePaths.sort((left, right) => left.localeCompare(right));
  for (const folder of unreadableFolders) {
    await report(progress, 'photo-folder-skipped', { path: folder, reason: 'read_error' });
  }

  const counters = {
    photosNew: 0,
    photosUpdated: 0,
    pathsSeen: 0,
    skippedUnchanged: 0,
    readFailed: 0,
    exifRead: 0,
    exifFailed: 0,
    missingMarked: 0,
    folderReadErrors: unreadableFolders.length,
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

  const reconciled = await reconcileRoot(deps, root, candidatePaths, supersededFingerprints, unreadableFolders, counters);
  if (!reconciled.ok) return reconciled;

  const finishedAt = new Date().toISOString();
  run = { ...run, finishedAt, lastActivityAt: finishedAt };
  const finalUpdate = await deps.photos.updatePhotoRun(run);
  if (!finalUpdate.ok) return finalUpdate;
  const flushed = await deps.photos.flush();
  if (!flushed.ok) return flushed;

  await report(progress, 'photo-run-summary', { root, runId, filesTotal: candidatePaths.length, ...counters });

  const proxies = await runChainedProxiesPass(deps, root, progress);

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
    folderReadErrors: counters.folderReadErrors,
    proxies,
  });
};

const isAborted = (progress: JobExecutionContext | undefined): boolean => progress?.signal.aborted === true;

const runChainedProxiesPass = async (
  deps: PhotosDeps,
  root: string,
  progress: JobExecutionContext | undefined,
): Promise<PhotoScanProxiesSummary> => {
  if (isAborted(progress)) {
    await report(progress, 'photo-proxies-skipped', { root, reason: 'cancelled' });
    return { ran: false, generated: 0, skippedExisting: 0, failed: 0, skippedReason: 'cancelled' };
  }
  const pass = await runPhotoProxiesPass(deps, { root, force: false }, progress);
  if (!pass.ok) {
    const reason = isAborted(progress) ? 'cancelled' : 'failed';
    await report(progress, 'photo-proxies-skipped', { root, reason });
    return { ran: false, generated: 0, skippedExisting: 0, failed: 0, skippedReason: reason };
  }
  return {
    ran: true,
    generated: pass.value.generated,
    skippedExisting: pass.value.skippedExisting,
    failed: pass.value.failed,
    skippedReason: null,
  };
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
  folderReadErrors: number;
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
    return recordCandidateReadFailure(filePath, counters, progress);
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
  if (!hash.ok) {
    if (hash.error.code !== 'read_error') return hash;
    return recordCandidateReadFailure(filePath, counters, progress);
  }
  if (hash.value === null) {
    return recordCandidateReadFailure(filePath, counters, progress);
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

const recordCandidateReadFailure = async (
  filePath: string,
  counters: ScanCounters,
  progress: JobExecutionContext | undefined,
): Promise<Result<CandidateOutcome, AppError>> => {
  counters.readFailed += 1;
  await report(progress, 'photo-file-skipped', { path: filePath, reason: 'read_failed' });
  return ok('failed');
};

const isUnderUnreadableFolder = (currentPath: string, unreadableFolders: readonly string[]): boolean =>
  unreadableFolders.some((folder) => currentPath === folder || currentPath.startsWith(`${folder}/`));

const reconcileRoot = async (
  deps: PhotosDeps,
  root: string,
  seenPaths: readonly string[],
  supersededFingerprints: ReadonlySet<string>,
  unreadableFolders: readonly string[],
  counters: ScanCounters,
): Promise<Result<void, AppError>> => {
  return deps.photos.withBatch(async () => {
    const seen = new Set(seenPaths);
    const existing = await deps.photos.listSightingsUnderRoot(root);
    if (!existing.ok) return existing;
    const stale = existing.value.filter(
      (sighting) => !seen.has(sighting.currentPath) && !isUnderUnreadableFolder(sighting.currentPath, unreadableFolders),
    );
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
          if (isUnderExcludedDirectory(deps.fs, photoRecord.value.currentPath)) {
            const dropped = await deps.photos.deletePhoto(fingerprint);
            if (!dropped.ok) return dropped;
          } else {
            const marked = await deps.photos.upsertPhoto({ ...photoRecord.value, missingAt: Date.now() });
            if (!marked.ok) return marked;
            counters.missingMarked += 1;
          }
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

const walkPhotoTree = async (
  fs: FileSystemPort,
  folder: string,
  candidates: string[],
  unreadableFolders: string[],
): Promise<void> => {
  const listed = await fs.listDirectory(folder);
  if (!listed.ok) {
    unreadableFolders.push(folder);
    return;
  }
  const entries = listed.value.sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of entries) {
    if (entry.kind === 'file') {
      const name = fs.basename(entry.path);
      if (name.startsWith('.') || name.startsWith('._')) continue;
      if (!isSupportedPhotoExtension(name)) continue;
      candidates.push(entry.path);
    } else if (entry.kind === 'directory' && !shouldSkipDirectory(entry.name)) {
      await walkPhotoTree(fs, entry.path, candidates, unreadableFolders);
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

export const enqueuePhotoProxies = async (
  deps: PhotosDeps,
  input: { root: string; force: boolean },
): Promise<Result<{ jobId: string }, AppError>> => {
  const root = deps.fs.resolve(input.root);
  const exists = await deps.fs.exists(root);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('folder_not_found', `Root not found: ${root}`) };
  const directory = await deps.fs.isDirectory(root);
  if (!directory.ok) return directory;
  if (!directory.value) return { ok: false, error: appError('not_a_directory', `Root is not a directory: ${root}`) };

  return deps.jobs.enqueue({
    kind: 'photo_proxies',
    payload: { root, force: input.force },
    resourceKey: `photo-proxies:${root}`,
    run: (context) => runPhotoProxiesPass(deps, { root, force: input.force }, context),
  });
};

interface ProxyCounters {
  generated: number;
  skippedExisting: number;
  failed: number;
  thumbFailed: number;
  gridFailed: number;
}

export const runPhotoProxiesPass = async (
  deps: PhotosDeps,
  input: { root: string; force: boolean },
  progress?: JobExecutionContext,
): Promise<Result<PhotoProxiesSummary, AppError>> => {
  const root = deps.fs.resolve(input.root);
  const candidatesResult = await deps.photos.listProxyCandidates(root);
  if (!candidatesResult.ok) return candidatesResult;
  const candidates = candidatesResult.value;
  await report(progress, 'photo-proxies-scanning', { root, candidates: candidates.length });

  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const counters: ProxyCounters = { generated: 0, skippedExisting: 0, failed: 0, thumbFailed: 0, gridFailed: 0 };
  const batches = chunk(candidates, PHOTO_SCAN_BATCH_SIZE);
  let processed = 0;

  for (const batch of batches) {
    if (progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const batchResult = await deps.photos.withBatch(async (): Promise<Result<void, AppError>> => {
      let cursor = 0;
      const runWorker = async (): Promise<Result<void, AppError>> => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= batch.length) return ok(undefined);
          const candidate = batch[index];
          if (candidate === undefined) continue;
          const outcome = await processProxyCandidate(deps, artifactsRoot, candidate, input.force, counters, progress);
          if (!outcome.ok) return outcome;
          processed += 1;
          const completed = processed;
          await report(progress, 'photo-proxy', {
            fingerprint: candidate.fingerprint,
            current: completed,
            total: candidates.length,
          });
          if (completed % PHOTO_PROXY_CHECKPOINT_SIZE === 0) {
            const checkpointed = await deps.photos.checkpoint();
            if (!checkpointed.ok) return checkpointed;
          }
        }
      };
      const workerCount = Math.min(PHOTO_PROXY_CONCURRENCY, Math.max(batch.length, 1));
      const results = await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      return results.find((result) => !result.ok) ?? ok(undefined);
    });
    if (!batchResult.ok) return batchResult;
  }

  const flushed = await deps.photos.flush();
  if (!flushed.ok) return flushed;
  await report(progress, 'photo-proxies-summary', { root });

  return ok({
    media: 'photo',
    root,
    force: input.force,
    candidates: candidates.length,
    generated: counters.generated,
    skippedExisting: counters.skippedExisting,
    failed: counters.failed,
    thumbFailed: counters.thumbFailed,
    gridFailed: counters.gridFailed,
  });
};

const hasArtifact = async (deps: PhotosDeps, artifactPath: string): Promise<boolean> => {
  const stat = await deps.fs.stat(artifactPath);
  return stat.ok && stat.value.size > 0;
};

const artifactsAreComplete = async (
  deps: PhotosDeps,
  candidate: PhotoProxyCandidate,
  proxyPath: string,
  thumbPath: string,
): Promise<boolean> => {
  if (candidate.proxyState !== 'done' || candidate.thumbState !== 'done') return false;
  if (!(await hasArtifact(deps, proxyPath))) return false;
  return hasArtifact(deps, thumbPath);
};

const processProxyCandidate = async (
  deps: PhotosDeps,
  artifactsRoot: string,
  candidate: PhotoProxyCandidate,
  force: boolean,
  counters: ProxyCounters,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const proxyPath = photoProxyPath(deps.fs, artifactsRoot, candidate.fingerprint);
  const thumbPath = photoThumbPath(deps.fs, artifactsRoot, candidate.fingerprint);
  const gridThumbPath = photoGridThumbPath(deps.fs, artifactsRoot, candidate.fingerprint);

  if (!force && await artifactsAreComplete(deps, candidate, proxyPath, thumbPath)) {
    counters.skippedExisting += 1;
    await report(progress, 'photo-file-skipped', { path: candidate.sourcePath, reason: 'proxy_exists' });
    return ok(undefined);
  }

  const created = await deps.photoMedia.createProxy({
    sourcePath: candidate.sourcePath,
    ext: candidate.ext,
    proxyPath,
    thumbPath,
  });

  if (created.ok) {
    const thumbState = created.value.thumbWidth === null ? 'failed' : 'done';
    const set = await deps.photos.setProxyOutcome({
      fingerprint: candidate.fingerprint,
      proxyState: 'done',
      proxyWidth: created.value.proxyWidth,
      proxyHeight: created.value.proxyHeight,
      thumbState,
    });
    if (!set.ok) return set;
    counters.generated += 1;
    if (thumbState === 'failed') counters.thumbFailed += 1;
    const grid = await generateGridThumbnail(deps, {
      candidates: [
        { kind: 'proxy', path: proxyPath },
        { kind: 'original', path: candidate.sourcePath },
      ],
      gridThumbnailPath: gridThumbPath,
      force,
      priority: 'background',
    });
    if (!grid.ok) counters.gridFailed += 1;
    return ok(undefined);
  }

  const set = await deps.photos.setProxyOutcome({
    fingerprint: candidate.fingerprint,
    proxyState: 'failed',
    proxyWidth: null,
    proxyHeight: null,
    thumbState: 'failed',
  });
  if (!set.ok) return set;
  counters.failed += 1;
  await report(progress, 'photo-proxy-failed', {
    path: candidate.sourcePath,
    fingerprint: candidate.fingerprint,
    code: created.error.code,
  });
  return ok(undefined);
};

export interface PhotoGridThumbsSummary {
  media: 'photo';
  force: boolean;
  candidates: number;
  generated: number;
  skipped: number;
  failed: number;
}

export const enqueuePhotoGridThumbs = async (
  deps: PhotosDeps,
  input: { force: boolean },
): Promise<Result<{ jobId: string }, AppError>> =>
  deps.jobs.enqueue({
    kind: 'photo_grid_thumbs',
    payload: { force: input.force },
    resourceKey: 'photo-grid-thumbs',
    run: (context) => runPhotoGridThumbsPass(deps, input, context),
  });

export const runPhotoGridThumbsPass = async (
  deps: PhotosDeps,
  input: { force: boolean },
  progress?: JobExecutionContext,
): Promise<Result<PhotoGridThumbsSummary, AppError>> => {
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const proxiesDir = deps.fs.join(artifactsRoot, 'proxies');
  const isDirectory = await deps.fs.isDirectory(proxiesDir);
  if (!isDirectory.ok) return isDirectory;
  const fingerprints: string[] = [];
  if (isDirectory.value) {
    const entries = await deps.fs.listDirectory(proxiesDir);
    if (!entries.ok) return entries;
    for (const entry of entries.value) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.jpg')) continue;
      fingerprints.push(deps.fs.basenameWithoutExtension(entry.name));
    }
    fingerprints.sort();
  }
  await report(progress, 'photo-grid-thumbs-scanning', { candidates: fingerprints.length });

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const fingerprint of fingerprints) {
    if (progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const proxyPath = photoProxyPath(deps.fs, artifactsRoot, fingerprint);
    const gridThumbnailPath = photoGridThumbPath(deps.fs, artifactsRoot, fingerprint);
    const photo = await deps.photos.getPhoto(fingerprint);
    if (!photo.ok) return photo;
    const candidates: GridThumbnailCandidate[] = [{ kind: 'proxy', path: proxyPath }];
    if (photo.value !== null) candidates.push({ kind: 'original', path: photo.value.currentPath });
    const grid = await generateGridThumbnail(deps, {
      candidates,
      gridThumbnailPath,
      force: input.force,
      priority: 'background',
    });
    if (!grid.ok) {
      failed += 1;
      await report(progress, 'photo-grid-thumb-failed', { fingerprint, code: grid.error.code });
      continue;
    }
    if (grid.value.skipped) skipped += 1;
    else generated += 1;
    await report(progress, 'photo-grid-thumb', { fingerprint, generated, skipped, failed });
  }

  await report(progress, 'photo-grid-thumbs-summary', { candidates: fingerprints.length, generated, skipped, failed });

  return ok({
    media: 'photo',
    force: input.force,
    candidates: fingerprints.length,
    generated,
    skipped,
    failed,
  });
};

export const photosTree = async (
  deps: PhotosDeps,
): Promise<Result<{ media: 'photo'; roots: PhotoRootSummary[] }, AppError>> => {
  const roots = await deps.photos.listRoots();
  if (!roots.ok) return roots;
  return ok({ media: 'photo', roots: roots.value });
};

export interface PhotosFolderTreeFolder {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  photoCount: number;
  analysedCount: number;
}

export interface PhotosFolderTreeOutput {
  media: 'photo';
  folders: PhotosFolderTreeFolder[];
  photoTotal: number;
  analysedTotal: number;
}

const isUnderRoot = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

const ownerRootForPath = (path: string, roots: readonly string[]): string | null => {
  const matches = roots.filter((root) => isUnderRoot(path, root));
  if (matches.length === 0) return null;
  return matches.reduce((deepest, candidate) => (candidate.length > deepest.length ? candidate : deepest));
};

export const photosFolderTree = async (
  deps: PhotosDeps,
): Promise<Result<PhotosFolderTreeOutput, AppError>> => {
  const roots = await deps.photos.listRoots();
  if (!roots.ok) return roots;
  const entries = await deps.photos.listFolderTree();
  if (!entries.ok) return entries;
  const rootPaths = roots.value.map((root) => root.root);
  const folders: PhotosFolderTreeFolder[] = [];
  let photoTotal = 0;
  let analysedTotal = 0;
  for (const entry of entries.value) {
    const root = ownerRootForPath(entry.currentPath, rootPaths);
    if (root === null) continue;
    const relativePath = entry.currentPath === root ? '' : entry.currentPath.slice(root.length + 1);
    const segments = relativePath === '' ? [] : relativePath.split('/');
    const lastSegment = segments[segments.length - 1];
    folders.push({
      path: entry.currentPath,
      name: lastSegment ?? deps.fs.basename(root),
      relativePath,
      root,
      depth: segments.length,
      photoCount: entry.photoCount,
      analysedCount: entry.analysedCount,
    });
    photoTotal += entry.photoCount;
    analysedTotal += entry.analysedCount;
  }
  folders.sort((left, right) => left.path.localeCompare(right.path));
  return ok({ media: 'photo', folders, photoTotal, analysedTotal });
};

const resolveGridThumbPath = async (
  deps: PhotosDeps,
  artifactsRoot: string,
  fingerprint: string,
): Promise<Result<string | null, AppError>> => {
  const gridThumbPath = photoGridThumbPath(deps.fs, artifactsRoot, fingerprint);
  const exists = await deps.fs.exists(gridThumbPath);
  if (!exists.ok) return exists;
  return ok(exists.value ? gridThumbPath : null);
};

type EnrichedPhotoListItem = PhotoListItem & { thumbPath: string | null; gridThumbPath: string | null; proxyPath: string | null };

const enrichPhotoListItems = async (
  deps: PhotosDeps,
  artifactsRoot: string,
  items: readonly PhotoListItem[],
): Promise<Result<EnrichedPhotoListItem[], AppError>> => {
  const enriched: EnrichedPhotoListItem[] = [];
  for (const item of items) {
    const gridThumbPath = await resolveGridThumbPath(deps, artifactsRoot, item.fingerprint);
    if (!gridThumbPath.ok) return gridThumbPath;
    enriched.push({
      ...item,
      proxyPath: item.proxyState === 'done' ? photoProxyPath(deps.fs, artifactsRoot, item.fingerprint) : null,
      thumbPath: item.thumbState === 'done' ? photoThumbPath(deps.fs, artifactsRoot, item.fingerprint) : null,
      gridThumbPath: gridThumbPath.value,
    });
  }
  return ok(enriched);
};

export interface PhotosTreeFolderOutput {
  media: 'photo';
  items: EnrichedPhotoListItem[];
}

export const photosTreeFolder = async (
  deps: PhotosDeps,
  input: { folder: string },
): Promise<Result<PhotosTreeFolderOutput, AppError>> => {
  const folderId = derivedFolderId(input.folder);
  const items = await deps.photos.listPhotosInFolder(folderId);
  if (!items.ok) return items;
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const enriched = await enrichPhotoListItems(deps, artifactsRoot, items.value);
  if (!enriched.ok) return enriched;
  return ok({ media: 'photo', items: enriched.value });
};

export interface PhotosListOutput {
  media: 'photo';
  root: string | null;
  total: number;
  offset: number;
  items: EnrichedPhotoListItem[];
}

export const photosList = async (
  deps: PhotosDeps,
  input: { root?: string | undefined; offset: number; limit: number },
): Promise<Result<PhotosListOutput, AppError>> => {
  const root = input.root === undefined ? null : deps.fs.resolve(input.root);
  const page = await deps.photos.listPhotosPage({ root, offset: input.offset, limit: input.limit });
  if (!page.ok) return page;
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const items = await enrichPhotoListItems(deps, artifactsRoot, page.value.items);
  if (!items.ok) return items;
  return ok({
    media: 'photo',
    root,
    total: page.value.total,
    offset: input.offset,
    items: items.value,
  });
};

export interface PhotosDetailAnalysis {
  configId: string;
  label: string;
  description: string;
  scene: string;
  quality: string;
  tags: string[];
  batchSize: number | null;
  createdAt: string;
  variantCount: number;
  explicit: boolean;
}

export interface PhotosDetailOutput {
  media: 'photo';
  photo: PhotoRecord;
  sightings: PhotoSightingRecord[];
  ownerPath: string;
  proxyPath: string | null;
  thumbPath: string | null;
  gridThumbPath: string | null;
  people: CatalogFilePerson[];
  analysis: PhotosDetailAnalysis | null;
  analysisError: PhotoAnalysisError | null;
}

export const photosDetail = async (
  deps: PhotosDeps,
  input: { fingerprint: string },
): Promise<Result<PhotosDetailOutput | null, AppError>> => {
  const detail = await deps.photos.getPhotoDetail(input.fingerprint);
  if (!detail.ok) return detail;
  if (detail.value === null) return ok(null);
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const analysis = await resolvedPhotoAnalysis(deps, input.fingerprint);
  if (!analysis.ok) return analysis;
  const gridThumbPath = await resolveGridThumbPath(deps, artifactsRoot, detail.value.photo.fingerprint);
  if (!gridThumbPath.ok) return gridThumbPath;
  const people = deps.globalCatalog === undefined
    ? null
    : await deps.globalCatalog.listPeopleForFile(input.fingerprint);
  if (people !== null && !people.ok) return people;
  return ok({
    media: 'photo',
    photo: detail.value.photo,
    sightings: detail.value.sightings,
    ownerPath: detail.value.photo.currentPath,
    proxyPath: detail.value.photo.proxyState === 'done' ? photoProxyPath(deps.fs, artifactsRoot, detail.value.photo.fingerprint) : null,
    thumbPath: detail.value.photo.thumbState === 'done' ? photoThumbPath(deps.fs, artifactsRoot, detail.value.photo.fingerprint) : null,
    gridThumbPath: gridThumbPath.value,
    people: people === null ? [] : people.value,
    analysis: analysis.value,
    analysisError: detail.value.analysisError,
  });
};

const resolvedPhotoAnalysis = async (
  deps: PhotosDeps,
  fingerprint: string,
): Promise<Result<PhotosDetailAnalysis | null, AppError>> => {
  const resolvedConfigId = await deps.photos.resolveSelectedConfigId(fingerprint);
  if (!resolvedConfigId.ok) return resolvedConfigId;
  if (resolvedConfigId.value === null) return ok(null);
  const variants = await deps.photos.listPhotoVariants(fingerprint);
  if (!variants.ok) return variants;
  const selected = variants.value.find((variant) => variant.configId === resolvedConfigId.value);
  if (selected === undefined) return ok(null);
  return ok({
    configId: selected.configId,
    label: selected.label,
    description: selected.description,
    scene: selected.scene,
    quality: selected.quality,
    tags: selected.tags,
    batchSize: selected.batchSize,
    createdAt: selected.createdAt,
    variantCount: variants.value.length,
    explicit: selected.explicit,
  });
};

export interface PhotosSearchOutput {
  media: 'photo';
  query: string;
  limit: number;
  offset: number;
  count: number;
  results: (PhotoSearchRow & { thumbPath: string | null; gridThumbPath: string | null; proxyPath: string | null })[];
}

export const photosSearch = async (
  deps: PhotosDeps,
  input: { query: string; limit: number; offset: number },
): Promise<Result<PhotosSearchOutput, AppError>> => {
  const sanitized = sanitizeSearchQuery(input.query);
  if (!sanitized.ok) return sanitized;
  const expansions = await deps.photos.expandPhotoTagTerms(sanitized.value.rankingTerms);
  if (!expansions.ok) return expansions;
  const equivalents = new Map(expansions.value.map((entry) => [entry.term, entry.equivalents]));
  const rows = await deps.photos.searchPhotos({
    match: buildSearchMatch(sanitized.value.parts, equivalents),
    rankingTerms: sanitized.value.rankingTerms,
    limit: input.limit,
    offset: input.offset,
  });
  if (!rows.ok) return rows;
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const results: PhotosSearchOutput['results'] = [];
  for (const row of rows.value) {
    const gridThumbPath = await resolveGridThumbPath(deps, artifactsRoot, row.fingerprint);
    if (!gridThumbPath.ok) return gridThumbPath;
    results.push({
      ...row,
      proxyPath: row.proxyState === 'done' ? photoProxyPath(deps.fs, artifactsRoot, row.fingerprint) : null,
      thumbPath: row.thumbState === 'done' ? photoThumbPath(deps.fs, artifactsRoot, row.fingerprint) : null,
      gridThumbPath: gridThumbPath.value,
    });
  }
  return ok({
    media: 'photo',
    query: input.query,
    limit: input.limit,
    offset: input.offset,
    count: results.length,
    results,
  });
};

export interface PhotosVariantsListOutput {
  media: 'photo';
  fingerprint: string;
  selectedConfigId: string | null;
  variants: PhotoVariantRecord[];
}

export const photosVariantsList = async (
  deps: PhotosDeps,
  input: { fingerprint: string },
): Promise<Result<PhotosVariantsListOutput, AppError>> => {
  const photo = await deps.photos.getPhoto(input.fingerprint);
  if (!photo.ok) return photo;
  if (photo.value === null) return photoNotFound(input.fingerprint);
  const variants = await deps.photos.listPhotoVariants(input.fingerprint);
  if (!variants.ok) return variants;
  const selected = await deps.photos.resolveSelectedConfigId(input.fingerprint);
  if (!selected.ok) return selected;
  return ok({ media: 'photo', fingerprint: input.fingerprint, selectedConfigId: selected.value, variants: variants.value });
};

export interface PhotosVariantsSelectOutput {
  media: 'photo';
  fingerprint: string;
  configId: string | null;
}

export const photosVariantsSelect = async (
  deps: PhotosDeps,
  input: { fingerprint: string; configId: string | null },
): Promise<Result<PhotosVariantsSelectOutput, AppError>> => {
  const photo = await deps.photos.getPhoto(input.fingerprint);
  if (!photo.ok) return photo;
  if (photo.value === null) return photoNotFound(input.fingerprint);
  const selected = await deps.photos.setSelectedPhotoVariant(input.fingerprint, input.configId);
  if (!selected.ok) return selected;
  return ok({ media: 'photo', fingerprint: input.fingerprint, configId: input.configId });
};

export interface PhotosVariantsDeleteOutput {
  media: 'photo';
  fingerprint: string;
  configId: string;
  selectedConfigId: string | null;
}

export const photosVariantsDelete = async (
  deps: PhotosDeps,
  input: { fingerprint: string; configId: string },
): Promise<Result<PhotosVariantsDeleteOutput, AppError>> => {
  const photo = await deps.photos.getPhoto(input.fingerprint);
  if (!photo.ok) return photo;
  if (photo.value === null) return photoNotFound(input.fingerprint);
  const variants = await deps.photos.listPhotoVariants(input.fingerprint);
  if (!variants.ok) return variants;
  const exists = variants.value.some((variant) => variant.configId === input.configId);
  if (!exists) return photoVariantNotFound(input.fingerprint, input.configId);
  const deleted = await deps.photos.deletePhotoVariant(input.fingerprint, input.configId);
  if (!deleted.ok) return deleted;
  const selectedConfigId = await deps.photos.resolveSelectedConfigId(input.fingerprint);
  if (!selectedConfigId.ok) return selectedConfigId;
  return ok({
    media: 'photo',
    fingerprint: input.fingerprint,
    configId: input.configId,
    selectedConfigId: selectedConfigId.value,
  });
};

export interface PhotosVariantsFolderDefaultOutput {
  media: 'photo';
  folderId: string;
  defaultConfigId: string | null;
}

export const photosVariantsFolderDefault = async (
  deps: PhotosDeps,
  input: { folderId: string; configId: string | null },
): Promise<Result<PhotosVariantsFolderDefaultOutput, AppError>> => {
  const folder = await deps.photos.getFolder(input.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) {
    return { ok: false, error: appError('folder_not_found', `Photo folder not found: ${input.folderId}`) };
  }
  const stored = await deps.photos.setPhotoFolderDefaultVariant(input.folderId, input.configId);
  if (!stored.ok) return stored;
  return ok({ media: 'photo', folderId: input.folderId, defaultConfigId: input.configId });
};

const photoNotFound = <T>(fingerprint: string): Result<T, AppError> => ({
  ok: false,
  error: appError('file_not_found', `Photo not found: ${fingerprint}`),
});

const photoVariantNotFound = <T>(fingerprint: string, configId: string): Result<T, AppError> => ({
  ok: false,
  error: appError('variant_not_found', `Analysis variant not found: ${fingerprint}/${configId}`),
});

export const photosStatus = async (
  deps: PhotosDeps,
  input: { root?: string | undefined },
): Promise<Result<PhotosStatusOutput, AppError>> => {
  const root = input.root === undefined ? null : deps.fs.resolve(input.root);
  const counts = await deps.photos.counts(root);
  if (!counts.ok) return counts;
  return ok({ media: 'photo', root, counts: counts.value, durability: deps.photos.durabilityStatus() });
};

export const photosForget = async (
  deps: PhotosDeps,
  input: { root: string },
): Promise<Result<PhotosForgetOutput, AppError>> => {
  const root = deps.fs.resolve(input.root);
  const deletedFingerprints: string[] = [];
  const batched = await deps.photos.withBatch(async (): Promise<Result<Omit<PhotosForgetOutput, 'artifactPaths'>, AppError>> => {
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
        deletedFingerprints.push(fingerprint);
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
    const deletedRuns = await deps.photos.deletePhotoRuns(root);
    if (!deletedRuns.ok) return deletedRuns;
    return ok({ media: 'photo', root, pathsRemoved, photosDeleted, photosRepointed });
  });
  if (!batched.ok) return batched;

  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const artifactPaths: string[] = [];
  for (const fingerprint of deletedFingerprints) {
    for (const candidatePath of [
      photoProxyPath(deps.fs, artifactsRoot, fingerprint),
      photoThumbPath(deps.fs, artifactsRoot, fingerprint),
      photoGridThumbPath(deps.fs, artifactsRoot, fingerprint),
    ]) {
      const exists = await deps.fs.exists(candidatePath);
      if (!exists.ok) return exists;
      if (!exists.value) continue;
      const deleted = await deps.fs.deleteFile(candidatePath);
      if (!deleted.ok) return deleted;
      artifactPaths.push(candidatePath);
    }
  }

  return ok({ ...batched.value, artifactPaths });
};

export interface PhotoProcessSummary {
  media: 'photo';
  root: string | null;
  force: boolean;
  configId: string | null;
  batchSize: number;
  candidates: number;
  analysed: number;
  failed: number;
  skippedExisting: number;
  splitRetries: number;
}

interface PhotoAnalysisItem {
  fingerprint: string;
  fileName: string;
  currentPath: string;
  proxyPath: string;
}

export const resolvePhotoAnalyzerOptions = async (
  deps: PhotosDeps,
  root: string,
): Promise<Result<{
  provider: AnalyzerProviderConfig;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  uiLanguage: AppConfig['ui_language'];
  timeoutSeconds: number;
}, AppError>> => {
  const stored = await resolveConfigValues(deps.config, root);
  if (!stored.ok) return stored;
  const effective = stored.value.effective;
  let provider: AnalyzerProviderConfig;
  try {
    provider = analyzerProviderConfigSchema.parse(JSON.parse(effective.analyzer_provider));
  } catch {
    return { ok: false, error: appError('invalid_config_value', 'analyzer_provider does not match the config schema') };
  }
  return ok({
    provider,
    outputLanguage: outputLanguageSchema.parse(effective.output_language),
    tagLanguage: outputLanguageSchema.parse(effective.tag_language),
    uiLanguage: uiLanguageSchema.parse(effective.ui_language),
    timeoutSeconds: configValueSchema.shape.timeout.parse(effective.timeout),
  });
};

export const enqueuePhotoProcess = async (
  deps: PhotosDeps,
  input: { root: string | null; force: boolean; batchSize: number | null; fingerprints?: readonly string[] | null },
): Promise<Result<{ jobId: string }, AppError>> => {
  let root: string | null = null;
  if (input.root !== null) {
    root = deps.fs.resolve(input.root);
    const exists = await deps.fs.exists(root);
    if (!exists.ok) return exists;
    if (!exists.value) return { ok: false, error: appError('folder_not_found', `Root not found: ${root}`) };
    const directory = await deps.fs.isDirectory(root);
    if (!directory.ok) return directory;
    if (!directory.value) return { ok: false, error: appError('not_a_directory', `Root is not a directory: ${root}`) };
  }

  const fingerprints = input.fingerprints ?? null;
  return deps.jobs.enqueue({
    kind: 'photo_process',
    payload: { root, force: input.force, batchSize: input.batchSize, fingerprints },
    resourceKey: root === null ? 'photo-process:*all-roots*' : `photo-process:${root}`,
    run: (context) => runPhotoProcess(deps, { root, force: input.force, batchSize: input.batchSize, fingerprints }, context),
  });
};

const photoLabelFor = (descriptor: PhotoConfigDescriptor): string =>
  `${descriptor.providerId} · ${descriptor.model ?? descriptor.modelTag ?? descriptor.promptStyle ?? 'unknown'} · ${descriptor.output_language}`;

const modelLabelFor = (provider: AnalyzerProviderConfig): string | null => {
  switch (provider.family) {
    case 'api':
      return provider.model;
    case 'harness':
      return provider.model ?? provider.promptStyle;
    case 'local':
      return provider.modelTag;
    case 'gemini-native':
      return provider.model;
  }
};

const recordPhotoSpendEstimate = async (
  ledger: SpendLedgerPort | undefined,
  providerId: string,
  photoPath: string,
  runId: string,
  recordedAt: Date,
  estimate: GeminiCostEstimate,
): Promise<Result<void, AppError>> => {
  if (ledger === undefined) return ok(undefined);
  const entry = spendLedgerEntrySchema.safeParse({
    ...estimate,
    schemaVersion: 1,
    recordedAt: recordedAt.toISOString(),
    month: spendMonth(recordedAt),
    providerId,
    videoPath: photoPath,
    runId,
  });
  if (!entry.success) {
    return { ok: false, error: appError('internal', 'Gemini spend estimate does not match the ledger schema') };
  }
  return ledger.append(entry.data);
};

interface CascadeCounters {
  analysed: number;
  failed: number;
  calls: number;
  topLevelCalls: number;
}

interface CascadeContext {
  configId: string;
  budgetUsd: number | null;
  totalCandidates: number;
  state: { run: PhotoRunRecord };
  counters: CascadeCounters;
  progress: JobExecutionContext | undefined;
  provider: AnalyzerProviderConfig;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  uiLanguage: AppConfig['ui_language'];
  timeoutSeconds: number;
}

const pauseForPhotoBudget = async (
  deps: PhotosDeps,
  ctx: CascadeContext,
  exceeded: BudgetExceeded,
): Promise<Result<never, AppError>> => {
  const persisted = await deps.photos.updatePhotoRun(ctx.state.run);
  if (!persisted.ok) return persisted;
  const flushed = await deps.photos.flush();
  if (!flushed.ok) return flushed;
  const reported = await report(ctx.progress, 'budget_cap_reached', {
    provider: 'gemini',
    month: exceeded.month,
    budgetUsd: exceeded.budgetUsd,
    estimatedSpendUsd: exceeded.estimatedSpendUsd,
    estimated: true,
    runId: ctx.state.run.runId,
  });
  if (!reported.ok) return reported;
  return {
    ok: false,
    error: appError(
      'drive_run_aborted',
      `Paused photos process because the local Gemini cost estimate for ${exceeded.month} is $${exceeded.estimatedSpendUsd.toFixed(4)} `
      + `against the $${exceeded.budgetUsd.toFixed(2)} budget. Raise or unset gemini_monthly_budget_usd and re-run the same root to resume.`,
      { runId: ctx.state.run.runId, month: exceeded.month, budgetUsd: exceeded.budgetUsd, estimatedSpendUsd: exceeded.estimatedSpendUsd },
    ),
  };
};

const failPhotoBatch = async (
  deps: PhotosDeps,
  items: readonly PhotoAnalysisItem[],
  ctx: CascadeContext,
  error: AppError,
): Promise<Result<void, AppError>> => {
  const split = splitPhotoBatch(items);
  if (split === null) {
    const item = items[0];
    ctx.counters.failed += 1;
    ctx.state.run = { ...ctx.state.run, filesFailed: ctx.state.run.filesFailed + 1, lastActivityAt: new Date().toISOString() };
    if (item !== undefined) {
      const recorded = await deps.photos.recordPhotoAnalysisFailure({
        fingerprint: item.fingerprint,
        configId: ctx.configId,
        code: error.code,
        message: error.message,
        createdAt: new Date().toISOString(),
      });
      if (!recorded.ok) return recorded;
      const reported = await report(ctx.progress, 'photo-analysis-failed', {
        path: item.currentPath,
        fingerprint: item.fingerprint,
        code: error.code,
      });
      if (!reported.ok) return reported;
    }
    return ok(undefined);
  }
  const [first, second] = split;
  const firstResult = await runPhotoAnalysisCascade(deps, first, ctx, false);
  if (!firstResult.ok) return firstResult;
  return runPhotoAnalysisCascade(deps, second, ctx, false);
};

export const runPhotoAnalysisCascade = async (
  deps: PhotosDeps,
  items: readonly PhotoAnalysisItem[],
  ctx: CascadeContext,
  isTopLevel = true,
): Promise<Result<void, AppError>> => {
  const exceeded = await monthlyBudgetExceeded(deps, ctx.budgetUsd, new Date());
  if (!exceeded.ok) return exceeded;
  if (exceeded.value !== null) return pauseForPhotoBudget(deps, ctx, exceeded.value);

  if (isTopLevel) ctx.counters.topLevelCalls += 1;
  ctx.counters.calls += 1;
  if (isTopLevel) {
    const reportedBatch = await report(ctx.progress, 'photo-analysis-batch-started', {
      fingerprints: items.map((item) => item.fingerprint),
    });
    if (!reportedBatch.ok) return reportedBatch;
  }
  const analyzeInput: { items: AnalyzePhotoItem[] } = {
    items: items.map((item) => ({ fingerprint: item.fingerprint, fileName: item.fileName, proxyPath: item.proxyPath })),
  };
  const analyze = () => deps.analyzer.analyzePhotos({
    ...analyzeInput,
    provider: ctx.provider,
    outputLanguage: ctx.outputLanguage,
    tagLanguage: ctx.tagLanguage,
    uiLanguage: ctx.uiLanguage,
    timeoutSeconds: ctx.timeoutSeconds,
    verbose: false,
    signal: ctx.progress?.signal,
  });
  const isCancelled = (): boolean => ctx.progress?.signal.aborted === true;
  let singleRetryUsed = false;
  let analyzeResult = await analyze();

  if (!analyzeResult.ok && items.length === 1 && analyzeResult.error.code === 'processing_error') {
    if (isCancelled()) return analyzeResult;
    singleRetryUsed = true;
    analyzeResult = await analyze();
  }

  if (!analyzeResult.ok) {
    if (isCancelled()) return analyzeResult;
    return failPhotoBatch(deps, items, ctx, analyzeResult.error);
  }

  let parsed = parsePhotoBatchResponse(analyzeResult.value.rawResponse, items.length);
  if (!parsed.ok && items.length === 1 && parsed.error.code === 'processing_error' && !singleRetryUsed) {
    if (isCancelled()) return parsed;
    singleRetryUsed = true;
    analyzeResult = await analyze();
    if (!analyzeResult.ok) {
      if (isCancelled()) return analyzeResult;
      return failPhotoBatch(deps, items, ctx, analyzeResult.error);
    }
    parsed = parsePhotoBatchResponse(analyzeResult.value.rawResponse, items.length);
  }
  if (!parsed.ok) {
    if (isCancelled()) return parsed;
    return failPhotoBatch(deps, items, ctx, parsed.error);
  }

  for (const element of parsed.value) {
    const item = items[element.index - 1];
    if (item === undefined) continue;
    const recorded = await deps.photos.recordPhotoAnalysis({
      fingerprint: item.fingerprint,
      configId: ctx.configId,
      description: element.description,
      scene: element.scene,
      quality: element.quality,
      language: ctx.outputLanguage,
      analyzer: ctx.provider.family,
      model: modelLabelFor(ctx.provider),
      batchSize: items.length,
      usageJson: analyzeResult.value.usage === undefined ? null : JSON.stringify(analyzeResult.value.usage),
      tags: element.tags,
      createdAt: new Date().toISOString(),
      resolvedOutputLanguage: resolvePromptLanguage(ctx.outputLanguage, ctx.uiLanguage),
      resolvedTagLanguage: resolvePromptLanguage(ctx.tagLanguage, ctx.uiLanguage),
    });
    if (!recorded.ok) return recorded;
    ctx.counters.analysed += 1;
    ctx.state.run = { ...ctx.state.run, filesDone: ctx.state.run.filesDone + 1, lastActivityAt: new Date().toISOString() };
    const reportedFile = await report(ctx.progress, 'photo-analysed', {
      fingerprint: item.fingerprint,
      path: item.currentPath,
      current: ctx.counters.analysed,
      total: ctx.totalCandidates,
    });
    if (!reportedFile.ok) return reportedFile;
  }

  if (analyzeResult.value.usage !== undefined) {
    const usage = analyzeResult.value.usage;
    const reportedUsage = await report(ctx.progress, 'photo-analysis-usage', {
      fingerprints: items.map((item) => item.fingerprint),
      model: usage.model,
      usage: {
        promptTokens: usage.promptTokens,
        billedOutputTokens: usage.billedOutputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      },
    });
    if (!reportedUsage.ok) return reportedUsage;
    const estimate = geminiCostEstimateFromUsage(usage);
    if (estimate !== null) {
      const spendRecorded = await recordPhotoSpendEstimate(
        deps.spendLedger,
        ctx.provider.providerId,
        items[0]?.proxyPath ?? '',
        ctx.state.run.runId,
        new Date(),
        estimate,
      );
      if (!spendRecorded.ok) return spendRecorded;
    }
  }
  return ok(undefined);
};

interface PhotoProcessRootSummary {
  configId: string;
  batchSize: number;
  candidates: number;
  analysed: number;
  failed: number;
  skippedExisting: number;
  splitRetries: number;
}

const reportPhotoFacesSkipped = async (
  progress: JobExecutionContext | undefined,
  root: string,
  reason: string,
  error?: AppError | undefined,
): Promise<void> => {
  await report(progress, 'photo-faces-skipped', {
    root,
    reason,
    ...(error === undefined ? {} : { code: error.code, message: error.message }),
  });
};

const photoFacesCancelled = (progress: JobExecutionContext | undefined): boolean =>
  progress?.signal.aborted === true;

const runChainedPhotoFacesPass = async (
  deps: PhotosDeps,
  root: string,
  progress: JobExecutionContext | undefined,
): Promise<void> => {
  if (photoFacesCancelled(progress)) {
    await reportPhotoFacesSkipped(progress, root, 'cancelled');
    return;
  }
  if (deps.downloads === undefined || deps.faceEngine === undefined || deps.globalCatalog === undefined) {
    await reportPhotoFacesSkipped(progress, root, 'unavailable');
    return;
  }
  const enabled = await facesEnabled(deps, root);
  if (!enabled.ok) {
    await reportPhotoFacesSkipped(progress, root, 'failed', enabled.error);
    return;
  }
  if (!enabled.value) {
    await reportPhotoFacesSkipped(progress, root, 'disabled');
    return;
  }
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) {
    await reportPhotoFacesSkipped(progress, root, 'failed', artifactsReady.error);
    return;
  }
  if (!artifactsReady.value) {
    await reportPhotoFacesSkipped(progress, root, 'artifacts_missing');
    return;
  }
  const claim = await deps.jobs.acquireResource('faces-write', progress?.signal);
  if (!claim.ok) {
    await reportPhotoFacesSkipped(progress, root, photoFacesCancelled(progress) ? 'cancelled' : 'failed', claim.error);
    return;
  }
  try {
    const pass = await runPhotoFacesIndexPass({
      config: deps.config,
      downloads: deps.downloads,
      faceEngine: deps.faceEngine,
      fs: deps.fs,
      globalCatalog: deps.globalCatalog,
      media: deps.media,
      photos: deps.photos,
    }, { root }, progress);
    if (!pass.ok) {
      await reportPhotoFacesSkipped(progress, root, photoFacesCancelled(progress) ? 'cancelled' : 'failed', pass.error);
    }
  } finally {
    claim.value();
  }
};

const runPhotoProcessForRoot = async (
  deps: PhotosDeps,
  input: { root: string; force: boolean; batchSize: number | null; fingerprints: readonly string[] | null },
  progress: JobExecutionContext | undefined,
  rootContext: { rootIndex: number; rootsTotal: number },
): Promise<Result<PhotoProcessRootSummary, AppError>> => {
  const root = input.root;
  const options = await resolvePhotoAnalyzerOptions(deps, root);
  if (!options.ok) return options;
  const descriptor = buildPhotoConfigDescriptor({
    analyzer_provider: options.value.provider,
    output_language: options.value.outputLanguage,
    tag_language: options.value.tagLanguage,
  }, PHOTO_ANALYSIS_PROMPT_VERSION);
  const configId = photoConfigId(descriptor);
  const batchSize = clampPhotoBatchSize(descriptor.family, input.batchSize);
  const now = new Date().toISOString();

  const upserted = await deps.photos.upsertAnalysisConfig({
    configId,
    descriptorJson: canonicalJson(descriptor),
    label: photoLabelFor(descriptor),
    now,
  });
  if (!upserted.ok) return upserted;

  const languageResolution = resolveDescriptorLanguages(descriptor, options.value.uiLanguage);
  const candidatesResult = await deps.photos.listAnalysisCandidates(root, configId, input.force, {
    ...languageResolution,
    outputAuto: descriptor.output_language === 'auto',
    tagAuto: (descriptor.tag_language ?? descriptor.output_language) === 'auto',
  });
  if (!candidatesResult.ok) return candidatesResult;
  const fingerprintScope = input.fingerprints === null ? null : new Set(input.fingerprints);
  const candidates = fingerprintScope === null
    ? candidatesResult.value.candidates
    : candidatesResult.value.candidates.filter((candidate) => fingerprintScope.has(candidate.fingerprint));
  const alreadyAnalysed = fingerprintScope === null
    ? candidatesResult.value.alreadyAnalysed
    : fingerprintScope.size - candidates.length;
  const scanReported = await report(progress, 'photo-analysis-scanning', {
    root,
    configId,
    candidates: candidates.length,
    skippedExisting: alreadyAnalysed,
    rootIndex: rootContext.rootIndex,
    rootsTotal: rootContext.rootsTotal,
  });
  if (!scanReported.ok) return scanReported;

  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const items: PhotoAnalysisItem[] = candidates.map((candidate) => ({
    fingerprint: candidate.fingerprint,
    fileName: candidate.fileName,
    currentPath: candidate.currentPath,
    proxyPath: photoProxyPath(deps.fs, artifactsRoot, candidate.fingerprint),
  }));

  const runId = `photo-run-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
  const state: { run: PhotoRunRecord } = {
    run: {
      runId,
      root,
      stage: 'process',
      startedAt: now,
      finishedAt: null,
      filesTotal: items.length,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: now,
      batchJson: null,
    },
  };
  const started = await deps.photos.startPhotoRun(state.run);
  if (!started.ok) return started;

  const budgetUsd = await geminiMonthlyBudget(deps);
  if (!budgetUsd.ok) return budgetUsd;

  const counters: CascadeCounters = { analysed: 0, failed: 0, calls: 0, topLevelCalls: 0 };
  const storeBatches = chunk(items, PHOTO_SCAN_BATCH_SIZE);

  for (const storeBatch of storeBatches) {
    if (progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const batchResult = await deps.photos.withBatch(async (): Promise<Result<void, AppError>> => {
      const analyzerBatches = chunk(storeBatch, batchSize);
      for (const analyzerBatch of analyzerBatches) {
        const cascadeResult = await runPhotoAnalysisCascade(deps, analyzerBatch, {
          configId,
          budgetUsd: budgetUsd.value,
          totalCandidates: items.length,
          state,
          counters,
          progress,
          provider: options.value.provider,
          outputLanguage: options.value.outputLanguage,
          tagLanguage: options.value.tagLanguage,
          uiLanguage: options.value.uiLanguage,
          timeoutSeconds: options.value.timeoutSeconds,
        });
        if (!cascadeResult.ok) return cascadeResult;
        const checkpointed = await deps.photos.checkpoint();
        if (!checkpointed.ok) return checkpointed;
      }
      return deps.photos.updatePhotoRun(state.run);
    });
    if (!batchResult.ok) return batchResult;
  }

  const finishedAt = new Date().toISOString();
  state.run = { ...state.run, finishedAt, lastActivityAt: finishedAt };
  const finalUpdate = await deps.photos.updatePhotoRun(state.run);
  if (!finalUpdate.ok) return finalUpdate;
  const flushed = await deps.photos.flush();
  if (!flushed.ok) return flushed;

  return ok({
    configId,
    batchSize,
    candidates: candidates.length,
    analysed: counters.analysed,
    failed: counters.failed,
    skippedExisting: alreadyAnalysed,
    splitRetries: counters.calls - counters.topLevelCalls,
  });
};

export const runPhotoProcess = async (
  deps: PhotosDeps,
  input: { root: string | null; force: boolean; batchSize: number | null; fingerprints?: readonly string[] | null },
  progress?: JobExecutionContext,
): Promise<Result<PhotoProcessSummary, AppError>> => {
  const resolvedRoot = input.root === null ? null : deps.fs.resolve(input.root);
  let targetRoots: string[];
  if (resolvedRoot !== null) {
    targetRoots = [resolvedRoot];
  } else {
    const rootsResult = await deps.photos.listRoots();
    if (!rootsResult.ok) return rootsResult;
    targetRoots = rootsResult.value.map((entry) => entry.root);
  }

  const fingerprints = input.fingerprints ?? null;
  const aggregate = { candidates: 0, analysed: 0, failed: 0, skippedExisting: 0, splitRetries: 0 };
  let lastConfigId: string | null = null;
  let lastBatchSize = 0;
  let sawMultipleConfigIds = false;
  let rootsProcessed = 0;

  for (const root of targetRoots) {
    if (progress?.signal.aborted === true) {
      return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
    }
    const perRoot = await runPhotoProcessForRoot(
      deps,
      { root, force: input.force, batchSize: input.batchSize, fingerprints },
      progress,
      { rootIndex: rootsProcessed + 1, rootsTotal: targetRoots.length },
    );
    if (!perRoot.ok) return perRoot;
    aggregate.candidates += perRoot.value.candidates;
    aggregate.analysed += perRoot.value.analysed;
    aggregate.failed += perRoot.value.failed;
    aggregate.skippedExisting += perRoot.value.skippedExisting;
    aggregate.splitRetries += perRoot.value.splitRetries;
    if (lastConfigId !== null && lastConfigId !== perRoot.value.configId) sawMultipleConfigIds = true;
    lastConfigId = perRoot.value.configId;
    lastBatchSize = perRoot.value.batchSize;
    rootsProcessed += 1;
    await runChainedPhotoFacesPass(deps, root, progress);
  }

  const summaryReported = await report(progress, 'photo-process-summary', {
    root: resolvedRoot,
    configId: sawMultipleConfigIds ? null : lastConfigId,
    rootsProcessed,
    rootsTotal: targetRoots.length,
  });
  if (!summaryReported.ok) return summaryReported;

  return ok({
    media: 'photo',
    root: resolvedRoot,
    force: input.force,
    configId: sawMultipleConfigIds ? null : lastConfigId,
    batchSize: lastBatchSize,
    candidates: aggregate.candidates,
    analysed: aggregate.analysed,
    failed: aggregate.failed,
    skippedExisting: aggregate.skippedExisting,
    splitRetries: aggregate.splitRetries,
  });
};
