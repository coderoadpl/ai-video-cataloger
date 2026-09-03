import { appError, ok, type AppError, type LibrarySelectionScope, type Result } from '@core/domain/index.js';

import type { JobExecutionContext, JobsPort, TrashPort } from '../ports.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { photoArtifactsRoot, photoGridThumbPath, photoProxyPath, photoThumbPath } from './photo-artifacts.js';
import { artifactPaths } from './shared.js';
import { deleteLibraryTrashArtifacts } from './library-trash-artifacts.js';
import {
  librarySelectionPreview,
  resolveLibrarySelection,
  type LibrarySelectionDeps,
  type LibrarySelectionEntry,
  type LibrarySelectionPreviewOutput,
} from './library-selection.js';

export interface LibraryTrashPlan extends LibrarySelectionPreviewOutput {
  kind: 'plan';
  artifactPaths: string[];
}

export interface LibraryTrashSummary {
  kind: 'library_trash';
  filesTrashed: number;
  videosTrashed: number;
  photosTrashed: number;
  filesFailed: number;
  filesNotAttempted: number;
  failedFingerprint: string | null;
  cancelled: boolean;
  analysesDeleted: number;
  observationsDeleted: number;
  peopleDeleted: number;
  artifactPathsDeleted: number;
  snapshotsRewritten: number;
  roots: string[];
}

export interface LibraryTrashDeps extends LibrarySelectionDeps {
  jobs: JobsPort;
  trash: TrashPort;
}

export const libraryTrashPreflight = async (
  deps: LibraryTrashDeps,
  input: { scope: LibrarySelectionScope },
): Promise<Result<LibraryTrashPlan, AppError>> => {
  const entries = await resolveLibrarySelection(deps, input.scope);
  if (!entries.ok) return entries;
  const writable = await ensureAffectedRootsWritable(deps, entries.value);
  if (!writable.ok) return writable;
  const preview = await librarySelectionPreview(deps, input);
  if (!preview.ok) return preview;
  const artifactPaths = await plannedArtifactPaths(deps, entries.value);
  if (!artifactPaths.ok) return artifactPaths;
  return ok({ kind: 'plan', ...preview.value, artifactPaths: artifactPaths.value });
};

export const libraryTrash = async (
  deps: LibraryTrashDeps,
  input: { scope: LibrarySelectionScope; confirm: boolean; dryRun: boolean },
): Promise<Result<LibraryTrashPlan | { kind: 'job'; jobId: string }, AppError>> => {
  const plan = await libraryTrashPreflight(deps, input);
  if (!plan.ok) return plan;
  if (input.dryRun) return plan;
  if (!input.confirm) {
    return { ok: false, error: appError('confirmation_required', 'Moving library files to Trash requires confirmation') };
  }
  const enqueued = await deps.jobs.enqueue({
    kind: 'library_trash',
    payload: input,
    resourceKey: 'library-trash',
    run: (context) => runLibraryTrash(deps, input, context),
  });
  return enqueued.ok ? ok({ kind: 'job', jobId: enqueued.value.jobId }) : enqueued;
};

export const runLibraryTrash = async (
  deps: LibraryTrashDeps,
  input: { scope: LibrarySelectionScope },
  context?: JobExecutionContext,
): Promise<Result<LibraryTrashSummary, AppError>> => {
  const entries = await resolveLibrarySelection(deps, input.scope);
  if (!entries.ok) return entries;
  const writable = await ensureAffectedRootsWritable(deps, entries.value);
  if (!writable.ok) return writable;
  const releases = await acquirePhotoScanResources(deps, entries.value, context);
  if (!releases.ok) return releases;
  const roots = [...new Set(entries.value.flatMap((entry) => entry.sightings.map((sighting) => sighting.rootPath)))].sort();
  const affectedVideoFolderIds = new Set<string>();
  let filesTrashed = 0;
  let videosTrashed = 0;
  let photosTrashed = 0;
  let filesFailed = 0;
  let filesNotAttempted = 0;
  let failedFingerprint: string | null = null;
  let cancelled = false;
  let analysesDeleted = 0;
  let observationsDeleted = 0;
  let artifactPathsDeleted = 0;
  let snapshotsRewritten = 0;
  let peopleBeforeCount: number | null = null;
  let stoppedError: AppError | null = null;
  let returnPartialSummary = false;
  let snapshotError: AppError | null = null;
  try {
    const peopleBefore = await deps.globalCatalog.listPeople();
    if (!peopleBefore.ok) stoppedError = peopleBefore.error;
    else peopleBeforeCount = peopleBefore.value.length;
    for (let index = 0; stoppedError === null && index < entries.value.length; index += 1) {
      const entry = entries.value[index];
      if (entry === undefined) continue;
      if (context?.signal.aborted === true) {
        cancelled = true;
        filesNotAttempted = entries.value.length - index;
        stoppedError = appError('processing_error', 'Job cancelled');
        break;
      }
      const progress = await context?.reportProgress({
        step: 'library-trash-file',
        current: filesTrashed + 1,
        total: entries.value.length,
        data: { fingerprint: entry.fingerprint, media: entry.media },
      });
      if (progress !== undefined && !progress.ok) {
        cancelled = isContextAborted(context);
        filesNotAttempted = entries.value.length - index;
        stoppedError = progress.error;
        break;
      }
      const variants = entry.media === 'video'
        ? await deps.globalCatalog.listVariants(entry.fingerprint)
        : await deps.photos.listPhotoVariants(entry.fingerprint);
      if (!variants.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.value.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = variants.error;
        break;
      }
      const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: entry.fingerprint });
      if (!observations.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.value.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = observations.error;
        break;
      }
      const cropPaths = entry.media === 'video'
        ? await deleteVideoRecords(deps, entry.fingerprint)
        : await deletePhotoRecords(deps, entry.fingerprint);
      if (!cropPaths.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.value.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = cropPaths.error;
        break;
      }
      analysesDeleted += variants.value.length;
      observationsDeleted += observations.value.length;
      const artifacts = await plannedArtifactPaths(deps, [entry]);
      if (!artifacts.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.value.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = artifacts.error;
        break;
      }
      const deletedArtifacts = await deleteLibraryTrashArtifacts(deps.fs, [...cropPaths.value, ...artifacts.value]);
      if (!deletedArtifacts.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.value.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = deletedArtifacts.error;
        break;
      }
      artifactPathsDeleted += deletedArtifacts.value;
      const artifactsProgress = await context?.reportProgress({
        step: 'library-trash-artifacts',
        current: filesTrashed + 1,
        total: entries.value.length,
        data: { fingerprint: entry.fingerprint, pathsDeleted: deletedArtifacts.value },
      });
      if (artifactsProgress !== undefined && !artifactsProgress.ok) {
        cancelled = isContextAborted(context);
        filesNotAttempted = entries.value.length - index;
        stoppedError = artifactsProgress.error;
        break;
      }
      for (const sighting of entry.sightings) {
        const moved = await deps.trash.moveToTrash(sighting.path);
        if (!moved.ok) {
          filesFailed = 1;
          filesNotAttempted = entries.value.length - index - 1;
          failedFingerprint = entry.fingerprint;
          stoppedError = moved.error;
          returnPartialSummary = true;
          break;
        }
      }
      if (stoppedError !== null) break;
      filesTrashed += 1;
      if (entry.media === 'video') videosTrashed += 1;
      else photosTrashed += 1;
      if (entry.media === 'video') {
        for (const sighting of entry.sightings) affectedVideoFolderIds.add(sighting.folderId);
      }
    }
  } finally {
    const rewritten = await rewriteAffectedVideoFolders(deps, affectedVideoFolderIds);
    if (rewritten.ok) snapshotsRewritten = rewritten.value;
    else snapshotError = rewritten.error;
    for (const release of releases.value) release();
  }
  if (peopleBeforeCount === null) {
    return { ok: false, error: stoppedError ?? appError('internal', 'Could not read people before trashing files') };
  }
  const peopleAfter = await deps.globalCatalog.listPeople();
  if (!peopleAfter.ok) return peopleAfter;
  const summary: LibraryTrashSummary = {
    kind: 'library_trash',
    filesTrashed,
    videosTrashed,
    photosTrashed,
    filesFailed,
    filesNotAttempted,
    failedFingerprint,
    cancelled,
    analysesDeleted,
    observationsDeleted,
    peopleDeleted: Math.max(0, peopleBeforeCount - peopleAfter.value.length),
    artifactPathsDeleted,
    snapshotsRewritten,
    roots,
  };
  if (snapshotError !== null && stoppedError === null) {
    return { ok: false, error: withLibraryTrashSummary(snapshotError, summary) };
  }
  if (stoppedError === null || returnPartialSummary) {
    const done = await context?.reportProgress({ step: 'library-trash-summary', percentage: 100, data: { ...summary } });
    if (done !== undefined && !done.ok) return done;
    return ok(summary);
  }
  return { ok: false, error: withLibraryTrashSummary(stoppedError, summary) };
};

const withLibraryTrashSummary = (error: AppError, summary: LibraryTrashSummary): AppError =>
  appError(error.code, error.message, { cause: error, summary });

const isContextAborted = (context: JobExecutionContext | undefined): boolean =>
  context !== undefined && context.signal.aborted;

const rewriteAffectedVideoFolders = async (
  deps: LibraryTrashDeps,
  folderIds: ReadonlySet<string>,
): Promise<Result<number, AppError>> => {
  let snapshotsRewritten = 0;
  for (const folderId of [...folderIds].sort()) {
    const folder = await deps.globalCatalog.getFolder(folderId);
    if (!folder.ok) return folder;
    if (folder.value === null) continue;
    const writable = await deps.fs.isWritable(folder.value.currentPath);
    if (!writable.ok) return writable;
    if (!writable.value) continue;
    const rewritten = await exportFolderSnapshot({ globalCatalog: deps.globalCatalog, fs: deps.fs }, folder.value);
    if (!rewritten.ok) return rewritten;
    snapshotsRewritten += 1;
  }
  return ok(snapshotsRewritten);
};

const deleteVideoRecords = async (
  deps: LibraryTrashDeps,
  fingerprint: string,
): Promise<Result<string[], AppError>> => {
  const forgotten = await deps.globalCatalog.forgetEntry(fingerprint);
  return forgotten.ok ? ok(forgotten.value.cropPaths) : forgotten;
};

const deletePhotoRecords = async (
  deps: LibraryTrashDeps,
  fingerprint: string,
): Promise<Result<string[], AppError>> => {
  const observations = await deps.globalCatalog.deleteFaceObservationsForFile(fingerprint);
  if (!observations.ok) return observations;
  const deleted = await deps.photos.deletePhoto(fingerprint);
  if (!deleted.ok) return deleted;
  return ok(observations.value.cropPaths);
};

const ensureAffectedRootsWritable = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
): Promise<Result<void, AppError>> => {
  const roots = [...new Set(entries.flatMap((entry) =>
    entry.sightings.flatMap((sighting) => [sighting.rootPath, deps.fs.dirname(sighting.path)])))].sort();
  const readOnly: string[] = [];
  for (const root of roots) {
    const writable = await deps.fs.isWritable(root);
    if (!writable.ok) return writable;
    if (!writable.value) readOnly.push(root);
  }
  if (readOnly.length > 0) {
    return { ok: false, error: appError('target_read_only', 'One or more selected roots are read-only', { roots: readOnly }) };
  }
  return ok(undefined);
};

const plannedArtifactPaths = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
): Promise<Result<string[], AppError>> => {
  const paths: string[] = [];
  const photoRoot = photoArtifactsRoot(deps.fs, deps.photos);
  for (const entry of entries) {
    paths.push(`${deps.fs.join(deps.fs.dirname(deps.globalCatalog.databasePath()), 'faces', 'obs', entry.fingerprint)}/`);
    if (entry.media === 'photo') {
      paths.push(photoProxyPath(deps.fs, photoRoot, entry.fingerprint));
      paths.push(photoThumbPath(deps.fs, photoRoot, entry.fingerprint));
      paths.push(photoGridThumbPath(deps.fs, photoRoot, entry.fingerprint));
      paths.push(`${deps.fs.join(photoRoot, 'variants', entry.fingerprint)}/`);
      continue;
    }
    const sighting = entry.sightings[0];
    if (sighting === undefined) continue;
    const root = await discoverArtifactRoot(deps.fs, sighting.rootPath, sighting.folderId);
    if (!root.ok) return root;
    const projected = artifactPaths(deps.fs, root.value, sighting.path, null);
    paths.push(
      `${deps.fs.join(root.value.catalogDirectory, 'artifacts', 'frames', entry.fingerprint)}/`,
      `${deps.fs.join(root.value.catalogDirectory, 'artifacts', 'transcripts', entry.fingerprint)}/`,
      `${deps.fs.join(root.value.catalogDirectory, 'variants', entry.fingerprint)}/`,
      projected.thumbnailPath,
      projected.gridThumbnailPath,
      `${projected.framesDir}/`,
      projected.transcriptPath,
      projected.transcriptJsonPath,
      projected.summaryPath,
      projected.summaryJsonPath,
      projected.debugLogPath,
    );
  }
  return ok([...new Set(paths)].sort());
};

const acquirePhotoScanResources = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
  context?: JobExecutionContext,
): Promise<Result<Array<() => void>, AppError>> => {
  const roots = [...new Set(entries.flatMap((entry) => entry.sightings.map((sighting) => deps.fs.resolve(sighting.rootPath))))].sort();
  const releases: Array<() => void> = [];
  const progress = await context?.reportProgress({
    step: 'library-trash-preflight',
    total: roots.length === 0 ? 1 : roots.length,
    data: { roots },
  });
  if (progress !== undefined && !progress.ok) return progress;
  for (const root of roots) {
    const acquired = await deps.jobs.acquireResource(`photo-scan:${root}`, context?.signal);
    if (!acquired.ok) {
      for (const release of releases) release();
      return acquired;
    }
    releases.push(acquired.value);
  }
  return ok(releases);
};
