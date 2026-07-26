import { randomUUID } from 'node:crypto';

import {
  appError,
  driveRunBatchDisplayName,
  isBatchSubmitRejection,
  ok,
  type AnalyzerProviderConfig,
  type AnalyzerProviderId,
  type AppConfig,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type DriveRunBatchRequest,
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
import type { ProcessDeps, ProcessPipelineInput } from './process.js';
import { hasProcessedAnalysis, reconcileFolderPresence, resolveFolderIntoIndex } from './catalog-index.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { isReadOnlyWriteError, readFolderMarker } from './folder-identity.js';
import { processVideoPipeline, resolveProcessOptions } from './process.js';
import {
  awaitBatchResults,
  batchJobFailureError,
  ensureBatchJob,
  expiredBatchFileError,
  reportStep as report,
} from './process-drive-batch.js';
import { resolveConfigValues } from './config-resolution.js';
import { scanFolder, type ScanVideo } from './scan.js';
import { isSupportedVideoExtension } from './shared.js';

const excludedDirectoryNames = new Set([
  '.ai-video-cataloger',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.TemporaryItems',
  'System Volume Information',
]);

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
  analyzer?: AppConfig['analyzer_backend'] | 'api' | undefined;
  provider?: AnalyzerProviderId | undefined;
  localModel?: string | undefined;
  force?: boolean | undefined;
  geminiBatch?: boolean | undefined;
  geminiBatchExplicit?: boolean | undefined;
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
  filesFailed: number;
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
  outputLanguage: AppConfig['output_language'];
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
  counts: { filesDone: number; filesSkipped: number; filesFailed: number };
  pending: PendingBatchFile[];
}

interface MutableRunState {
  run: DriveRunRecord;
  filesTotal: number;
  snapshotSkipped: number;
  failures: DriveRunFailure[];
  startedMs: number;
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
  const resumable = batchPlan.value === null
    ? ok(null)
    : await resumableBatchRun(globalCatalog, discovery.value.root);
  if (!resumable.ok) return resumable;
  const adopted = resumable.value;
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
    snapshotSkipped: 0,
    failures: [...discovery.value.failures],
    startedMs: started.getTime(),
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
        filesFailed: 1,
      });
      if (!done.ok) return done;
      continue;
    }

    const folderCounts = { filesDone: 0, filesSkipped: 0, filesFailed: 0 };
    const pendingBatchFiles: PendingBatchFile[] = [];
    const batchesHere = plan === null || !batchFolders.value.has(folder.path)
      ? ok(false)
      : await folderTakesBatch(deps, input, folder.path, plan);
    if (!batchesHere.ok) return batchesHere;
    for (const video of scan.value.videos) {
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      fileIndex += 1;
      const skipped = await alreadyProcessed(deps, input, video);
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
      const result = await runDriveFile(deps, input, video.path, fileIndex, state.filesTotal, skipped.value, progress, options);
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
        continue;
      }

      consecutiveFailures += 1;
      const recorded = await recordFileFailure(deps, state, folderCounts, video.path, result.error, now);
      if (!recorded.ok) return recorded;
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
    });
    if (!mapped.ok) return mapped;
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
    outputLanguage: resolved.value.analyzer.outputLanguage,
    timeoutSeconds: resolved.value.analyzer.timeoutSeconds,
    reattachedRequests: null,
  });
};

const resumableBatchRun = async (
  globalCatalog: GlobalCatalogStore,
  root: string,
): Promise<Result<DriveRunRecord | null, AppError>> => {
  const latest = await globalCatalog.latestUnfinishedDriveRun(root);
  if (!latest.ok) return latest;
  const run = latest.value;
  if (run === null) return ok(null);
  if (run.batch === null || run.batch.state === 'completed' || run.batch.state === 'failed') return ok(null);
  return ok(run);
};

const folderTakesBatch = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  folder: string,
  plan: DriveBatchPlan,
): Promise<Result<boolean, AppError>> => {
  const resolved = await resolveProcessOptions(deps.config, folder, processInput(input, folder, 1, 1));
  if (!resolved.ok) return resolved;
  const provider = resolved.value.analyzer.provider;
  return ok(provider.family === 'gemini-native' && provider.model === plan.model);
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
      : { ...persisted, outputLanguage: plan.outputLanguage });
  }
  return plan.analyzerBatch.uploadForBatch({
    key,
    videoPath,
    outputLanguage: plan.outputLanguage,
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
}

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
  state.run.batch = {
    displayName,
    jobName: persistedBatch?.jobName ?? null,
    state: persistedBatch?.jobName == null ? 'preparing' : 'submitted',
    model: plan.model,
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
  state.run.batch = { displayName, jobName: job.value.jobName, state: 'submitted', model: plan.model, requests };
  const afterSubmit = await persistBatchIdentity(deps, pass.globalCatalog, state, now);
  if (!afterSubmit.ok) return afterSubmit;
  const submitReported = await report(progress, 'batch_submitted', {
    jobName: job.value.jobName,
    requestCount: requests.length,
    model: plan.model,
    reattached: job.value.reattached,
  });
  if (!submitReported.ok) return submitReported;

  const status = await awaitBatchResults({
    analyzerBatch: plan.analyzerBatch,
    provider: plan.provider,
    jobName: job.value.jobName,
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
            ...processInput(pass.input, pending.video.path, pending.fileIndex, state.filesTotal),
            precomputedAnalysis: { analysis: outcome.value, pricingMode: 'batch' },
          },
          progress,
        )
        : outcome;
      if (!completed.ok) {
        const recorded = await recordFileFailure(deps, state, folder.counts, pending.video.path, completed.error, now);
        if (!recorded.ok) return recorded;
        continue;
      }
      if (completed.value.snapshotSkipped === true) state.snapshotSkipped += 1;
      state.run.filesDone += 1;
      folder.counts.filesDone += 1;
    }
    const closed = await closeFolder(deps, pass.globalCatalog, state, folder.path, folder.counts, progress, now);
    if (!closed.ok) return closed;
  }

  state.run.batch = expired
    ? null
    : { displayName, jobName: job.value.jobName, state: 'completed', model: plan.model, requests };
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

const closeFolder = async (
  deps: ProcessDeps,
  globalCatalog: GlobalCatalogStore,
  state: MutableRunState,
  folderPath: string,
  counts: { filesDone: number; filesSkipped: number; filesFailed: number },
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
  counts: { filesDone: number; filesSkipped: number; filesFailed: number },
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

const shouldSkipDirectory = (name: string): boolean =>
  name.startsWith('.') || excludedDirectoryNames.has(name);

const runDriveFile = async (
  deps: ProcessDeps,
  input: ProcessDriveInput,
  videoPath: string,
  current: number,
  total: number,
  skipped: boolean,
  progress: JobExecutionContext | undefined,
  options: DriveRunOptions,
): Promise<Result<{ snapshotSkipped: boolean }, AppError>> => {
  if (skipped) {
    const result = await processVideoPipeline(deps, processInput(input, videoPath, current, total), progress);
    return result.ok ? ok({ snapshotSkipped: result.value.snapshotSkipped === true }) : result;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    const result = await processVideoPipeline(deps, processInput(input, videoPath, current, total), progress);
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
  ...(input.analyzer === undefined ? {} : { analyzer: input.analyzer }),
  ...(input.provider === undefined ? {} : { provider: input.provider }),
  ...(input.localModel === undefined ? {} : { localModel: input.localModel }),
  ...(input.force === undefined ? {} : { force: input.force }),
  batch: { current, total },
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
): Promise<Result<boolean, AppError>> => {
  if (input.force === true || deps.globalCatalog === undefined || video.contentHash === null) return ok(false);
  return hasProcessedAnalysis({ globalCatalog: deps.globalCatalog, fs: deps.fs }, video.contentHash);
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
  counts: { filesDone: number; filesSkipped: number; filesFailed: number },
): Promise<Result<void, AppError>> =>
  report(progress, 'folder-done', {
    path: folderPath,
    filesDone: counts.filesDone,
    filesSkipped: counts.filesSkipped,
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
  const summary = summaryFromState(state, now);
  const reported = await report(progress, 'run-summary', {
    runId: summary.runId,
    root: summary.root,
    foldersTotal: summary.foldersTotal,
    foldersDone: summary.foldersDone,
    filesTotal: summary.filesTotal,
    filesDone: summary.filesDone,
    filesSkipped: summary.filesSkipped,
    filesFailed: summary.filesFailed,
    snapshotSkipped: summary.snapshotSkipped,
    elapsedMs: summary.elapsedMs,
    failures: summary.failures,
  });
  if (!reported.ok) return reported;
  return ok(summary);
};

const summaryFromState = (state: MutableRunState, now: () => Date): DriveRunSummary => ({
  runId: state.run.runId,
  root: state.run.root,
  startedAt: state.run.startedAt,
  finishedAt: state.run.finishedAt,
  foldersTotal: state.run.foldersTotal,
  foldersDone: state.run.foldersDone,
  filesTotal: state.filesTotal,
  filesDone: state.run.filesDone,
  filesSkipped: state.run.filesSkipped,
  filesFailed: state.run.filesFailed,
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

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress?.signal.aborted === true) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};
