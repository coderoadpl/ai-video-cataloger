import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { JobOutput } from '@core/client/index.js';

import type { BatchProgressView } from '../../components/ui/BatchToolbar.js';
import type { CancelConfirmation } from '../../components/ui/dialogs/CancelConfirmationDialog.js';
import type { BatchResultItem } from '../../components/ui/dialogs/BatchSummaryDialog.js';
import type { DriveSummaryCounts } from '../../components/ui/dialogs/DriveSummaryDialog.js';
import type { ProgressView } from '../../components/ui/ProcessingOverlay.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';
import {
  cancel as cancelJob,
  emptyDriveCounts,
  isPending,
  isTerminalJobStatus,
  job as jobQuery,
  messageOf,
  process as processVideo,
  processDrive as processDriveAction,
  reduceDriveEvent,
  toProgressModel,
  type BatchWaitView,
  type DriveMessage,
  type DriveProgressView,
  type ProcessVideo,
} from './index.web.js';
import { stepLabel } from './step-labels.js';

interface RunOutcome {
  success: boolean;
  error?: string;
  completedPath?: string;
}

const completedVideoPath = (result: JobOutput['result']): string | null =>
  result !== undefined && 'status' in result && result.status === 'completed' && 'path' in result
    ? result.path
    : null;

export interface BatchSummaryState {
  open: boolean;
  results: readonly BatchResultItem[];
}

export interface DriveSummaryState {
  open: boolean;
  counts: DriveSummaryCounts | null;
}

export interface ProcessingState {
  analyzingPath: string | null;
  progress: ProgressView | null;
  isBusy: boolean;
  pendingCount: number;
  erroredCount: number;
  batchProgress: BatchProgressView | null;
  driveProgress: DriveProgressView | null;
  driveFileProgress: BatchProgressView | null;
  driveBatchWait: BatchWaitView | null;
  cancelConfirmation: CancelConfirmation;
  batchSummary: BatchSummaryState;
  driveSummary: DriveSummaryState;
  analyze: (video: ProcessVideo, options?: { force?: boolean }) => void;
  batchAnalyze: () => void;
  driveAnalyze: (root: string) => void;
  driveCancel: () => void;
  requestCancel: () => void;
  requestBatchCancel: () => void;
  confirmCancel: () => void;
  closeCancelDialog: () => void;
  closeBatchSummary: () => void;
  closeDriveSummary: () => void;
}

export interface UseProcessingOptions {
  videos: readonly ProcessVideo[];
  addLine: AddLogLine;
  intervalMs?: number;
  checkReadiness?: (() => Promise<boolean>) | undefined;
  onVideoRenamed?: ((oldPath: string, newPath: string) => void) | undefined;
}

const translateDriveMessage = (dictionary: Dictionary, message: DriveMessage): string => {
  switch (message.kind) {
    case 'runStarted':
      return dictionary.processing.driveRunStarted(message.folders, message.files);
    case 'folderStarted':
      return dictionary.processing.driveFolderStarted(message.path, message.files);
    case 'folderDone':
      return dictionary.processing.driveFolderDone(
        message.path,
        message.filesDone,
        message.filesSkipped,
        message.filesDuplicateSkipped,
        message.filesFailed,
      );
    case 'budgetCapReached':
      return dictionary.processing.driveBudgetCapReached(
        message.month,
        message.estimatedSpendUsd,
        message.budgetUsd,
      );
    case 'fileSkipped':
      return message.reason === 'duplicate'
        ? dictionary.processing.driveDuplicateSkipped(message.filename)
        : dictionary.processing.driveFileSkipped(message.filename);
    case 'snapshotSkipped':
      return dictionary.processing.driveSnapshotSkipped(message.folder);
    case 'runComplete':
      return dictionary.processing.driveRunComplete(
        message.foldersDone,
        message.foldersTotal,
        message.filesDone,
        message.filesSkipped,
        message.filesDuplicateSkipped,
        message.filesFailed,
        message.estimatedCostUsd,
        message.costedFiles,
      );
    case 'batchSubmitted':
      return dictionary.processing.driveBatchSubmitted(message.requestCount, message.reattached);
    case 'batchPoll':
      return dictionary.processing.driveBatchPoll(message.state, message.requestCount);
    case 'batchCompleted':
      return dictionary.processing.driveBatchCompleted(message.succeeded, message.failed);
    case 'batchUploadsRetained':
      return dictionary.processing.driveBatchUploadsRetained(message.retained);
    case 'batchOrphanJobs':
      return dictionary.processing.driveBatchOrphanJobs(message.jobNames);
    case 'batchModelChanged':
      return dictionary.processing.driveBatchModelChanged(message.jobModel, message.resolvedModel);
    case 'fileProgress':
      return dictionary.processing.fileProgressLine(
        message.current,
        message.total,
        stepLabel(dictionary, message.step),
        message.filename,
      );
  }
};

export const useProcessing = ({
  videos,
  addLine,
  intervalMs = 1000,
  checkReadiness,
  onVideoRenamed,
}: UseProcessingOptions): ProcessingState => {
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const process = useMutation(processVideo);
  const processDrive = useMutation(processDriveAction);
  const cancel = useMutation(cancelJob);
  const processAsync = process.mutateAsync;
  const processDriveAsync = processDrive.mutateAsync;
  const cancelAsync = cancel.mutateAsync;

  const [analyzingPath, setAnalyzingPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressView | null>(null);
  const [driveProgress, setDriveProgress] = useState<DriveProgressView | null>(null);
  const [driveFileProgress, setDriveFileProgress] = useState<BatchProgressView | null>(null);
  const [driveBatchWait, setDriveBatchWait] = useState<BatchWaitView | null>(null);
  const [driveActive, setDriveActive] = useState(false);
  const driveSummaryRef = useRef<DriveSummaryCounts | null>(null);
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({
    open: false,
    isBatch: false,
  });
  const [batchSummary, setBatchSummary] = useState<BatchSummaryState>({ open: false, results: [] });
  const [driveSummary, setDriveSummary] = useState<DriveSummaryState>({ open: false, counts: null });

  const videosRef = useRef(videos);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const busyRef = useRef(false);
  const cancelBatchRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const pendingCancelIsBatchRef = useRef(false);
  const lastProgressKeyRef = useRef('');
  const lastInvalidatedFileIndexRef = useRef(0);

  const applyPendingCancel = useCallback(
    (jobId: string) => {
      if (!cancelRequestedRef.current) return;
      cancelRequestedRef.current = false;
      void cancelAsync({ jobId }).catch((error: unknown) => {
        log(dictionary.processing.cancelRequestFailed(messageOf(error)), 'error');
      });
    },
    [log, cancelAsync, dictionary],
  );

  const runVideo = useCallback(
    async (video: ProcessVideo, force = false): Promise<RunOutcome> => {
      setProgress(null);
      lastProgressKeyRef.current = '';

      let jobId: string;
      try {
        const accepted = await processAsync({ videoPath: video.path, ...(force ? { force: true } : {}) });
        jobId = accepted.jobId;
      } catch (error) {
        const message = messageOf(error);
        log(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      }

      activeJobIdRef.current = jobId;
      applyPendingCancel(jobId);
      try {
        const final = await pollJobUntilTerminal(jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(jobQuery({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          shouldStop: () => !guard.isMounted(),
          signal: guard.signal(),
          onSnapshot: (job) => {
            if (!guard.isMounted() || job.progress === null) return;
            const model = toProgressModel(job.progress);
            const view: ProgressView = { ...model, stepLabel: stepLabel(dictionary, model.step) };
            setProgress(view);
            const key = `${view.step}:${String(view.percentage)}`;
            if (key !== lastProgressKeyRef.current) {
              lastProgressKeyRef.current = key;
              log(dictionary.processing.progressLine(view.percentage, view.stepLabel), 'info', {
                raw: job.progress,
              });
            }
          },
        });
        switch (final.status) {
          case 'completed': {
            log(dictionary.processing.analysisCompleted(video.filename), 'success');
            const completedPath = completedVideoPath(final.result);
            return { success: true, ...(completedPath === null ? {} : { completedPath }) };
          }
          case 'cancelled':
            log(dictionary.processing.cancelledByUser, 'info');
            return { success: false, error: dictionary.processing.cancelledByUser };
          case 'failed': {
            const message = final.error?.message ?? dictionary.processing.processingFailed;
            log(dictionary.processing.error(message), 'error', { raw: final.error });
            return { success: false, error: message };
          }
          case 'queued':
          case 'running':
            return { success: false, error: dictionary.processing.processingDidNotFinish };
        }
      } catch (error) {
        const message = messageOf(error);
        log(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      } finally {
        activeJobIdRef.current = null;
      }
    },
    [processAsync, queryClient, log, intervalMs, dictionary, applyPendingCancel, guard],
  );

  const analyze = useCallback(
    (video: ProcessVideo, options?: { force?: boolean }) => {
      if (busyRef.current) {
        log(dictionary.processing.analysisBusy, 'info');
        return;
      }
      busyRef.current = true;
      cancelBatchRef.current = false;
      cancelRequestedRef.current = false;
      void (async () => {
        if (checkReadiness !== undefined && !await checkReadiness()) {
          log(dictionary.processing.setupIncomplete, 'error');
          busyRef.current = false;
          return;
        }
        setAnalyzingPath(video.path);
        log(dictionary.processing.startingAnalysis(video.filename), 'info');
        const outcome = await runVideo(video, options?.force ?? false);
        busyRef.current = false;
        if (!guard.isMounted()) return;
        setAnalyzingPath(null);
        setProgress(null);
        if (outcome.completedPath !== undefined && outcome.completedPath !== video.path) {
          onVideoRenamed?.(video.path, outcome.completedPath);
        }
        await queryClient.invalidateQueries();
      })();
    },
    [runVideo, log, queryClient, checkReadiness, dictionary, onVideoRenamed, guard],
  );

  const batchAnalyze = useCallback(() => {
    if (busyRef.current) return;
    const pending = videosRef.current.filter((video) => isPending(video.status));
    if (pending.length === 0) {
      log(dictionary.processing.noPendingVideos, 'info');
      return;
    }
    busyRef.current = true;
    cancelBatchRef.current = false;
    cancelRequestedRef.current = false;
    void (async () => {
      if (checkReadiness !== undefined && !await checkReadiness()) {
        log(dictionary.processing.setupIncomplete, 'error');
        busyRef.current = false;
        return;
      }
      log(dictionary.processing.batchStart(pending.length), 'info');
      const results: BatchResultItem[] = [];
      for (const [index, video] of pending.entries()) {
        if (cancelBatchRef.current) {
          log(
            dictionary.processing.batchCancelled(index, pending.length),
            'info',
          );
          break;
        }
        setBatchProgress({
          currentIndex: index + 1,
          totalCount: pending.length,
          currentFilename: video.filename,
        });
        if (video.duplicate != null) {
          log(dictionary.processing.duplicateSkipped(video.filename), 'info');
          results.push({ filename: video.filename, outcome: 'duplicate-skipped' });
          continue;
        }
        setAnalyzingPath(video.path);
        log(dictionary.processing.batchProcessing(index + 1, pending.length, video.filename), 'info');
        const outcome = await runVideo(video);
        results.push({
          filename: video.filename,
          outcome: outcome.success ? 'analyzed' : 'failed',
          ...(outcome.success ? {} : { error: outcome.error }),
        });
      }

      const successCount = results.filter((result) => result.outcome === 'analyzed').length;
      const failedCount = results.filter((result) => result.outcome === 'failed').length;
      const duplicateSkippedCount = results.filter((result) => result.outcome === 'duplicate-skipped').length;
      log(dictionary.processing.batchComplete, 'info');
      log(dictionary.processing.successCount(successCount), 'success');
      if (duplicateSkippedCount > 0) {
        log(dictionary.processing.duplicateSkippedCount(duplicateSkippedCount), 'info');
      }
      if (failedCount > 0) log(dictionary.processing.failedCount(failedCount), 'error');

      busyRef.current = false;
      if (!guard.isMounted()) return;
      setAnalyzingPath(null);
      setProgress(null);
      setBatchProgress(null);
      await queryClient.invalidateQueries();
      setBatchSummary({ open: true, results });
    })();
  }, [runVideo, log, queryClient, checkReadiness, dictionary, guard]);

  const runDrive = useCallback(
    async (root: string): Promise<RunOutcome> => {
      setDriveProgress(null);
      setDriveFileProgress(null);
      setDriveBatchWait(null);
      lastInvalidatedFileIndexRef.current = 0;

      let jobId: string;
      try {
        const accepted = await processDriveAsync({ root, skipDuplicates: true });
        jobId = accepted.jobId;
      } catch (error) {
        const message = messageOf(error);
        log(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      }

      activeJobIdRef.current = jobId;
      applyPendingCancel(jobId);
      const rendered = new Set<number>();
      let counts = emptyDriveCounts();
      try {
        const final = await pollJobUntilTerminal(jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(jobQuery({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          shouldStop: () => !guard.isMounted(),
          signal: guard.signal(),
          onSnapshot: (job) => {
            if (!guard.isMounted()) return;
            for (const event of job.progressEvents) {
              if (rendered.has(event.sequence)) continue;
              rendered.add(event.sequence);
              const outcome = reduceDriveEvent(event.progress, counts);
              counts = outcome.counts;
              for (const message of outcome.messages) {
                log(translateDriveMessage(dictionary, message), message.level, { raw: event.progress });
                if (message.kind === 'runComplete') {
                  driveSummaryRef.current = {
                    foldersDone: message.foldersDone,
                    filesDone: message.filesDone,
                    filesSkipped: message.filesSkipped,
                    filesDuplicateSkipped: message.filesDuplicateSkipped,
                    filesFailed: message.filesFailed,
                    estimatedCostUsd: message.estimatedCostUsd,
                    costedFiles: message.costedFiles,
                  };
                }
              }
              if (outcome.folderProgress !== null) setDriveProgress(outcome.folderProgress);
              if (outcome.fileProgress !== null) {
                setDriveFileProgress(outcome.fileProgress);
                setAnalyzingPath(outcome.fileProgress.currentPath);
              }
              if (outcome.batchWait !== undefined) setDriveBatchWait(outcome.batchWait);
              if (
                outcome.fileProgress !== null
                && outcome.fileProgress.currentIndex > lastInvalidatedFileIndexRef.current
              ) {
                lastInvalidatedFileIndexRef.current = outcome.fileProgress.currentIndex;
                void queryClient.invalidateQueries();
              }
              if (outcome.skippedPath !== null) void queryClient.invalidateQueries();
              if (outcome.folderComplete) void queryClient.invalidateQueries();
            }
          },
        });
        switch (final.status) {
          case 'completed':
            log(dictionary.processing.folderTreeCompleted, 'success');
            return { success: true };
          case 'cancelled':
            log(dictionary.processing.cancelledByUser, 'info');
            return { success: false, error: dictionary.processing.cancelledByUser };
          case 'failed': {
            const message = final.error?.message ?? dictionary.processing.driveProcessingFailed;
            log(dictionary.processing.error(message), 'error', { raw: final.error });
            return { success: false, error: message };
          }
          case 'queued':
          case 'running':
            return { success: false, error: dictionary.processing.driveProcessingDidNotFinish };
        }
      } catch (error) {
        const message = messageOf(error);
        log(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      } finally {
        activeJobIdRef.current = null;
      }
    },
    [processDriveAsync, queryClient, log, intervalMs, dictionary, applyPendingCancel, guard],
  );

  const driveAnalyze = useCallback(
    (root: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      cancelBatchRef.current = false;
      cancelRequestedRef.current = false;
      void (async () => {
        if (checkReadiness !== undefined && !await checkReadiness()) {
          log(dictionary.processing.setupIncomplete, 'error');
          busyRef.current = false;
          return;
        }
        setDriveActive(true);
        driveSummaryRef.current = null;
        log(dictionary.processing.driveStart(root), 'info');
        const outcome = await runDrive(root);
        busyRef.current = false;
        if (!guard.isMounted()) return;
        setDriveActive(false);
        setDriveProgress(null);
        setDriveFileProgress(null);
        setDriveBatchWait(null);
        setAnalyzingPath(null);
        await queryClient.invalidateQueries();
        if (outcome.success && driveSummaryRef.current !== null) {
          setDriveSummary({ open: true, counts: driveSummaryRef.current });
        }
      })();
    },
    [runDrive, log, queryClient, checkReadiness, dictionary, guard],
  );

  const driveCancel = useCallback(() => {
    const jobId = activeJobIdRef.current;
    if (jobId === null) {
      cancelRequestedRef.current = true;
      log(dictionary.processing.cancelWillApplyOnStart, 'info');
      return;
    }
    log(dictionary.processing.stoppingDrive, 'info');
    void cancelAsync({ jobId }).catch((error: unknown) => {
      log(dictionary.processing.cancelRequestFailed(messageOf(error)), 'error');
    });
  }, [log, cancelAsync, dictionary]);

  const requestCancel = useCallback(() => {
    pendingCancelIsBatchRef.current = false;
    setCancelConfirmation({ open: true, isBatch: false });
  }, []);

  const requestBatchCancel = useCallback(() => {
    pendingCancelIsBatchRef.current = true;
    setCancelConfirmation({ open: true, isBatch: true });
  }, []);

  const confirmCancel = useCallback(() => {
    const isBatch = pendingCancelIsBatchRef.current;
    if (isBatch) cancelBatchRef.current = true;
    const jobId = activeJobIdRef.current;
    if (jobId !== null) {
      log(
        isBatch ? dictionary.processing.cancellingCurrentAndBatch : dictionary.processing.cancellingAnalysis,
        'info',
      );
      void cancelAsync({ jobId }).catch((error: unknown) => {
        log(dictionary.processing.cancelRequestFailed(messageOf(error)), 'error');
      });
    } else {
      cancelRequestedRef.current = true;
      log(dictionary.processing.cancelWillApplyOnStart, 'info');
    }
    setCancelConfirmation({ open: false, isBatch });
  }, [log, cancelAsync, dictionary]);

  const closeCancelDialog = useCallback(() => {
    setCancelConfirmation((current) => ({ ...current, open: false }));
  }, []);

  const closeBatchSummary = useCallback(() => {
    setBatchSummary({ open: false, results: [] });
  }, []);

  const closeDriveSummary = useCallback(() => {
    setDriveSummary((current) => ({ ...current, open: false }));
  }, []);

  const pendingCount = videos.filter((video) => isPending(video.status)).length;
  const erroredCount = videos.filter((video) => video.status === 'error').length;

  return {
    analyzingPath,
    progress,
    isBusy: analyzingPath !== null || driveActive,
    pendingCount,
    erroredCount,
    batchProgress,
    driveProgress,
    driveFileProgress,
    driveBatchWait,
    cancelConfirmation,
    batchSummary,
    driveSummary,
    analyze,
    batchAnalyze,
    driveAnalyze,
    driveCancel,
    requestCancel,
    requestBatchCancel,
    confirmCancel,
    closeCancelDialog,
    closeBatchSummary,
    closeDriveSummary,
  };
};
