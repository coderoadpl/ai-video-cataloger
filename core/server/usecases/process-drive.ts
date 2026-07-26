import { randomUUID } from 'node:crypto';

import {
  appError,
  ok,
  type AnalyzerProviderId,
  type AppConfig,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type DriveRunRecord,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type ProcessJobStep,
} from '../ports.js';
import type { ProcessDeps, ProcessPipelineInput } from './process.js';
import { hasProcessedAnalysis, reconcileFolderPresence, resolveFolderIntoIndex } from './catalog-index.js';
import { exportFolderSnapshot } from './catalog-snapshot.js';
import { readFolderMarker } from './folder-identity.js';
import { processVideoPipeline } from './process.js';
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
  const state: MutableRunState = {
    run: {
      runId: options.runId ?? randomUUID(),
      root: discovery.value.root,
      startedAt: started.toISOString(),
      finishedAt: null,
      foldersTotal: discovery.value.folders.length,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: started.toISOString(),
      batch: null,
    },
    filesTotal: discovery.value.filesTotal,
    snapshotSkipped: 0,
    failures: [...discovery.value.failures],
    startedMs: started.getTime(),
  };

  const startedRun = await deps.globalCatalog.startDriveRun(state.run);
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
      state.run.filesFailed += 1;
      folderCounts.filesFailed += 1;
      state.failures.push(failureRecord(video.path, 'file', result.error));
      const persisted = await persistRun(deps, state, now);
      if (!persisted.ok) return persisted;
      if (consecutiveFailures >= maxConsecutiveFailures) {
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
      }
    }

    const presentFingerprints = scan.value.videos
      .map((video) => video.contentHash)
      .filter((hash): hash is string => hash !== null);
    const hashUnavailable = scan.value.videos.some((video) => video.contentHash === null);
    folderPresences.push({ folderPath: folder.path, presentFingerprints, hashUnavailable });

    state.run.foldersDone += 1;
    const persisted = await persistRun(deps, state, now);
    if (!persisted.ok) return persisted;
    const flushedFolder = await globalCatalog.flush();
    if (!flushedFolder.ok) return flushedFolder;
    const done = await reportFolderDone(progress, folder.path, folderCounts);
    if (!done.ok) return done;
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
    const snapshot = await exportFolderSnapshot({ globalCatalog, fs: deps.fs }, folder.value);
    if (!snapshot.ok) return snapshot;
  }

  state.run.finishedAt = now().toISOString();
  const persisted = await persistRun(deps, state, now);
  if (!persisted.ok) return persisted;
  const flushedRun = await globalCatalog.flush();
  if (!flushedRun.ok) return flushedRun;
  return reportSummary(deps, state, progress, now);
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

const report = (
  progress: JobExecutionContext | undefined,
  step: ProcessJobStep,
  data: Record<string, unknown>,
): Promise<Result<void, AppError>> => {
  if (progress === undefined) return Promise.resolve(ok(undefined));
  return progress.reportProgress({ step, data });
};

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress?.signal.aborted === true) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};
