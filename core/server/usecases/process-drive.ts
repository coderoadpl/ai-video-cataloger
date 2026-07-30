import { randomUUID } from 'node:crypto';

import {
  appError,
  configDescriptorSchema,
  configId,
  configValueSchema,
  driveRunBatchDisplayName,
  geminiModelPrice,
  isBatchSubmitRejection,
  ok,
  spendMonth,
  type AnalyzerProviderConfig,
  type AnalyzerProviderId,
  type AppConfig,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type DriveRunBatchRequest,
  type DriveRunBatchState,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AnalyzerBatchPort,
  type AnalyzerBatchRequest,
  type DriveRunRecord,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
} from '../ports.js';
import type { ProcessConfigIdentity, ProcessDeps, ProcessPipelineInput } from './process.js';
import { analyzedCanonicalIsReachable } from './canonical-reachability.js';
import { reconcileFolderPresence, resolveFolderIntoIndex } from './catalog-index.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { faceArtifactsInstalled, facesEnabled, runFacesIndexPass, type FacesIndexDeps } from './faces.js';
import { isReadOnlyWriteError, readFolderMarker } from './folder-identity.js';
import { processConfigIdentity, processVideoPipeline, resolveProcessOptions } from './process.js';
import {
  awaitBatchResults,
  batchJobFailureError,
  ensureBatchJob,
  expiredBatchFileError,
  reportStep as report,
} from './process-drive-batch.js';
import { resolveConfigValues } from './config-resolution.js';
import { scanFolder, type ScanVideo } from './scan.js';
import { isSupportedVideoExtension, shouldSkipDirectory } from './shared.js';

const maxRetries = 2;
const maxConsecutiveFailures = 5;

export interface CatalogFolderDiscovery {
  path: string;
  videoPaths: string[];
}

export interface DriveRunFailure {
  path: string;
  scope: 'folder' | 'file';
  code: AppError['code'];
  message: string;
}

export interface DiscoverDriveOutput {
  root: string;
  folders: CatalogFolderDiscovery[];
  filesTotal: number;
  failures: DriveRunFailure[];
}

export interface ProcessDriveInput {
  root: string;
  frames: number;
  framesExplicit?: boolean | undefined;
  skipRename: boolean;
  skipRenameExplicit?: boolean | undefined;
  verbose: boolean;
  timeout: number;
  timeoutExplicit?: boolean | undefined;
  whisper: AppConfig['whisper_mode'];
  whisperExplicit?: boolean | undefined;
  whisperModel: WhisperModelName;
  whisperModelExplicit?: boolean | undefined;
  whisperLanguage?: AppConfig['whisper_language'] | undefined;
  whisperLanguageExplicit?: boolean | undefined;
  analyzer?: AppConfig['analyzer_backend'] | 'api' | undefined;
  provider?: AnalyzerProviderId | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
  skipDuplicates?: boolean | undefined;
  geminiBatch?: boolean | undefined;
  geminiBatchExplicit?: boolean | undefined;
  skipFaces?: boolean | undefined;
}

export type DriveRunFacesSkipReason =
  | 'flag'
  | 'artifacts_missing'
  | 'unavailable'
  | 'cancelled'
  | 'failed';

export interface DriveRunFacesSummary {
  ran: boolean;
  skippedReason: DriveRunFacesSkipReason | null;
  filesIndexed: number;
  observationsAdded: number;
  peopleCreated: number;
  filesFailed: number;
  failureCodes: { code: AppError['code']; count: number }[];
  aborted: boolean;
  error: { code: AppError['code']; message: string } | null;
}

export interface DriveRunSummary {
  runId: string;
  root: string;
  startedAt: string;
  finishedAt: string | null;
  foldersTotal: number;
  foldersDone: number;
  filesTotal: number;
  filesDone: number;
  filesSkipped: number;
  filesDuplicateSkipped: number;
  filesFailed: number;
  costEstimate?: {
    kind: 'estimate';
    currency: 'USD';
    files: number;
    estimatedCostUsd: number;
  } | undefined;
  faces?: DriveRunFacesSummary | undefined;
  snapshotSkipped: number;
  elapsedMs: number;
  failures: DriveRunFailure[];
}

export interface DriveRunOptions {
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  jitter?: ((attempt: number) => number) | undefined;
  now?: (() => Date) | undefined;
  runId?: string | undefined;
  batchPollDelayMs?: ((attempt: number) => number) | undefined;
}

interface DriveBatchPlan {
  analyzerBatch: AnalyzerBatchPort;
  provider: AnalyzerProviderConfig;
  model: string;
  configIdentity: ProcessConfigIdentity;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  timeoutSeconds: number;
  reattachedRequests: Map<string, DriveRunBatchRequest> | null;
}

interface PendingBatchFile {
  video: ScanVideo;
  key: string;
  fileIndex: number;
}

interface DeferredFolder {
  path: string;
  counts: FolderRunCounts;
  pending: PendingBatchFile[];
}

interface FolderRunCounts {
  filesDone: number;
  filesSkipped: number;
  filesDuplicateSkipped: number;
  filesFailed: number;
}

interface MutableRunState {
  run: DriveRunRecord;
  filesTotal: number;
  filesDuplicateSkipped: number;
  snapshotSkipped: number;
  failures: DriveRunFailure[];
  startedMs: number;
  faces: DriveRunFacesSummary | null;
}

export const discoverCatalogFolders = async (
  fs: FileSystemPort,
  input: { root: string },
): Promise<Result<DiscoverDriveOutput, AppError>> => {
  const root = fs.resolve(input.root);
  const exists = await fs.exists(root);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: false, error: appError('folder_not_found', `Root not found: ${root}`) };
  const directory = await fs.isDirectory(root);
  if (!directory.ok) return directory;
  if (!directory.value) return { ok: false, error: appError('not_a_directory', `Root is not a directory: ${root}`) };

  const folders: CatalogFolderDiscovery[] = [];
  const failures: DriveRunFailure[] = [];
  await walkCatalogTree(fs, root, folders, failures);
  const orderedFolders = folders.sort((left, right) => left.path.localeCompare(right.path));
  return ok({
    root,
    folders: orderedFolders,
    filesTotal: orderedFolders.reduce((total, folder) => total + folder.videoPaths.length, 0),
    failures,
  });
};

export const processDrive = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  progress?: JobExecutionContext,
  options: DriveRunOptions = {},
): Promise<Result<DriveRunSummary, AppError>> => {
  if (deps.globalCatalog === undefined) {
    return { ok: false, error: appError('internal', 'Global catalog is required for drive processing') };
  }
  const globalCatalog = deps.globalCatalog;
  const budget = await geminiMonthlyBudget(deps);
  if (!budget.ok) return budget;
  const discovery = await discoverCatalogFolders(deps.fs, { root: input.root });
  if (!discovery.ok) return discovery;
  if (discovery.value.folders.length === 0) {
    return { ok: false, error: appError('drive_root_empty', `No catalog folders found under: ${discovery.value.root}`) };
  }

  const now = options.now ?? (() => new Date());
  const started = now();
  const batchFolders = await resolveBatchFolders(deps, input, discovery.value.folders);
  if (!batchFolders.ok) return batchFolders;
  const planAnchor = discovery.value.folders.find((folder) => batchFolders.value.has(folder.path))?.path ?? null;
  const batchPlan: Result<DriveBatchPlan | null, AppError> = planAnchor === null
    ? ok(null)
    : await resolveBatchPlan(deps, input, planAnchor);
  if (!batchPlan.ok) return batchPlan;
  const resumable: Result<ResumableBatchRun, AppError> = batchPlan.value === null
    ? ok({ adopted: null, orphanJobNames: [] })
    : await resumableBatchRun(globalCatalog, discovery.value.root);
  if (!resumable.ok) return resumable;
  const adopted = resumable.value.adopted;
  const usesPricedGemini = await driveUsesPricedGemini(deps, input, discovery.value.folders);
  if (!usesPricedGemini.ok) return usesPricedGemini;
  const activeBudget = usesPricedGemini.value
    || (adopted?.batch !== null && adopted?.batch !== undefined && geminiModelPrice(adopted.batch.model, 0) !== null)
    ? budget.value
    : null;
  const state: MutableRunState = {
    run: {
      runId: adopted?.runId ?? options.runId ?? randomUUID(),
      root: discovery.value.root,
      startedAt: adopted?.startedAt ?? started.toISOString(),
      finishedAt: null,
      foldersTotal: discovery.value.folders.length,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: started.toISOString(),
      batch: adopted?.batch ?? null,
    },
    filesTotal: discovery.value.filesTotal,
    filesDuplicateSkipped: 0,
    snapshotSkipped: 0,
    failures: [...discovery.value.failures],
    startedMs: started.getTime(),
    faces: null,
  };
  const plan = batchPlan.value === null || adopted?.batch == null
    ? batchPlan.value
    : { ...batchPlan.value, reattachedRequests: new Map(adopted.batch.requests.map((request) => [request.videoPath, request])) };

  const startedRun = adopted === null
    ? await deps.globalCatalog.startDriveRun(state.run)
    : await deps.globalCatalog.updateDriveRun(state.run);
  if (!startedRun.ok) return startedRun;

  const runFirstSeenAt = started.toISOString();
  for (const folder of discovery.value.folders) {
    const registered = await resolveFolderIntoIndex({ globalCatalog, fs: deps.fs }, folder.path, { firstSeenAt: runFirstSeenAt });
    if (!registered.ok) return registered;
  }

  const runStarted = await report(progress, 'run-started', {
    runId: state.run.runId,
    root: state.run.root,
    foldersTotal: state.run.foldersTotal,
    filesTotal: state.filesTotal,
  });
  if (!runStarted.ok) return runStarted;

  const initialBudgetPause = await pauseForBudget(deps, state, progress, now, activeBudget);
  if (!initialBudgetPause.ok) return initialBudgetPause;

  if (resumable.value.orphanJobNames.length > 0) {
    const orphansReported = await report(progress, 'batch_orphan_jobs', {
      adoptedJobName: adopted?.batch?.jobName ?? null,
      jobNames: resumable.value.orphanJobNames,
    });
    if (!orphansReported.ok) return orphansReported;
  }

  let consecutiveFailures = 0;
  let fileIndex = 0;
  const folderPresences: { folderPath: string; presentFingerprints: string[]; hashUnavailable: boolean }[] = [];
  const snapshotRefreshFolderIds = new Set<string>();
  const deferredFolders: DeferredFolder[] = [];
  const batchRequests: AnalyzerBatchRequest[] = [];
  for (const folder of discovery.value.folders) {
    const folderStarted = await report(progress, 'folder-started', {
      path: folder.path,
      filesTotal: folder.videoPaths.length,
    });
    if (!folderStarted.ok) return folderStarted;

    const scan = await scanFolder(deps, { folder: folder.path });
    if (!scan.ok) {
      state.failures.push(failureRecord(folder.path, 'folder', scan.error));
      state.run.foldersDone += 1;
      const persisted = await persistRun(deps, state, now);
      if (!persisted.ok) return persisted;
      const done = await reportFolderDone(progress, folder.path, {
        filesDone: 0,
        filesSkipped: 0,
        filesDuplicateSkipped: 0,
        filesFailed: 1,
      });
      if (!done.ok) return done;
      continue;
    }

    const folderCounts: FolderRunCounts = {
      filesDone: 0,
      filesSkipped: 0,
      filesDuplicateSkipped: 0,
      filesFailed: 0,
    };
    const pendingBatchFiles: PendingBatchFile[] = [];
    const batchesHere = plan === null || !batchFolders.value.has(folder.path)
      ? ok(false)
      : await folderTakesBatch(deps, input, folder.path, plan);
    if (!batchesHere.ok) return batchesHere;
    for (const video of scan.value.videos) {
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      fileIndex += 1;
      if (input.skipDuplicates === true && video.duplicate != null) {
        const skipReported = await report(progress, 'file-skipped', { video: video.path, reason: 'duplicate' });
        if (!skipReported.ok) return skipReported;
        state.run.filesSkipped += 1;
        state.filesDuplicateSkipped += 1;
        folderCounts.filesSkipped += 1;
        folderCounts.filesDuplicateSkipped += 1;
        continue;
      }
      const batchIdentity = plan !== null && batchesHere.value
        ? resolvedBatchIdentity(plan, state.run.batch)
        : null;
      const skipped = await alreadyProcessed(deps, input, video, batchIdentity);
      if (!skipped.ok) return skipped;
      if (skipped.value) {
        const skipReported = await report(progress, 'file-skipped', { video: video.path });
        if (!skipReported.ok) return skipReported;
      }
      if (plan !== null && batchesHere.value && !skipped.value) {
        const enrolled = await enrolInBatch(plan, video.path, `r${batchRequests.length}`, progress?.signal);
        if (enrolled.ok) {
          if (enrolled.value !== null) {
            batchRequests.push(enrolled.value);
            pendingBatchFiles.push({ video, key: enrolled.value.key, fileIndex });
            continue;
          }
        } else {
          consecutiveFailures += 1;
          const recorded = await recordFileFailure(deps, state, folderCounts, video.path, enrolled.error, now);
          if (!recorded.ok) return recorded;
          if (consecutiveFailures >= maxConsecutiveFailures) return abortedRun(deps, state, progress, now);
          continue;
        }
      }
      const result = await runDriveFile(
        deps,
        input,
        video.path,
        fileIndex,
        state.filesTotal,
        state.run.runId,
        skipped.value,
        progress,
        options,
      );
      if (result.ok) {
        consecutiveFailures = 0;
        if (result.value.snapshotSkipped) state.snapshotSkipped += 1;
        if (skipped.value) {
          const relocated = await relocateResumedFile(deps, globalCatalog, folder.path, video);
          if (!relocated.ok) return relocated;
          for (const folderId of relocated.value) snapshotRefreshFolderIds.add(folderId);
          state.run.filesSkipped += 1;
          folderCounts.filesSkipped += 1;
        } else {
          state.run.filesDone += 1;
          folderCounts.filesDone += 1;
        }
        const budgetPause = await pauseForBudget(deps, state, progress, now, activeBudget);
        if (!budgetPause.ok) return budgetPause;
        continue;
      }

      consecutiveFailures += 1;
      const recorded = await recordFileFailure(deps, state, folderCounts, video.path, result.error, now);
      if (!recorded.ok) return recorded;
      const budgetPause = await pauseForBudget(deps, state, progress, now, activeBudget);
      if (!budgetPause.ok) return budgetPause;
      if (consecutiveFailures >= maxConsecutiveFailures) return abortedRun(deps, state, progress, now);
    }

    const presentFingerprints = scan.value.videos
      .map((video) => video.contentHash)
      .filter((hash): hash is string => hash !== null);
    const hashUnavailable = scan.value.videos.some((video) => video.contentHash === null);
    folderPresences.push({ folderPath: folder.path, presentFingerprints, hashUnavailable });

    if (pendingBatchFiles.length > 0) {
      deferredFolders.push({ path: folder.path, counts: folderCounts, pending: pendingBatchFiles });
      continue;
    }
    const closed = await closeFolder(deps, globalCatalog, state, folder.path, folderCounts, progress, now);
    if (!closed.ok) return closed;
  }

  if (plan !== null && batchRequests.length > 0) {
    const mapped = await runBatchPass({
      deps,
      globalCatalog,
      input,
      state,
      plan,
      requests: batchRequests,
      deferred: deferredFolders,
      progress,
      options,
      now,
      budget: activeBudget,
    });
    if (!mapped.ok) return mapped;
  } else if (plan !== null && state.run.batch !== null) {
    const dropped = await dropAdoptedBatch(plan, state, progress);
    if (!dropped.ok) return dropped;
  }

  const presentAcrossRun = [...new Set(folderPresences.flatMap((entry) => entry.presentFingerprints))];
  for (const entry of folderPresences) {
    const reconciled = await reconcileFolderPresence(
      { globalCatalog, fs: deps.fs },
      {
        folderPath: entry.folderPath,
        presentFingerprints: entry.presentFingerprints,
        fingerprintsPresentElsewhere: presentAcrossRun,
        markMissing: !entry.hashUnavailable,
        now: now().getTime(),
      },
    );
    if (!reconciled.ok) return reconciled;
  }

  const visitedFolderPaths = new Set(discovery.value.folders.map((entry) => entry.path));
  const discoveryFailedFolders = discovery.value.failures
    .filter((entry) => entry.scope === 'folder')
    .map((entry) => entry.path);
  const catalogFolders = await globalCatalog.listFolders();
  if (!catalogFolders.ok) return catalogFolders;
  for (const catalogFolder of catalogFolders.value) {
    if (!isWithinRoot(catalogFolder.currentPath, discovery.value.root)) continue;
    if (visitedFolderPaths.has(catalogFolder.currentPath)) continue;
    if (discoveryFailedFolders.some((failed) => isWithinRoot(catalogFolder.currentPath, failed))) continue;
    const stillOnDisk = await deps.fs.exists(catalogFolder.currentPath);
    if (!stillOnDisk.ok) return stillOnDisk;
    if (!stillOnDisk.value) continue;
    const reconciled = await globalCatalog.reconcileFolder({
      folderId: catalogFolder.folderId,
      presentFingerprints: [],
      fingerprintsPresentElsewhere: presentAcrossRun,
      markMissing: true,
      now: now().getTime(),
    });
    if (!reconciled.ok) return reconciled;
  }

  for (const folderId of snapshotRefreshFolderIds) {
    const folder = await globalCatalog.getFolder(folderId);
    if (!folder.ok) return folder;
    if (folder.value === null) continue;
    const onDisk = await deps.fs.exists(folder.value.currentPath);
    if (!onDisk.ok) return onDisk;
    if (!onDisk.value) continue;
    const refreshed = await refreshFolderSnapshot(deps, globalCatalog, state, folder.value, progress);
    if (!refreshed.ok) return refreshed;
  }

  const faces = await runDriveFacesPass(deps, state, input, globalCatalog, progress);
  if (!faces.ok) return faces;

  state.run.finishedAt = now().toISOString();
  const persisted = await persistRun(deps, state, now);
  if (!persisted.ok) return persisted;
  const flushedRun = await globalCatalog.flush();
  if (!flushedRun.ok) return flushedRun;
  return reportSummary(deps, state, progress, now);
};

// The --gemini-batch flag wins over every scope, exactly like an explicit provider override;
// without it each folder answers for itself, so a folder key can opt in or out of the run's mode.
const resolveBatchFolders = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  folders: readonly CatalogFolderDiscovery[],
): Promise<Result<Set<string>, AppError>> => {
  if (input.geminiBatchExplicit === true) {
    return ok(input.geminiBatch === true ? new Set(folders.map((folder) => folder.path)) : new Set());
  }
  const enabled = new Set<string>();
  for (const folder of folders) {
    const stored = await resolveConfigValues(deps.config, folder.path);
    if (!stored.ok) return stored;
    if (stored.value.effective.gemini_batch_mode === 'true') enabled.add(folder.path);
  }
  return ok(enabled);
};

const driveUsesPricedGemini = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  folders: readonly CatalogFolderDiscovery[],
): Promise<Result<boolean, AppError>> => {
  for (const folder of folders) {
    const resolved = await resolveProcessOptions(deps.config, folder.path, processInput(input, folder.path, 1, 1));
    if (!resolved.ok) return resolved;
    const provider = resolved.value.analyzer.provider;
    if (provider.family === 'gemini-native' && geminiModelPrice(provider.model, 0) !== null) return ok(true);
  }
  return ok(false);
};

const resolveBatchPlan = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  root: string,
): Promise<Result<DriveBatchPlan | null, AppError>> => {
  const resolved = await resolveProcessOptions(deps.config, root, processInput(input, root, 1, 1));
  if (!resolved.ok) return resolved;
  const provider = resolved.value.analyzer.provider;
  if (provider.family !== 'gemini-native') {
    return {
      ok: false,
      error: appError(
        'invalid_config_value',
        `Batch mode needs the gemini-native analyzer, but ${root} resolves to the ${provider.family} provider `
        + `"${provider.providerId}". Select Gemini or turn batch mode off.`,
      ),
    };
  }
  if (deps.analyzerBatch === undefined) {
    return { ok: false, error: appError('internal', 'Batch analyzer port is required for gemini batch drive runs') };
  }
  return ok({
    analyzerBatch: deps.analyzerBatch,
    provider,
    model: provider.model,
    configIdentity: processConfigIdentity(resolved.value, deps.analyzer.promptVersion(provider)),
    outputLanguage: resolved.value.analyzer.outputLanguage,
    tagLanguage: resolved.value.analyzer.tagLanguage,
    timeoutSeconds: resolved.value.analyzer.timeoutSeconds,
    reattachedRequests: null,
  });
};

interface ResumableBatchRun {
  adopted: DriveRunRecord | null;
  orphanJobNames: string[];
}

const liveBatch = (run: DriveRunRecord): DriveRunBatchState | null =>
  run.batch !== null && run.batch.state !== 'completed' && run.batch.state !== 'failed' ? run.batch : null;

// The newest unfinished run for a root is not necessarily the one holding a paid-for job: an
// interactive run over the same root can be interrupted after it, and resubmitting because that
// one carries no batch state would buy the same job twice. Adopting more than one job in a single
// run is not a thing this loop can do, so the jobs left behind are named rather than adopted.
const resumableBatchRun = async (
  globalCatalog: GlobalCatalogStore,
  root: string,
): Promise<Result<ResumableBatchRun, AppError>> => {
  const unfinished = await globalCatalog.unfinishedDriveRuns(root);
  if (!unfinished.ok) return unfinished;
  const live = unfinished.value.filter((run) => liveBatch(run) !== null);
  const [adopted, ...orphans] = live;
  return ok({
    adopted: adopted ?? null,
    orphanJobNames: orphans.map((run) => run.batch?.jobName ?? run.batch?.displayName ?? run.runId),
  });
};

// Every request in the job is built from the plan's own provider, language and timeout, so a
// folder that resolves any of them differently would be answered with the root's settings.
const folderTakesBatch = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  folder: string,
  plan: DriveBatchPlan,
): Promise<Result<boolean, AppError>> => {
  const resolved = await resolveProcessOptions(deps.config, folder, processInput(input, folder, 1, 1));
  if (!resolved.ok) return resolved;
  const analyzer = resolved.value.analyzer;
  return ok(
    analyzer.provider.family === 'gemini-native'
    && batchConfigKey(analyzer.provider, analyzer.outputLanguage, analyzer.tagLanguage, analyzer.timeoutSeconds)
      === batchConfigKey(plan.provider, plan.outputLanguage, plan.tagLanguage, plan.timeoutSeconds),
  );
};

const batchConfigKey = (
  provider: AnalyzerProviderConfig,
  outputLanguage: AppConfig['output_language'],
  tagLanguage: AppConfig['tag_language'],
  timeoutSeconds: number,
): string =>
  JSON.stringify([
    Object.entries(provider).sort(([left], [right]) => left.localeCompare(right)),
    outputLanguage,
    tagLanguage,
    timeoutSeconds,
  ]);

const resolvedBatchIdentity = (
  plan: DriveBatchPlan,
  persisted: DriveRunBatchState | null | undefined,
): ProcessConfigIdentity => {
  if (persisted?.configIdentity !== undefined) return persisted.configIdentity;
  const model = persisted?.model ?? plan.model;
  if (model === plan.model) return plan.configIdentity;
  const descriptor = configDescriptorSchema.parse({ ...plan.configIdentity.descriptor, model });
  return { descriptor, configId: configId(descriptor) };
};

const enrolInBatch = async (
  plan: DriveBatchPlan,
  videoPath: string,
  key: string,
  signal: AbortSignal | undefined,
): Promise<Result<AnalyzerBatchRequest | null, AppError>> => {
  const persisted = plan.reattachedRequests?.get(videoPath);
  if (plan.reattachedRequests !== null) {
    return ok(persisted === undefined
      ? null
      : { ...persisted, outputLanguage: plan.outputLanguage, tagLanguage: plan.tagLanguage });
  }
  return plan.analyzerBatch.uploadForBatch({
    key,
    videoPath,
    outputLanguage: plan.outputLanguage,
    tagLanguage: plan.tagLanguage,
    provider: plan.provider,
    timeoutSeconds: plan.timeoutSeconds,
    ...(signal === undefined ? {} : { signal }),
  });
};

interface BatchPassInput {
  deps: ProcessDeps;
  globalCatalog: GlobalCatalogStore;
  input: ProcessDriveInput;
  state: MutableRunState;
  plan: DriveBatchPlan;
  requests: readonly AnalyzerBatchRequest[];
  deferred: readonly DeferredFolder[];
  progress: JobExecutionContext | undefined;
  options: DriveRunOptions;
  now: () => Date;
  budget: number | null;
}

// Every file of the adopted job is already in the index, so its answers would only duplicate rows
// this run cannot use: the job is dropped rather than polled, and the uploads it still holds are
// released instead of waiting out their 48 h TTL.
const dropAdoptedBatch = async (
  plan: DriveBatchPlan,
  state: MutableRunState,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const batch = state.run.batch;
  if (batch === null || batch === undefined) return ok(undefined);
  state.run.batch = null;
  const released = await plan.analyzerBatch.releaseBatchUploads({
    provider: plan.provider,
    fileNames: batch.requests.map((request) => request.fileName),
  });
  const retained = released.ok ? released.value.retained : batch.requests.length;
  if (retained === 0) return ok(undefined);
  return report(progress, 'batch_uploads_retained', { jobName: batch.jobName, retained });
};

const runBatchPass = async (pass: BatchPassInput): Promise<Result<void, AppError>> => {
  const { deps, state, plan, progress, now } = pass;
  const persistedBatch = state.run.batch;
  const displayName = persistedBatch?.displayName ?? driveRunBatchDisplayName(state.run.runId);
  const requests = persistedBatch === null || persistedBatch === undefined
    ? pass.requests.map((request) => ({
      key: request.key,
      videoPath: request.videoPath,
      fileName: request.fileName,
      fileUri: request.fileUri,
    }))
    : persistedBatch.requests;
  // A persisted state names the model its own submit was made with, and the job that submit may
  // already have created is findable by display name, so a configuration that moved since never
  // overwrites it.
  const persistedModel = persistedBatch?.model ?? null;
  const configIdentity = resolvedBatchIdentity(plan, persistedBatch);
  state.run.batch = {
    displayName,
    jobName: persistedBatch?.jobName ?? null,
    state: persistedBatch?.jobName == null ? 'preparing' : 'submitted',
    model: persistedModel ?? plan.model,
    configIdentity,
    requests,
  };
  const beforeSubmit = await persistBatchIdentity(deps, pass.globalCatalog, state, now);
  if (!beforeSubmit.ok) return beforeSubmit;

  const job = persistedBatch?.jobName == null
    ? await ensureBatchJob({
      analyzerBatch: plan.analyzerBatch,
      provider: plan.provider,
      displayName,
      requests: pass.requests,
      submittedBefore: persistedBatch !== null && persistedBatch !== undefined,
      ...(progress === undefined ? {} : { signal: progress.signal }),
    })
    : ok({ jobName: persistedBatch.jobName, reattached: true });
  if (!job.ok) {
    if (isBatchSubmitRejection(job.error)) state.run.batch = null;
    const persistedFailure = await persistBatchIdentity(deps, pass.globalCatalog, state, now);
    if (!persistedFailure.ok) return persistedFailure;
    return job;
  }
  // Every answer in a submitted job was bought from the model it was submitted with, so the run
  // that re-attaches records them under that model however the configuration has moved since.
  const jobModel = job.value.reattached ? persistedModel : null;
  const model = jobModel ?? plan.model;
  if (jobModel !== null && jobModel !== plan.model) {
    const modelReported = await report(progress, 'batch_model_changed', {
      jobName: job.value.jobName,
      jobModel,
      resolvedModel: plan.model,
    });
    if (!modelReported.ok) return modelReported;
  }
  state.run.batch = { displayName, jobName: job.value.jobName, state: 'submitted', model, configIdentity, requests };
  const afterSubmit = await persistBatchIdentity(deps, pass.globalCatalog, state, now);
  if (!afterSubmit.ok) return afterSubmit;
  const submitReported = await report(progress, 'batch_submitted', {
    jobName: job.value.jobName,
    requestCount: requests.length,
    model,
    reattached: job.value.reattached,
  });
  if (!submitReported.ok) return submitReported;

  const status = await awaitBatchResults({
    analyzerBatch: plan.analyzerBatch,
    provider: plan.provider,
    jobName: job.value.jobName,
    model,
    requestKeys: requests.map((request) => request.key),
    progress,
    sleep: pass.options.sleep ?? sleep,
    ...(pass.options.batchPollDelayMs === undefined ? {} : { pollDelayMs: pass.options.batchPollDelayMs }),
  });
  if (!status.ok) return status;

  if (status.value.state === 'failed' || status.value.state === 'cancelled') {
    state.run.batch = null;
    const cleared = await persistBatchIdentity(deps, pass.globalCatalog, state, now);
    if (!cleared.ok) return cleared;
    const summarised = await reportSummary(deps, state, progress, now);
    if (!summarised.ok) return summarised;
    return { ok: false, error: batchJobFailureError(job.value.jobName, status.value) };
  }

  const outcomes = new Map((status.value.results ?? []).map((result) => [result.key, result.outcome]));
  const expired = status.value.state === 'expired';
  const completedReported = await report(progress, 'batch_completed', {
    jobName: job.value.jobName,
    state: status.value.state,
    succeeded: [...outcomes.values()].filter((outcome) => outcome.ok).length,
    failed: [...outcomes.values()].filter((outcome) => !outcome.ok).length,
  });
  if (!completedReported.ok) return completedReported;

  for (const folder of pass.deferred) {
    for (const pending of folder.pending) {
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      const outcome = expired
        ? { ok: false as const, error: expiredBatchFileError(job.value.jobName) }
        : outcomes.get(pending.key)
          ?? { ok: false as const, error: appError('provider_error', 'Gemini batch job returned no response for this file') };
      const completed = outcome.ok
        ? await processVideoPipeline(
          pass.deps,
          {
            ...processInput(pass.input, pending.video.path, pending.fileIndex, state.filesTotal, state.run.runId),
            precomputedAnalysis: { analysis: outcome.value, pricingMode: 'batch', model, configIdentity },
          },
          progress,
        )
        : outcome;
      if (!completed.ok) {
        const recorded = await recordFileFailure(deps, state, folder.counts, pending.video.path, completed.error, now);
        if (!recorded.ok) return recorded;
        const budgetPause = await pauseForBudget(deps, state, progress, now, pass.budget);
        if (!budgetPause.ok) return budgetPause;
        continue;
      }
      if (completed.value.snapshotSkipped === true) state.snapshotSkipped += 1;
      state.run.filesDone += 1;
      folder.counts.filesDone += 1;
      const budgetPause = await pauseForBudget(deps, state, progress, now, pass.budget);
      if (!budgetPause.ok) return budgetPause;
    }
    const closed = await closeFolder(deps, pass.globalCatalog, state, folder.path, folder.counts, progress, now);
    if (!closed.ok) return closed;
  }

  if (!expired) {
    // Best effort: an upload the API kept is a quota leak, not a reason to fail a paid-for run.
    const released = await plan.analyzerBatch.releaseBatchUploads({
      provider: plan.provider,
      fileNames: requests.map((request) => request.fileName),
    });
    const retained = released.ok ? released.value.retained : requests.length;
    if (retained > 0) {
      const warned = await report(progress, 'batch_uploads_retained', { jobName: job.value.jobName, retained });
      if (!warned.ok) return warned;
    }
  }
  state.run.batch = expired
    ? null
    : { displayName, jobName: job.value.jobName, state: 'completed', model, configIdentity, requests };
  return persistBatchIdentity(deps, pass.globalCatalog, state, now);
};

// The sql.js store keeps writes in memory until a flush, so a run killed while it waits
// for a batch job would come back with no job to re-attach to and pay for a second one.
const persistBatchIdentity = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  state: MutableRunState,
  now: () => Date,
): Promise<Result<void, AppError>> => {
  const persisted = await persistRun(deps, state, now);
  if (!persisted.ok) return persisted;
  return globalCatalog.flush();
};

const refreshFolderSnapshot = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  state: MutableRunState,
  folder: CatalogFolder,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const snapshot = await exportFolderSnapshot({ globalCatalog, fs: deps.fs }, folder);
  if (snapshot.ok) return ok(undefined);
  if (!isReadOnlyWriteError(snapshot.error)) return snapshot;
  state.snapshotSkipped += 1;
  return report(progress, 'catalog_snapshot_skipped', {
    folder: folder.currentPath,
    reason: 'folder_read_only',
  });
};

const runDriveFacesPass = async (
  deps: ProcessDeps,
  state: MutableRunState,
  input: ProcessDriveInput,
  globalCatalog: GlobalCatalogStore,
  progress: JobExecutionContext | undefined,
): Promise<Result<void, AppError>> => {
  const root = state.run.root;
  const enabled = await facesEnabled(deps, root);
  if (!enabled.ok) return enabled;
  if (!enabled.value) return ok(undefined);

  if (input.skipFaces === true) return skipFacesPass(state, progress, root, 'flag', null);
  if (deps.faceEngine === undefined || deps.downloads === undefined) {
    return skipFacesPass(state, progress, root, 'unavailable', null);
  }
  if (isProgressAborted(progress)) return skipFacesPass(state, progress, root, 'cancelled', null);

  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return skipFacesPass(state, progress, root, 'failed', artifactsReady.error);
  if (!artifactsReady.value) return skipFacesPass(state, progress, root, 'artifacts_missing', null);

  const facesDeps: FacesIndexDeps = {
    config: deps.config,
    downloads: deps.downloads,
    faceEngine: deps.faceEngine,
    fs: deps.fs,
    globalCatalog,
    media: deps.media,
  };
  const pass = await runFacesIndexPass(facesDeps, { root }, progress);
  if (!pass.ok) {
    const reason = isProgressAborted(progress) ? 'cancelled' : 'failed';
    return skipFacesPass(state, progress, root, reason, pass.error);
  }

  state.faces = {
    ran: true,
    skippedReason: null,
    filesIndexed: pass.value.filesIndexed,
    observationsAdded: pass.value.observationsAdded,
    peopleCreated: pass.value.peopleCreated,
    filesFailed: pass.value.filesFailed,
    failureCodes: aggregateFailureCodes(pass.value.failures),
    aborted: pass.value.aborted,
    error: null,
  };
  return ok(undefined);
};

const aggregateFailureCodes = (failures: readonly { code: AppError['code'] }[]): { code: AppError['code']; count: number }[] => {
  const counts = new Map<AppError['code'], number>();
  for (const failure of failures) counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
};

const skipFacesPass = async (
  state: MutableRunState,
  progress: JobExecutionContext | undefined,
  root: string,
  reason: DriveRunFacesSkipReason,
  error: AppError | null,
): Promise<Result<void, AppError>> => {
  state.faces = {
    ran: false,
    skippedReason: reason,
    filesIndexed: 0,
    observationsAdded: 0,
    peopleCreated: 0,
    filesFailed: 0,
    failureCodes: [],
    aborted: false,
    error: error === null ? null : { code: error.code, message: error.message },
  };
  return report(progress, 'faces_pass_skipped', {
    root,
    reason,
    ...(error === null ? {} : { message: error.message }),
  });
};

const closeFolder = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  state: MutableRunState,
  folderPath: string,
  counts: FolderRunCounts,
  progress: JobExecutionContext | undefined,
  now: () => Date,
): Promise<Result<void, AppError>> => {
  state.run.foldersDone += 1;
  const persisted = await persistRun(deps, state, now);
  if (!persisted.ok) return persisted;
  const flushed = await globalCatalog.flush();
  if (!flushed.ok) return flushed;
  return reportFolderDone(progress, folderPath, counts);
};

const recordFileFailure = async (
  deps: ProcessDeps,
  state: MutableRunState,
  counts: FolderRunCounts,
  videoPath: string,
  error: AppError,
  now: () => Date,
): Promise<Result<void, AppError>> => {
  state.run.filesFailed += 1;
  counts.filesFailed += 1;
  state.failures.push(failureRecord(videoPath, 'file', error));
  return persistRun(deps, state, now);
};

const abortedRun = async (
  deps: ProcessDeps,
  state: MutableRunState,
  progress: JobExecutionContext | undefined,
  now: () => Date,
): Promise<Result<never, AppError>> => {
  const aborted = await reportSummary(deps, state, progress, now);
  if (!aborted.ok) return aborted;
  return {
    ok: false,
    error: appError(
      'drive_run_aborted',
      `Aborted drive run after ${maxConsecutiveFailures} consecutive file failures. Re-run the same root to resume.`,
      { runId: state.run.runId, failures: state.failures },
    ),
  };
};

const geminiMonthlyBudget = async (deps: ProcessDeps): Promise<Result<number | null, AppError>> => {
  const resolved = await resolveConfigValues(deps.config);
  if (!resolved.ok) return resolved;
  const parsed = configValueSchema.shape.gemini_monthly_budget_usd.safeParse(
    resolved.value.effective.gemini_monthly_budget_usd,
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: appError('invalid_config_value', 'gemini_monthly_budget_usd does not match the config schema'),
    };
  }
  return ok(parsed.data);
};

const pauseForBudget = async (
  deps: ProcessDeps,
  state: MutableRunState,
  progress: JobExecutionContext | undefined,
  now: () => Date,
  budgetUsd: number | null,
): Promise<Result<void, AppError>> => {
  if (budgetUsd === null) return ok(undefined);
  if (deps.spendLedger === undefined || deps.globalCatalog === undefined) {
    return { ok: false, error: appError('internal', 'Spend ledger dependencies are required for a Gemini budget cap') };
  }
  const month = spendMonth(now());
  const spend = await deps.spendLedger.total({ provider: 'gemini', month });
  if (!spend.ok) return spend;
  if (spend.value.estimatedCostUsd < budgetUsd) return ok(undefined);
  const persisted = await persistRun(deps, state, now);
  if (!persisted.ok) return persisted;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  const reported = await report(progress, 'budget_cap_reached', {
    provider: 'gemini',
    month,
    budgetUsd,
    estimatedSpendUsd: spend.value.estimatedCostUsd,
    estimated: true,
    runId: state.run.runId,
  });
  if (!reported.ok) return reported;
  const summary = await reportSummary(deps, state, progress, now);
  if (!summary.ok) return summary;
  return {
    ok: false,
    error: appError(
      'drive_run_aborted',
      `Paused drive run because the local Gemini cost estimate for ${month} is $${spend.value.estimatedCostUsd.toFixed(4)} `
      + `against the $${budgetUsd.toFixed(2)} budget. Raise or unset gemini_monthly_budget_usd and re-run the same root to resume.`,
      {
        runId: state.run.runId,
        month,
        budgetUsd,
        estimatedSpendUsd: spend.value.estimatedCostUsd,
      },
    ),
  };
};

const walkCatalogTree = async (
  fs: FileSystemPort,
  folder: string,
  catalogFolders: CatalogFolderDiscovery[],
  failures: DriveRunFailure[],
): Promise<void> => {
  const listed = await fs.listDirectory(folder);
  if (!listed.ok) {
    failures.push(failureRecord(folder, 'folder', listed.error));
    return;
  }
  const entries = listed.value.sort((left, right) => left.path.localeCompare(right.path));
  const videoPaths = entries
    .filter((entry) => entry.kind === 'file' && isSupportedVideoExtension(fs.extname(entry.name)))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
  if (videoPaths.length > 0) catalogFolders.push({ path: folder, videoPaths });

  for (const entry of entries) {
    if (entry.kind !== 'directory' || shouldSkipDirectory(entry.name)) continue;
    await walkCatalogTree(fs, entry.path, catalogFolders, failures);
  }
};

const runDriveFile = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  videoPath: string,
  current: number,
  total: number,
  runId: string,
  skipped: boolean,
  progress: JobExecutionContext | undefined,
  options: DriveRunOptions,
): Promise<Result<{ snapshotSkipped: boolean }, AppError>> => {
  if (skipped) {
    const result = await processVideoPipeline(deps, processInput(input, videoPath, current, total, runId), progress);
    return result.ok ? ok({ snapshotSkipped: result.value.snapshotSkipped === true }) : result;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    const result = await processVideoPipeline(deps, processInput(input, videoPath, current, total, runId), progress);
    if (result.ok) return ok({ snapshotSkipped: result.value.snapshotSkipped === true });
    if (!isRetryable(result.error) || attempt === maxRetries) return result;
    const delay = backoffDelayMs(attempt, options);
    await (options.sleep ?? sleep)(delay);
    attempt += 1;
  }
  return { ok: false, error: appError('internal', 'Drive file retry loop ended unexpectedly') };
};

const processInput = (
  input: ProcessDriveInput,
  videoPath: string,
  current: number,
  total: number,
  runId?: string,
): ProcessPipelineInput => ({
  videoPath,
  frames: input.frames,
  ...(input.framesExplicit === undefined ? {} : { framesExplicit: input.framesExplicit }),
  skipRename: input.skipRename,
  ...(input.skipRenameExplicit === undefined ? {} : { skipRenameExplicit: input.skipRenameExplicit }),
  verbose: input.verbose,
  timeout: input.timeout,
  ...(input.timeoutExplicit === undefined ? {} : { timeoutExplicit: input.timeoutExplicit }),
  whisper: input.whisper,
  ...(input.whisperExplicit === undefined ? {} : { whisperExplicit: input.whisperExplicit }),
  whisperModel: input.whisperModel,
  ...(input.whisperModelExplicit === undefined ? {} : { whisperModelExplicit: input.whisperModelExplicit }),
  ...(input.whisperLanguage === undefined ? {} : { whisperLanguage: input.whisperLanguage }),
  ...(input.whisperLanguageExplicit === undefined ? {} : { whisperLanguageExplicit: input.whisperLanguageExplicit }),
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.provider === undefined ? {} : { provider: input.provider }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
  batch: { current, total, ...(runId === undefined ? {} : { runId }) },
});

const relocateResumedFile = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  folderPath: string,
  video: ScanVideo,
): Promise<Result<readonly string[], AppError>> => {
  if (video.contentHash === null) return ok([]);
  const marker = await readFolderMarker(deps.fs, folderPath);
  if (!marker.ok) return marker;
  if (marker.value === null) return ok([]);
  const existing = await globalCatalog.getFile(video.contentHash);
  if (!existing.ok) return existing;
  if (existing.value === null) return ok([]);
  const fileName = deps.fs.basename(video.path);
  if (existing.value.folderId === marker.value.folderId && existing.value.fileName === fileName) return ok([]);

  const recordedFolder = await globalCatalog.getFolder(existing.value.folderId);
  if (!recordedFolder.ok) return recordedFolder;
  const recordedPresent = await recordedLocationExists(deps, globalCatalog, recordedFolder.value, existing.value);
  if (!recordedPresent.ok) return recordedPresent;
  const currentFolder = await globalCatalog.getFolder(marker.value.folderId);
  if (!currentFolder.ok) return currentFolder;

  if (!shouldRelocateCanonical(currentFolder.value, recordedFolder.value, recordedPresent.value)) {
    return ok([]);
  }

  const relocated = await globalCatalog.relocateFile(video.contentHash, marker.value.folderId, fileName);
  if (!relocated.ok) return relocated;
  return ok([...new Set([existing.value.folderId, marker.value.folderId])]);
};

export const shouldRelocateCanonical = (
  current: CatalogFolder | null,
  recorded: CatalogFolder | null,
  recordedPresent: boolean,
): boolean => {
  if (recorded === null) return true;
  if (!recordedPresent) return true;
  return current !== null && current.firstSeenAt < recorded.firstSeenAt;
};

const recordedLocationExists = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  folder: CatalogFolder | null,
  file: CatalogFile,
): Promise<Result<boolean, AppError>> => {
  if (folder === null) return ok(false);
  const analysis = await globalCatalog.getAnalysis(file.fingerprint);
  if (!analysis.ok) return analysis;
  const names = [file.fileName, analysis.value?.finalName ?? null].filter((name): name is string => name !== null);
  for (const name of names) {
    const candidate = deps.fs.join(folder.currentPath, name);
    const exists = await deps.fs.exists(candidate);
    if (!exists.ok) return exists;
    if (!exists.value) continue;
    const stats = await deps.fs.stat(candidate);
    if (!stats.ok) return stats;
    if (stats.value.size === file.size) return ok(true);
  }
  return ok(false);
};

const isWithinRoot = (candidate: string, root: string): boolean => {
  const normalizedRoot = root.replace(/[/\\]+$/, '');
  return candidate === normalizedRoot
    || candidate.startsWith(`${normalizedRoot}/`)
    || candidate.startsWith(`${normalizedRoot}\\`);
};

const alreadyProcessed = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  video: ScanVideo,
  configIdentity: ProcessConfigIdentity | null,
): Promise<Result<boolean, AppError>> => {
  if (input.force === true || deps.globalCatalog === undefined || video.contentHash === null) return ok(false);
  const folder = deps.fs.dirname(video.path);
  const resolved = await resolveProcessOptions(deps.config, folder, processInput(input, video.path, 1, 1));
  if (!resolved.ok) return resolved;
  const identity = configIdentity ?? processConfigIdentity(
    resolved.value,
    deps.analyzer.promptVersion(resolved.value.analyzer.provider),
  );
  const variant = await deps.globalCatalog.getVariant(video.contentHash, identity.configId);
  if (!variant.ok) return variant;
  if (variant.value === null) return ok(false);
  return analyzedCanonicalIsReachable({ fs: deps.fs, globalCatalog: deps.globalCatalog }, video.contentHash);
};

const persistRun = async (
  deps: ProcessDeps,
  state: MutableRunState,
  now: () => Date,
): Promise<Result<void, AppError>> => {
  if (deps.globalCatalog === undefined) {
    return { ok: false, error: appError('internal', 'Global catalog is required for drive processing') };
  }
  state.run.lastActivityAt = now().toISOString();
  return deps.globalCatalog.updateDriveRun(state.run);
};

const reportFolderDone = (
  progress: JobExecutionContext | undefined,
  folderPath: string,
  counts: FolderRunCounts,
): Promise<Result<void, AppError>> =>
  report(progress, 'folder-done', {
    path: folderPath,
    filesDone: counts.filesDone,
    filesSkipped: counts.filesSkipped,
    filesDuplicateSkipped: counts.filesDuplicateSkipped,
    filesFailed: counts.filesFailed,
  });

const reportSummary = async (
  deps: ProcessDeps,
  state: MutableRunState,
  progress: JobExecutionContext | undefined,
  now: () => Date,
): Promise<Result<DriveRunSummary, AppError>> => {
  if (deps.globalCatalog === undefined) {
    return { ok: false, error: appError('internal', 'Global catalog is required for drive processing') };
  }
  const spend = deps.spendLedger === undefined
    ? ok({ entries: 0, estimatedCostUsd: 0 })
    : await deps.spendLedger.total({ provider: 'gemini', runId: state.run.runId });
  if (!spend.ok) return spend;
  const summary = summaryFromState(state, now, spend.value);
  const reported = await report(progress, 'run-summary', {
    runId: summary.runId,
    root: summary.root,
    foldersTotal: summary.foldersTotal,
    foldersDone: summary.foldersDone,
    filesTotal: summary.filesTotal,
    filesDone: summary.filesDone,
    filesSkipped: summary.filesSkipped,
    filesDuplicateSkipped: summary.filesDuplicateSkipped,
    filesFailed: summary.filesFailed,
    ...(summary.costEstimate === undefined ? {} : { costEstimate: summary.costEstimate }),
    ...(summary.faces === undefined ? {} : { faces: summary.faces }),
    snapshotSkipped: summary.snapshotSkipped,
    elapsedMs: summary.elapsedMs,
    failures: summary.failures,
  });
  if (!reported.ok) return reported;
  return ok(summary);
};

const summaryFromState = (
  state: MutableRunState,
  now: () => Date,
  spend: { entries: number; estimatedCostUsd: number },
): DriveRunSummary => ({
  runId: state.run.runId,
  root: state.run.root,
  startedAt: state.run.startedAt,
  finishedAt: state.run.finishedAt,
  foldersTotal: state.run.foldersTotal,
  foldersDone: state.run.foldersDone,
  filesTotal: state.filesTotal,
  filesDone: state.run.filesDone,
  filesSkipped: state.run.filesSkipped,
  filesDuplicateSkipped: state.filesDuplicateSkipped,
  filesFailed: state.run.filesFailed,
  ...(spend.entries === 0 ? {} : {
    costEstimate: {
      kind: 'estimate',
      currency: 'USD',
      files: spend.entries,
      estimatedCostUsd: spend.estimatedCostUsd,
    },
  }),
  ...(state.faces === null ? {} : { faces: state.faces }),
  snapshotSkipped: state.snapshotSkipped,
  elapsedMs: Math.max(0, now().getTime() - state.startedMs),
  failures: state.failures,
});

const failureRecord = (path: string, scope: DriveRunFailure['scope'], error: AppError): DriveRunFailure => ({
  path,
  scope,
  code: error.code,
  message: error.message,
});

const isRetryable = (error: AppError): boolean =>
  error.code === 'provider_error' || error.code === 'rate_limited' || error.code === 'ollama_unavailable';

const backoffDelayMs = (attempt: number, options: DriveRunOptions): number => {
  const base = 5000 * Math.pow(2, attempt);
  return base + (options.jitter ?? (() => Math.floor(Math.random() * 1000)))(attempt);
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isProgressAborted = (progress: JobExecutionContext | undefined): boolean => progress?.signal.aborted === true;

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (isProgressAborted(progress)) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};
