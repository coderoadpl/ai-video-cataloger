import {
  appError,
  derivedFolderId,
  ok,
  type AppError,
  type CatalogVariant,
  type Result,
} from '@core/domain/index.js';

import { JOB_CANCELLED_ERROR_MESSAGE } from '../ports.js';
import type { FileSystemPort, GlobalCatalogStore, JobExecutionContext } from '../ports.js';
import {
  folderArtifactRoot,
  readOnlyArtifactRoot,
  readOnlyArtifactRootById,
  type ArtifactRoot,
} from './artifact-root.js';
import {
  materializeArtifactFile,
  materializeSelectedVariantProjection,
  sharedArtifactPaths,
  variantOutputPaths,
  type SelectedVariantProjectionSource,
} from './artifact-store.js';
import { resolveFolderIntoIndex } from './catalog-index.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { isReadOnlyWriteError, readFolderMarker } from './folder-identity.js';
import { finalVideoName, uniqueFilename } from './final-name.js';
import { discoverCatalogFolders, type DriveRunFailure } from './process-drive.js';
import { reportStep } from './process-drive-batch.js';
import { summaryDataSchema } from './shared.js';

const maxConsecutiveFailures = 5;
const frameFileNamePattern = /^frame-[0-9]{3}\.jpg$/;

export interface MaterializeDeps {
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
}

export interface MaterializeInput {
  root: string;
  dryRun: boolean;
}

export type MaterializeOperationKind =
  | 'artifact_store'
  | 'catalog_final_name'
  | 'rename_video'
  | 'catalog_relocate'
  | 'project_selected'
  | 'copy_thumbnail';

export type MaterializeSkipReason =
  | 'not_in_catalog'
  | 'no_variant'
  | 'no_final_name'
  | 'fingerprint_unavailable'
  | 'duplicate';

export interface MaterializeSummary {
  root: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  foldersTotal: number;
  foldersDone: number;
  foldersNotWritable: number;
  filesTotal: number;
  filesMaterialized: number;
  filesUnchanged: number;
  filesSkipped: number;
  filesFailed: number;
  collisions: number;
  skipped: {
    notInCatalog: number;
    noVariant: number;
    noFinalName: number;
    fingerprintUnavailable: number;
    duplicate: number;
  };
  elapsedMs: number;
  failures: DriveRunFailure[];
}

interface ArtifactCopyOp {
  source: string;
  target: string;
}

interface FilePlan {
  fingerprint: string;
  folderId: string;
  videoPath: string;
  file: { folderId: string; fileName: string };
  variant: CatalogVariant;
  variants: readonly CatalogVariant[];
  finalName: string;
  appliedName: string;
  collision: boolean;
  artifactOps: ArtifactCopyOp[];
  needsFinalNameUpdate: boolean;
  needsRename: boolean;
  needsRelocate: boolean;
  projectionSource: SelectedVariantProjectionSource | null;
  needsProjection: boolean;
  thumbnailCopy: ArtifactCopyOp | null;
}

type PlanFileResult =
  | { kind: 'skip'; reason: MaterializeSkipReason }
  | { kind: 'plan'; plan: FilePlan };

interface MutableState {
  foldersDone: number;
  foldersNotWritable: number;
  filesMaterialized: number;
  filesUnchanged: number;
  filesSkipped: number;
  filesFailed: number;
  collisions: number;
  skipped: MaterializeSummary['skipped'];
  failures: DriveRunFailure[];
}

export const materializeCatalog = async (
  deps: MaterializeDeps,
  input: MaterializeInput,
  progress?: JobExecutionContext,
): Promise<Result<MaterializeSummary, AppError>> => {
  const discovery = await discoverCatalogFolders(deps.fs, { root: input.root });
  if (!discovery.ok) return discovery;
  if (discovery.value.folders.length === 0) {
    return { ok: false, error: appError('drive_root_empty', `No catalog folders found under: ${discovery.value.root}`) };
  }

  const startedAt = new Date();
  const totals: RunTotals = { foldersTotal: discovery.value.folders.length, filesTotal: discovery.value.filesTotal };
  const state: MutableState = {
    foldersDone: 0,
    foldersNotWritable: 0,
    filesMaterialized: 0,
    filesUnchanged: 0,
    filesSkipped: 0,
    filesFailed: 0,
    collisions: 0,
    skipped: { notInCatalog: 0, noVariant: 0, noFinalName: 0, fingerprintUnavailable: 0, duplicate: 0 },
    failures: [...discovery.value.failures],
  };

  const runStarted = await reportStep(progress, 'run-started', {
    root: discovery.value.root,
    foldersTotal: discovery.value.folders.length,
    filesTotal: discovery.value.filesTotal,
    dryRun: input.dryRun,
  });
  if (!runStarted.ok) return runStarted;

  let consecutiveFailures = 0;
  let fileIndex = 0;

  for (const folder of discovery.value.folders) {
    const writable = await deps.fs.isWritable(folder.path);
    if (!writable.ok) return writable;
    if (!writable.value) {
      if (!input.dryRun) {
        return abortRun(input, discovery.value.root, totals, state, startedAt, progress, targetReadOnly(folder.path));
      }
      state.foldersNotWritable += 1;
    }

    const folderStarted = await reportStep(progress, 'folder-started', {
      path: folder.path,
      filesTotal: folder.videoPaths.length,
      writable: writable.value,
    });
    if (!folderStarted.ok) return folderStarted;

    let folderId: string;
    if (input.dryRun) {
      const marker = await readFolderMarker(deps.fs, folder.path);
      if (!marker.ok) return marker;
      folderId = marker.value?.folderId ?? derivedFolderId(deps.fs.resolve(folder.path));
    } else {
      const resolved = await resolveFolderIntoIndex({ globalCatalog: deps.globalCatalog, fs: deps.fs }, folder.path);
      if (!resolved.ok) return resolved;
      if (!resolved.value.persistent) {
        return abortRun(input, discovery.value.root, totals, state, startedAt, progress, targetReadOnly(folder.path));
      }
      folderId = resolved.value.folderId;
    }

    const folderCounts = { materialized: 0, unchanged: 0, skipped: 0, failed: 0 };
    let folderChanged = false;

    for (const videoPath of folder.videoPaths) {
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      fileIndex += 1;

      const planned = await planFile(deps, folder.path, folderId, videoPath);
      if (!planned.ok) {
        consecutiveFailures += 1;
        folderCounts.failed += 1;
        state.filesFailed += 1;
        state.failures.push(failureRecord(videoPath, planned.error));
        if (isReadOnlyWriteError(planned.error)) {
          return abortRun(input, discovery.value.root, totals, state, startedAt, progress, targetReadOnly(folder.path, planned.error));
        }
        if (consecutiveFailures >= maxConsecutiveFailures) {
          return abortRun(input, discovery.value.root, totals, state, startedAt, progress,
            appError('drive_run_aborted', `Aborted materialize run after ${maxConsecutiveFailures} consecutive file failures. Re-run the same root to resume.`, { failures: state.failures }));
        }
        continue;
      }

      if (planned.value.kind === 'skip') {
        state.filesSkipped += 1;
        folderCounts.skipped += 1;
        state.skipped[skipCounterKey(planned.value.reason)] += 1;
        const skipReported = await reportStep(progress, 'file-skipped', { video: videoPath, reason: planned.value.reason });
        if (!skipReported.ok) return skipReported;
        continue;
      }

      const plan = planned.value.plan;
      if (plan.collision) state.collisions += 1;

      const applied = await applyFile(deps, folder.path, plan, input.dryRun);
      if (!applied.ok) {
        consecutiveFailures += 1;
        folderCounts.failed += 1;
        state.filesFailed += 1;
        state.failures.push(failureRecord(videoPath, applied.error));
        if (isReadOnlyWriteError(applied.error)) {
          return abortRun(input, discovery.value.root, totals, state, startedAt, progress, targetReadOnly(folder.path, applied.error));
        }
        if (consecutiveFailures >= maxConsecutiveFailures) {
          return abortRun(input, discovery.value.root, totals, state, startedAt, progress,
            appError('drive_run_aborted', `Aborted materialize run after ${maxConsecutiveFailures} consecutive file failures. Re-run the same root to resume.`, { failures: state.failures }));
        }
        continue;
      }

      consecutiveFailures = 0;
      const changed = applied.value.operations.length > 0;
      if (changed) {
        state.filesMaterialized += 1;
        folderCounts.materialized += 1;
        folderChanged = true;
      } else {
        state.filesUnchanged += 1;
        folderCounts.unchanged += 1;
      }

      const fileReported = await reportFile(progress, fileIndex, discovery.value.filesTotal, {
        video: videoPath,
        fingerprint: plan.fingerprint,
        configId: plan.variant.configId,
        finalName: plan.finalName,
        appliedName: plan.appliedName,
        collision: plan.collision,
        changed,
        dryRun: input.dryRun,
        operations: applied.value.operations,
      });
      if (!fileReported.ok) return fileReported;
    }

    if (!input.dryRun && folderChanged) {
      const folderRow = await deps.globalCatalog.getFolder(folderId);
      if (!folderRow.ok) return folderRow;
      if (folderRow.value !== null) {
        const snapshot = await exportFolderSnapshot({ globalCatalog: deps.globalCatalog, fs: deps.fs }, folderRow.value);
        if (!snapshot.ok) {
          if (isReadOnlyWriteError(snapshot.error)) {
            return abortRun(input, discovery.value.root, totals, state, startedAt, progress, targetReadOnly(folder.path, snapshot.error));
          }
          return snapshot;
        }
      }
      const flushed = await deps.globalCatalog.flush();
      if (!flushed.ok) return flushed;
    }

    state.foldersDone += 1;
    const folderDone = await reportStep(progress, 'folder-done', {
      path: folder.path,
      filesMaterialized: folderCounts.materialized,
      filesUnchanged: folderCounts.unchanged,
      filesSkipped: folderCounts.skipped,
      filesFailed: folderCounts.failed,
    });
    if (!folderDone.ok) return folderDone;
  }

  if (!input.dryRun) {
    const flushed = await deps.globalCatalog.flush();
    if (!flushed.ok) return flushed;
  }

  return finishRun(input, discovery.value.root, totals, state, startedAt, progress);
};

interface RunTotals {
  foldersTotal: number;
  filesTotal: number;
}

const finishRun = async (
  input: MaterializeInput,
  root: string,
  totals: RunTotals,
  state: MutableState,
  startedAt: Date,
  progress: JobExecutionContext | undefined,
): Promise<Result<MaterializeSummary, AppError>> => {
  const summary = summaryFromState(input, root, totals, state, startedAt);
  const reported = await reportStep(progress, 'run-summary', { ...summary });
  if (!reported.ok) return reported;
  return ok(summary);
};

const abortRun = async (
  input: MaterializeInput,
  root: string,
  totals: RunTotals,
  state: MutableState,
  startedAt: Date,
  progress: JobExecutionContext | undefined,
  error: AppError,
): Promise<Result<never, AppError>> => {
  const summary = summaryFromState(input, root, totals, state, startedAt);
  const reported = await reportStep(progress, 'run-summary', { ...summary });
  if (!reported.ok) return reported;
  return { ok: false, error };
};

const summaryFromState = (
  input: MaterializeInput,
  root: string,
  totals: RunTotals,
  state: MutableState,
  startedAt: Date,
): MaterializeSummary => ({
  root,
  dryRun: input.dryRun,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  foldersTotal: totals.foldersTotal,
  foldersDone: state.foldersDone,
  foldersNotWritable: state.foldersNotWritable,
  filesTotal: totals.filesTotal,
  filesMaterialized: state.filesMaterialized,
  filesUnchanged: state.filesUnchanged,
  filesSkipped: state.filesSkipped,
  filesFailed: state.filesFailed,
  collisions: state.collisions,
  skipped: state.skipped,
  elapsedMs: Math.max(0, Date.now() - startedAt.getTime()),
  failures: state.failures,
});

const targetReadOnly = (folderPath: string, cause?: AppError): AppError =>
  appError(
    'target_read_only',
    `Target folder is not writable: ${folderPath}. Remount the drive read-write and re-run.`,
    cause === undefined ? { folder: folderPath } : { folder: folderPath, cause: cause.message },
  );

const skipCounterKey = (reason: MaterializeSkipReason): keyof MaterializeSummary['skipped'] => {
  switch (reason) {
    case 'not_in_catalog':
      return 'notInCatalog';
    case 'no_variant':
      return 'noVariant';
    case 'no_final_name':
      return 'noFinalName';
    case 'fingerprint_unavailable':
      return 'fingerprintUnavailable';
    case 'duplicate':
      return 'duplicate';
  }
};

const planFile = async (
  deps: MaterializeDeps,
  folderPath: string,
  folderId: string,
  videoPath: string,
): Promise<Result<PlanFileResult, AppError>> => {
  const fingerprint = await deps.fs.partialContentHash(videoPath);
  if (!fingerprint.ok) return fingerprint;
  if (fingerprint.value === null) return ok({ kind: 'skip', reason: 'fingerprint_unavailable' });

  const file = await deps.globalCatalog.getFile(fingerprint.value);
  if (!file.ok) return file;
  if (file.value === null) return ok({ kind: 'skip', reason: 'not_in_catalog' });

  const selectedConfigId = await deps.globalCatalog.getSelectedConfigId(fingerprint.value);
  if (!selectedConfigId.ok) return selectedConfigId;
  if (selectedConfigId.value === null) return ok({ kind: 'skip', reason: 'no_variant' });

  const variant = await deps.globalCatalog.getVariant(fingerprint.value, selectedConfigId.value);
  if (!variant.ok) return variant;
  if (variant.value === null) return ok({ kind: 'skip', reason: 'no_variant' });

  const variants = await deps.globalCatalog.listVariants(fingerprint.value);
  if (!variants.ok) return variants;

  const duplicate = await isDuplicate(deps, videoPath, file.value, variant.value);
  if (!duplicate.ok) return duplicate;
  if (duplicate.value) return ok({ kind: 'skip', reason: 'duplicate' });

  const finalName = await resolveFinalName(deps, folderPath, file.value.folderId, fingerprint.value, videoPath, variant.value);
  if (!finalName.ok) return finalName;
  if (finalName.value === null) return ok({ kind: 'skip', reason: 'no_final_name' });

  const currentBaseName = deps.fs.basename(videoPath);
  let appliedName: string;
  let collision: boolean;
  if (currentBaseName === finalName.value) {
    appliedName = finalName.value;
    collision = false;
  } else {
    const unique = await uniqueFilename(
      deps.fs,
      folderPath,
      deps.fs.basenameWithoutExtension(finalName.value),
      deps.fs.extname(videoPath),
    );
    if (!unique.ok) return unique;
    appliedName = unique.value;
    collision = appliedName !== finalName.value;
  }

  const folderRoot = folderArtifactRoot(deps.fs, folderPath);
  const artifactOps = await planArtifactStoreOps(deps, folderPath, file.value.folderId, fingerprint.value, variants.value, folderRoot);
  if (!artifactOps.ok) return artifactOps;

  const projection = await planProjection(deps, folderPath, file.value.folderId, fingerprint.value, variant.value, appliedName, folderRoot);
  if (!projection.ok) return projection;

  const thumbnail = await planThumbnail(deps, folderPath, file.value.folderId, videoPath, appliedName, folderRoot);
  if (!thumbnail.ok) return thumbnail;

  return ok({
    kind: 'plan',
    plan: {
      fingerprint: fingerprint.value,
      folderId,
      videoPath,
      file: file.value,
      variant: variant.value,
      variants: variants.value,
      finalName: finalName.value,
      appliedName,
      collision,
      artifactOps: artifactOps.value,
      needsFinalNameUpdate: variant.value.finalName !== appliedName,
      needsRename: currentBaseName !== appliedName,
      needsRelocate: file.value.folderId !== folderId || file.value.fileName !== appliedName,
      projectionSource: projection.value.needed ? projection.value.source : null,
      needsProjection: projection.value.needed,
      thumbnailCopy: thumbnail.value,
    },
  });
};

const isDuplicate = async (
  deps: MaterializeDeps,
  videoPath: string,
  file: { folderId: string; fileName: string },
  variant: CatalogVariant,
): Promise<Result<boolean, AppError>> => {
  const folder = await deps.globalCatalog.getFolder(file.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) return ok(false);
  const candidateNames = [...new Set([file.fileName, variant.finalName].filter((name): name is string => name !== null))];
  const resolvedVideoPath = deps.fs.resolve(videoPath);
  for (const name of candidateNames) {
    const candidatePath = deps.fs.join(folder.value.currentPath, name);
    const isFile = await deps.fs.isFile(candidatePath);
    if (!isFile.ok) return isFile;
    if (!isFile.value) continue;
    return ok(deps.fs.resolve(candidatePath) !== resolvedVideoPath);
  }
  return ok(false);
};

const resolveVariantSourceRoot = async (
  deps: MaterializeDeps,
  folderPath: string,
  fileFolderId: string,
  fingerprint: string,
  configId: string,
): Promise<Result<ArtifactRoot | null, AppError>> => {
  const candidates = [
    folderArtifactRoot(deps.fs, folderPath),
    readOnlyArtifactRootById(deps.fs, fileFolderId),
    readOnlyArtifactRoot(deps.fs, folderPath),
  ];
  for (const candidate of candidates) {
    const summaryJsonPath = variantOutputPaths(deps.fs, candidate, fingerprint, configId).summaryJsonPath;
    const isFile = await deps.fs.isFile(summaryJsonPath);
    if (!isFile.ok) return isFile;
    if (isFile.value) return ok(candidate);
  }
  return ok(null);
};

const resolveFinalName = async (
  deps: MaterializeDeps,
  folderPath: string,
  fileFolderId: string,
  fingerprint: string,
  videoPath: string,
  variant: CatalogVariant,
): Promise<Result<string | null, AppError>> => {
  if (variant.finalName !== null) return ok(variant.finalName);

  const sourceRoot = await resolveVariantSourceRoot(deps, folderPath, fileFolderId, fingerprint, variant.configId);
  if (!sourceRoot.ok) return sourceRoot;
  if (sourceRoot.value === null) return ok(null);

  const summaryJsonPath = variantOutputPaths(deps.fs, sourceRoot.value, fingerprint, variant.configId).summaryJsonPath;
  const content = await deps.fs.readTextFile(summaryJsonPath);
  if (!content.ok) return content;
  if (content.value === null) return ok(null);
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return ok(null);
  }
  const parsed = summaryDataSchema.safeParse(decoded);
  if (!parsed.success) return ok(null);

  const stat = await deps.fs.stat(videoPath);
  if (!stat.ok) return stat;

  return ok(`${finalVideoName(stat.value.mtimeMs, parsed.data.suggestedFilename)}${deps.fs.extname(videoPath)}`);
};

const planArtifactStoreOps = async (
  deps: MaterializeDeps,
  folderPath: string,
  fileFolderId: string,
  fingerprint: string,
  variants: readonly CatalogVariant[],
  folderRoot: ArtifactRoot,
): Promise<Result<ArtifactCopyOp[], AppError>> => {
  const ops: ArtifactCopyOp[] = [];
  const seenTargets = new Set<string>();

  const addOp = async (source: string, target: string): Promise<Result<void, AppError>> => {
    if (seenTargets.has(target)) return ok(undefined);
    const targetExists = await deps.fs.exists(target);
    if (!targetExists.ok) return targetExists;
    if (targetExists.value) return ok(undefined);
    const sourceExists = await deps.fs.isFile(source);
    if (!sourceExists.ok) return sourceExists;
    if (!sourceExists.value) return ok(undefined);
    seenTargets.add(target);
    ops.push({ source, target });
    return ok(undefined);
  };

  for (const variant of variants) {
    const sourceRoot = await resolveVariantSourceRoot(deps, folderPath, fileFolderId, fingerprint, variant.configId);
    if (!sourceRoot.ok) return sourceRoot;
    if (sourceRoot.value === null) continue;

    const sourceOutputs = variantOutputPaths(deps.fs, sourceRoot.value, fingerprint, variant.configId);
    const targetOutputs = variantOutputPaths(deps.fs, folderRoot, fingerprint, variant.configId);
    const added1 = await addOp(sourceOutputs.summaryJsonPath, targetOutputs.summaryJsonPath);
    if (!added1.ok) return added1;
    const added2 = await addOp(sourceOutputs.summaryPath, targetOutputs.summaryPath);
    if (!added2.ok) return added2;
    const added3 = await addOp(sourceOutputs.debugLogPath, targetOutputs.debugLogPath);
    if (!added3.ok) return added3;

    if (variant.descriptor === null) continue;
    const sourceShared = sharedArtifactPaths(deps.fs, sourceRoot.value, fingerprint, variant.descriptor);
    const targetShared = sharedArtifactPaths(deps.fs, folderRoot, fingerprint, variant.descriptor);
    const added4 = await addOp(sourceShared.transcriptPath, targetShared.transcriptPath);
    if (!added4.ok) return added4;
    const added5 = await addOp(sourceShared.transcriptJsonPath, targetShared.transcriptJsonPath);
    if (!added5.ok) return added5;

    if (sourceShared.framesDirectory === null || targetShared.framesDirectory === null) continue;
    const isDirectory = await deps.fs.isDirectory(sourceShared.framesDirectory);
    if (!isDirectory.ok) return isDirectory;
    if (!isDirectory.value) continue;
    const entries = await deps.fs.listDirectory(sourceShared.framesDirectory);
    if (!entries.ok) return entries;
    for (const entry of entries.value) {
      if (entry.kind !== 'file' || !frameFileNamePattern.test(entry.name)) continue;
      const added = await addOp(entry.path, deps.fs.join(targetShared.framesDirectory, entry.name));
      if (!added.ok) return added;
    }
  }

  return ok(ops);
};

const planProjection = async (
  deps: MaterializeDeps,
  folderPath: string,
  fileFolderId: string,
  fingerprint: string,
  variant: CatalogVariant,
  appliedName: string,
  folderRoot: ArtifactRoot,
): Promise<Result<{ needed: boolean; source: SelectedVariantProjectionSource }, AppError>> => {
  const sourceRoot = await resolveVariantSourceRoot(deps, folderPath, fileFolderId, fingerprint, variant.configId);
  if (!sourceRoot.ok) return sourceRoot;
  const source: SelectedVariantProjectionSource = { framesDirectory: null, transcriptPath: null, transcriptJsonPath: null, summaryPath: '', summaryJsonPath: '', debugLogPath: null };
  if (sourceRoot.value === null) return ok({ needed: false, source });

  const outputs = variantOutputPaths(deps.fs, sourceRoot.value, fingerprint, variant.configId);
  source.summaryPath = outputs.summaryPath;
  source.summaryJsonPath = outputs.summaryJsonPath;
  const debugExists = await deps.fs.isFile(outputs.debugLogPath);
  if (!debugExists.ok) return debugExists;
  source.debugLogPath = debugExists.value ? outputs.debugLogPath : null;

  if (variant.descriptor !== null) {
    const shared = sharedArtifactPaths(deps.fs, sourceRoot.value, fingerprint, variant.descriptor);
    const transcriptExists = await deps.fs.isFile(shared.transcriptPath);
    if (!transcriptExists.ok) return transcriptExists;
    source.transcriptPath = transcriptExists.value ? shared.transcriptPath : null;
    const transcriptJsonExists = await deps.fs.isFile(shared.transcriptJsonPath);
    if (!transcriptJsonExists.ok) return transcriptJsonExists;
    source.transcriptJsonPath = transcriptJsonExists.value ? shared.transcriptJsonPath : null;
    if (shared.framesDirectory !== null) {
      const framesExist = await deps.fs.isDirectory(shared.framesDirectory);
      if (!framesExist.ok) return framesExist;
      source.framesDirectory = framesExist.value ? shared.framesDirectory : null;
    }
  }

  const summaryJsonExists = await deps.fs.isFile(outputs.summaryJsonPath);
  if (!summaryJsonExists.ok) return summaryJsonExists;
  if (!summaryJsonExists.value) return ok({ needed: false, source });

  const targetSummaryJsonPath = deps.fs.join(folderRoot.path, 'summaries', `${deps.fs.basenameWithoutExtension(appliedName)}.json`);
  const alreadyProjected = await deps.fs.isFile(targetSummaryJsonPath);
  if (!alreadyProjected.ok) return alreadyProjected;
  return ok({ needed: !alreadyProjected.value, source });
};

const planThumbnail = async (
  deps: MaterializeDeps,
  folderPath: string,
  fileFolderId: string,
  videoPath: string,
  appliedName: string,
  folderRoot: ArtifactRoot,
): Promise<Result<ArtifactCopyOp | null, AppError>> => {
  const sourceRoots = [folderArtifactRoot(deps.fs, folderPath), readOnlyArtifactRootById(deps.fs, fileFolderId), readOnlyArtifactRoot(deps.fs, folderPath)];
  for (const sourceRoot of sourceRoots) {
    const source = deps.fs.join(sourceRoot.catalogDirectory, 'thumbnails', `${deps.fs.basenameWithoutExtension(videoPath)}.jpg`);
    const sourceExists = await deps.fs.isFile(source);
    if (!sourceExists.ok) return sourceExists;
    if (!sourceExists.value) continue;
    const target = deps.fs.join(folderRoot.catalogDirectory, 'thumbnails', `${deps.fs.basenameWithoutExtension(appliedName)}.jpg`);
    const targetExists = await deps.fs.exists(target);
    if (!targetExists.ok) return targetExists;
    if (targetExists.value) return ok(null);
    return ok({ source, target });
  }
  return ok(null);
};

const applyFile = async (
  deps: MaterializeDeps,
  folderPath: string,
  plan: FilePlan,
  dryRun: boolean,
): Promise<Result<{ operations: MaterializeOperationKind[] }, AppError>> => {
  const operations: MaterializeOperationKind[] = [];

  if (plan.artifactOps.length > 0) {
    operations.push('artifact_store');
    if (!dryRun) {
      for (const op of plan.artifactOps) {
        const ensured = await deps.fs.ensureDirectory(deps.fs.dirname(op.target));
        if (!ensured.ok) return ensured;
        const copied = await materializeArtifactFile(deps.fs, op.source, op.target);
        if (!copied.ok) return copied;
      }
    }
  }

  if (plan.needsFinalNameUpdate) {
    operations.push('catalog_final_name');
    if (!dryRun) {
      const upserted = await deps.globalCatalog.upsertVariant({ ...plan.variant, finalName: plan.appliedName });
      if (!upserted.ok) return upserted;
    }
  }

  if (plan.needsRename) {
    operations.push('rename_video');
    if (!dryRun) {
      const renamed = await deps.fs.renamePath(plan.videoPath, deps.fs.join(folderPath, plan.appliedName));
      if (!renamed.ok) return renamed;
    }
  }

  if (plan.needsRelocate) {
    operations.push('catalog_relocate');
    if (!dryRun) {
      const relocated = await deps.globalCatalog.relocateFile(plan.fingerprint, plan.folderId, plan.appliedName);
      if (!relocated.ok) return relocated;
    }
  }

  if (plan.needsProjection && plan.projectionSource !== null) {
    operations.push('project_selected');
    if (!dryRun) {
      const projected = await materializeSelectedVariantProjection(
        deps.fs,
        folderArtifactRoot(deps.fs, folderPath),
        deps.fs.join(folderPath, plan.appliedName),
        plan.appliedName,
        plan.projectionSource,
      );
      if (!projected.ok) return projected;
    }
  }

  if (plan.thumbnailCopy !== null) {
    operations.push('copy_thumbnail');
    if (!dryRun) {
      const ensured = await deps.fs.ensureDirectory(deps.fs.dirname(plan.thumbnailCopy.target));
      if (!ensured.ok) return ensured;
      const copied = await materializeArtifactFile(deps.fs, plan.thumbnailCopy.source, plan.thumbnailCopy.target);
      if (!copied.ok) return copied;
    }
  }

  return ok({ operations });
};

const reportFile = (
  progress: JobExecutionContext | undefined,
  current: number,
  total: number,
  data: Record<string, unknown>,
): Promise<Result<void, AppError>> => {
  if (progress === undefined) return Promise.resolve(ok(undefined));
  return progress.reportProgress({ step: 'materialize_file', current, total, data });
};

const failureRecord = (path: string, error: AppError): DriveRunFailure => ({
  path,
  scope: 'file',
  code: error.code,
  message: error.message,
});

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress?.signal.aborted === true) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};
