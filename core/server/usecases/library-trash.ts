import { appError, ok, type AppError, type LibrarySelectionScope, type Result } from '@core/domain/index.js';

import type { JobExecutionContext, JobsPort, TrashPort } from '../ports.js';
import {
  discoverArtifactRoot,
  folderArtifactRoot,
  legacyReadOnlyArtifactRoot,
  readOnlyArtifactRoot,
  readOnlyArtifactRootById,
} from './artifact-root.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { photoArtifactsRoot, photoGridThumbPath, photoProxyPath, photoThumbPath } from './photo-artifacts.js';
import { artifactPaths } from './shared.js';
import { deleteLibraryTrashArtifacts } from './library-trash-artifacts.js';
import {
  librarySelectionPreviewForEntries,
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
  const plan = await buildLibraryTrashPlan(deps, input.scope);
  return plan.ok ? ok(plan.value.plan) : plan;
};

export const libraryTrash = async (
  deps: LibraryTrashDeps,
  input: { scope: LibrarySelectionScope; confirm: boolean; dryRun: boolean },
): Promise<Result<LibraryTrashPlan | { kind: 'job'; jobId: string }, AppError>> => {
  const planned = await buildLibraryTrashPlan(deps, input.scope);
  if (!planned.ok) return planned;
  if (input.dryRun) return ok(planned.value.plan);
  if (!input.confirm) {
    return { ok: false, error: appError('confirmation_required', 'Moving library files to Trash requires confirmation') };
  }
  const writable = await ensureAffectedRootsWritable(deps, planned.value.entries);
  if (!writable.ok) return writable;
  const frozenInput = {
    scope: {
      kind: 'fingerprints' as const,
      fingerprints: planned.value.entries.map((entry) => entry.fingerprint),
    },
  };
  const enqueued = await deps.jobs.enqueue({
    kind: 'library_trash',
    payload: frozenInput,
    resourceKey: 'library-trash',
    run: (context) => runLibraryTrashEntries(deps, planned.value.entries, context),
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
  return runLibraryTrashEntries(deps, entries.value, context);
};

const runLibraryTrashEntries = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
  context?: JobExecutionContext,
): Promise<Result<LibraryTrashSummary, AppError>> => {
  const writable = await ensureAffectedRootsWritable(deps, entries);
  if (!writable.ok) return writable;
  const releases = await acquireLibraryTrashResources(deps, entries, context);
  if (!releases.ok) return releases;
  const roots = [...new Set(entries.flatMap((entry) => entry.sightings.map((sighting) => sighting.rootPath)))].sort();
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
  let snapshotError: AppError | null = null;
  try {
    const peopleBefore = await deps.globalCatalog.listPeople();
    if (!peopleBefore.ok) stoppedError = peopleBefore.error;
    else peopleBeforeCount = peopleBefore.value.length;
    for (let index = 0; stoppedError === null && index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      if (context?.signal.aborted === true) {
        cancelled = true;
        filesNotAttempted = entries.length - index;
        stoppedError = appError('processing_error', 'Job cancelled');
        break;
      }
      const progress = await context?.reportProgress({
        step: 'library-trash-file',
        current: filesTrashed + 1,
        total: entries.length,
        data: { fingerprint: entry.fingerprint, media: entry.media },
      });
      if (progress !== undefined && !progress.ok) {
        cancelled = isContextAborted(context);
        filesNotAttempted = entries.length - index;
        stoppedError = progress.error;
        break;
      }
      const variants = entry.media === 'video'
        ? await deps.globalCatalog.listVariants(entry.fingerprint)
        : await deps.photos.listPhotoVariants(entry.fingerprint);
      if (!variants.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = variants.error;
        break;
      }
      const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: entry.fingerprint });
      if (!observations.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = observations.error;
        break;
      }
      const artifacts = await plannedArtifactPaths(deps, [entry]);
      if (!artifacts.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = artifacts.error;
        break;
      }
      for (const sighting of entry.sightings) {
        const moved = await deps.trash.moveToTrash(sighting.path);
        if (!moved.ok) {
          filesFailed = 1;
          filesNotAttempted = entries.length - index - 1;
          failedFingerprint = entry.fingerprint;
          stoppedError = moved.error;
          break;
        }
      }
      if (stoppedError !== null) break;
      if (entry.media === 'video') {
        for (const sighting of entry.sightings) affectedVideoFolderIds.add(sighting.folderId);
      }
      const cropPaths = entry.media === 'video'
        ? await deleteVideoRecords(deps, entry.fingerprint)
        : await deletePhotoRecords(deps, entry.fingerprint);
      if (!cropPaths.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = cropPaths.error;
        break;
      }
      const flushed = await flushTrashStores(deps);
      if (!flushed.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = flushed.error;
        break;
      }
      analysesDeleted += variants.value.length;
      observationsDeleted += observations.value.length;
      const deletedArtifacts = await deleteLibraryTrashArtifacts(deps.fs, [...cropPaths.value, ...artifacts.value]);
      if (!deletedArtifacts.ok) {
        filesFailed = 1;
        filesNotAttempted = entries.length - index - 1;
        failedFingerprint = entry.fingerprint;
        stoppedError = deletedArtifacts.error;
        break;
      }
      artifactPathsDeleted += deletedArtifacts.value;
      const artifactsProgress = await context?.reportProgress({
        step: 'library-trash-artifacts',
        current: filesTrashed + 1,
        total: entries.length,
        data: { fingerprint: entry.fingerprint, pathsDeleted: deletedArtifacts.value },
      });
      if (artifactsProgress !== undefined && !artifactsProgress.ok) {
        cancelled = isContextAborted(context);
        filesNotAttempted = entries.length - index;
        stoppedError = artifactsProgress.error;
        break;
      }
      filesTrashed += 1;
      if (entry.media === 'video') videosTrashed += 1;
      else photosTrashed += 1;
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
  if (stoppedError === null && filesFailed === 0 && filesNotAttempted === 0) {
    const done = await context?.reportProgress({ step: 'library-trash-summary', percentage: 100, data: { ...summary } });
    if (done !== undefined && !done.ok) return done;
    return ok(summary);
  }
  const error = stoppedError ?? appError('library_trash_incomplete', 'Library trash did not finish');
  return { ok: false, error: incompleteTrashError(error, summary) };
};

const withLibraryTrashSummary = (error: AppError, summary: LibraryTrashSummary): AppError =>
  appError(error.code, error.message, { cause: error, summary });

const incompleteTrashError = (error: AppError, summary: LibraryTrashSummary): AppError =>
  appError('library_trash_incomplete', error.message, { cause: error, summary });

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
  return deps.globalCatalog.withBatch(async () => {
    const forgotten = await deps.globalCatalog.forgetEntry(fingerprint);
    return forgotten.ok ? ok(forgotten.value.cropPaths) : forgotten;
  });
};

const deletePhotoRecords = async (
  deps: LibraryTrashDeps,
  fingerprint: string,
): Promise<Result<string[], AppError>> => {
  const observations = await deps.globalCatalog.withBatch(() => deps.globalCatalog.deleteFaceObservationsForFile(fingerprint));
  if (!observations.ok) return observations;
  const deleted = await deps.photos.withBatch(() => deps.photos.deletePhoto(fingerprint));
  if (!deleted.ok) return deleted;
  return ok(observations.value.cropPaths);
};

const buildLibraryTrashPlan = async (
  deps: LibraryTrashDeps,
  scope: LibrarySelectionScope,
): Promise<Result<{ entries: LibrarySelectionEntry[]; plan: LibraryTrashPlan }, AppError>> => {
  const entries = await resolveLibrarySelection(deps, scope);
  if (!entries.ok) return entries;
  const preview = await librarySelectionPreviewForEntries(deps, entries.value);
  if (!preview.ok) return preview;
  const artifactPaths = await plannedArtifactPaths(deps, entries.value);
  if (!artifactPaths.ok) return artifactPaths;
  return ok({ entries: entries.value, plan: { kind: 'plan', ...preview.value, artifactPaths: artifactPaths.value } });
};

const ensureAffectedRootsWritable = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
): Promise<Result<void, AppError>> => {
  const roots = [...new Set(entries.flatMap((entry) =>
    entry.sightings.flatMap((sighting) => [sighting.rootPath, deps.fs.dirname(sighting.path)])))].sort();
  const offline: string[] = [];
  const readOnly: string[] = [];
  for (const root of roots) {
    const exists = await deps.fs.exists(root);
    if (!exists.ok) return exists;
    if (!exists.value) {
      offline.push(root);
      continue;
    }
    const writable = await deps.fs.isWritable(root);
    if (!writable.ok) return writable;
    if (!writable.value) readOnly.push(root);
  }
  if (offline.length > 0) {
    return { ok: false, error: appError('target_offline', 'One or more selected roots are offline', { roots: offline }) };
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
    for (const sighting of entry.sightings) {
      const roots = await artifactRootsForSighting(deps, sighting.rootPath, sighting.folderId);
      if (!roots.ok) return roots;
      const sameStemSibling = await hasSameStemSibling(deps, entry, sighting);
      if (!sameStemSibling.ok) return sameStemSibling;
      for (const root of roots.value) {
        paths.push(
          `${deps.fs.join(root.catalogDirectory, 'artifacts', 'frames', entry.fingerprint)}/`,
          `${deps.fs.join(root.catalogDirectory, 'artifacts', 'transcripts', entry.fingerprint)}/`,
          `${deps.fs.join(root.catalogDirectory, 'variants', entry.fingerprint)}/`,
        );
        if (sameStemSibling.value) continue;
        const projected = artifactPaths(deps.fs, root, sighting.path, null);
        paths.push(
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
    }
  }
  return ok([...new Set(paths)].sort());
};

const flushTrashStores = async (deps: LibraryTrashDeps): Promise<Result<void, AppError>> => {
  const catalog = await deps.globalCatalog.flush();
  if (!catalog.ok) return catalog;
  return deps.photos.flush();
};

const artifactRootsForSighting = async (
  deps: LibraryTrashDeps,
  rootPath: string,
  folderId: string,
): Promise<Result<Array<{ path: string; catalogDirectory: string }>, AppError>> => {
  const discovered = await discoverArtifactRoot(deps.fs, rootPath, folderId);
  if (!discovered.ok) return discovered;
  return ok(uniqueArtifactRoots([
    folderArtifactRoot(deps.fs, rootPath),
    readOnlyArtifactRootById(deps.fs, folderId),
    readOnlyArtifactRoot(deps.fs, rootPath),
    legacyReadOnlyArtifactRoot(deps.fs, rootPath),
    discovered.value,
  ]));
};

const uniqueArtifactRoots = (
  roots: readonly { path: string; catalogDirectory: string }[],
): Array<{ path: string; catalogDirectory: string }> => {
  const seen = new Set<string>();
  const unique: Array<{ path: string; catalogDirectory: string }> = [];
  for (const root of roots) {
    const key = `${root.path}\u0000${root.catalogDirectory}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(root);
  }
  return unique;
};

const hasSameStemSibling = async (
  deps: LibraryTrashDeps,
  entry: LibrarySelectionEntry,
  sighting: { folderId: string; rootPath: string; path: string },
): Promise<Result<boolean, AppError>> => {
  if (entry.media !== 'video') return ok(false);
  const records = await deps.globalCatalog.listFolderRecords(sighting.folderId);
  if (!records.ok) return records;
  const folder = deps.fs.dirname(sighting.path);
  const stem = deps.fs.basenameWithoutExtension(sighting.path);
  return ok(records.value.some((record) => {
    if (record.file.fingerprint === entry.fingerprint) return false;
    const siblingPath = deps.fs.join(sighting.rootPath, record.file.fileName);
    return deps.fs.dirname(siblingPath) === folder && deps.fs.basenameWithoutExtension(siblingPath) === stem;
  }));
};

const acquireLibraryTrashResources = async (
  deps: LibraryTrashDeps,
  entries: readonly LibrarySelectionEntry[],
  context?: JobExecutionContext,
): Promise<Result<Array<() => void>, AppError>> => {
  const roots = [...new Set(entries.flatMap((entry) => entry.sightings.map((sighting) => deps.fs.resolve(sighting.rootPath))))].sort();
  const paths = [...new Set(entries.flatMap((entry) => entry.sightings.map((sighting) => deps.fs.resolve(sighting.path))))].sort();
  const releases: Array<() => void> = [];
  const progress = await context?.reportProgress({
    step: 'library-trash-preflight',
    total: roots.length === 0 ? 1 : roots.length,
    data: { roots },
  });
  if (progress !== undefined && !progress.ok) return progress;
  const keys = [...new Set([
    'catalog-write',
    ...roots.flatMap((root) => [root, `photo-scan:${root}`, `photo-process:${root}`]),
    ...paths,
  ])];
  for (const key of keys) {
    const acquired = await deps.jobs.acquireResource(key, context?.signal);
    if (!acquired.ok) {
      for (const release of releases) release();
      return acquired;
    }
    releases.push(acquired.value);
  }
  return ok(releases);
};
