import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus, type JobOutput } from '@core/client/index.js';
import type { z } from 'zod';
import type { scanVideoSchema } from '@core/contract/index.js';

import type { BatchProgressView } from '../../components/ui/BatchToolbar.js';
import type { CancelConfirmation } from '../../components/ui/dialogs/CancelConfirmationDialog.js';
import type { BatchResultItem } from '../../components/ui/dialogs/BatchSummaryDialog.js';
import type { ProgressView } from '../../components/ui/ProcessingOverlay.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { actions } from '../../api.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { stepLabel } from './step-labels.js';

type ProcessVideo = Pick<z.output<typeof scanVideoSchema>, 'path' | 'filename' | 'status'>;

export interface DriveProgressView {
  currentFolder: number;
  totalFolders: number;
  filesDone: number;
  filesSkipped: number;
}

interface RunOutcome {
  success: boolean;
  error?: string;
}

export interface BatchSummaryState {
  open: boolean;
  results: readonly BatchResultItem[];
}

export interface ProcessingState {
  analyzingPath: string | null;
  progress: ProgressView | null;
  isBusy: boolean;
  pendingCount: number;
  batchProgress: BatchProgressView | null;
  driveProgress: DriveProgressView | null;
  driveFileProgress: BatchProgressView | null;
  skippedPaths: ReadonlySet<string>;
  cancelConfirmation: CancelConfirmation;
  batchSummary: BatchSummaryState;
  analyze: (video: ProcessVideo, options?: { force?: boolean }) => void;
  batchAnalyze: () => void;
  driveAnalyze: (root: string) => void;
  driveCancel: () => void;
  requestCancel: () => void;
  requestBatchCancel: () => void;
  confirmCancel: () => void;
  closeCancelDialog: () => void;
  closeBatchSummary: () => void;
}

export interface UseProcessingOptions {
  videos: readonly ProcessVideo[];
  addLine: AddLogLine;
  intervalMs?: number;
  checkReadiness?: (() => Promise<boolean>) | undefined;
}

const isPending = (status: ProcessVideo['status']): boolean =>
  status === 'pending' || status === 'not_tracked';

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const PER_FILE_STEPS = new Set([
  'extracting_frames',
  'extracting_audio',
  'transcribing_audio',
  'analyzing_with_claude',
  'renaming_video',
  'skipping_rename',
]);

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const toProgressView = (progress: NonNullable<JobOutput['progress']>, dictionary: Dictionary): ProgressView => ({
  step: progress.step,
  stepLabel: stepLabel(dictionary, progress.step),
  percentage: progress.percentage ?? 0,
  stepNumber: progress.stepNumber ?? 0,
  totalSteps: progress.totalSteps ?? 5,
});

type DriveEventProgress = JobOutput['progressEvents'][number]['progress'];

interface DriveCounts {
  currentFolder: number;
  totalFolders: number;
  filesDone: number;
  filesSkipped: number;
}

const numField = (data: Record<string, unknown> | undefined, key: string): number => {
  const value = data?.[key];
  return typeof value === 'number' ? value : 0;
};

const strField = (data: Record<string, unknown> | undefined, key: string): string => {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
};

interface DriveHandlers {
  dictionary: Dictionary;
  addLine: AddLogLine;
  onFolderProgress: (view: DriveProgressView) => void;
  onFileProgress: (view: BatchProgressView) => void;
  onFolderComplete: () => void;
  onSkipped: (path: string) => void;
}

const renderDriveEvent = (
  progress: DriveEventProgress,
  counts: DriveCounts,
  handlers: DriveHandlers,
): void => {
  const { step, data } = progress;
  if (step === 'run-started') {
    counts.totalFolders = numField(data, 'foldersTotal');
    handlers.addLine(handlers.dictionary.processing.driveRunStarted(counts.totalFolders, numField(data, 'filesTotal')), 'info');
    return;
  }
  if (step === 'folder-started') {
    counts.currentFolder += 1;
    handlers.addLine(handlers.dictionary.processing.driveFolderStarted(strField(data, 'path'), numField(data, 'filesTotal')), 'info');
    handlers.onFolderProgress({ ...counts });
    return;
  }
  if (step === 'folder-done') {
    counts.filesDone += numField(data, 'filesDone');
    counts.filesSkipped += numField(data, 'filesSkipped');
    handlers.addLine(
      handlers.dictionary.processing.driveFolderDone(
        strField(data, 'path'),
        numField(data, 'filesDone'),
        numField(data, 'filesSkipped'),
        numField(data, 'filesFailed'),
      ),
      'success',
    );
    handlers.onFolderProgress({ ...counts });
    handlers.onFolderComplete();
    return;
  }
  if (step === 'file-skipped') {
    const video = strField(data, 'video');
    handlers.addLine(handlers.dictionary.processing.driveFileSkipped(basename(video)), 'info');
    handlers.onSkipped(video);
    return;
  }
  if (step === 'run-summary') {
    handlers.addLine(
      handlers.dictionary.processing.driveRunComplete(
        numField(data, 'foldersDone'),
        numField(data, 'foldersTotal'),
        numField(data, 'filesDone'),
        numField(data, 'filesSkipped'),
        numField(data, 'filesFailed'),
      ),
      'info',
    );
    return;
  }
  if (PER_FILE_STEPS.has(step)) {
    const filename = basename(strField(data, 'video'));
    const currentIndex = progress.current ?? 0;
    const totalCount = progress.total ?? 0;
    handlers.onFileProgress({ currentIndex, totalCount, currentFilename: filename });
    handlers.addLine(handlers.dictionary.processing.fileProgressLine(currentIndex, totalCount, stepLabel(handlers.dictionary, step), filename), 'info');
  }
};

export const useProcessing = ({
  videos,
  addLine,
  intervalMs = 1000,
  checkReadiness,
}: UseProcessingOptions): ProcessingState => {
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const process = useMutation(actions.processVideo);
  const processDrive = useMutation(actions.processDrive);
  const cancel = useMutation(actions.cancelJob);
  const processAsync = process.mutateAsync;
  const processDriveAsync = processDrive.mutateAsync;
  const cancelAsync = cancel.mutateAsync;

  const [analyzingPath, setAnalyzingPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressView | null>(null);
  const [driveProgress, setDriveProgress] = useState<DriveProgressView | null>(null);
  const [driveFileProgress, setDriveFileProgress] = useState<BatchProgressView | null>(null);
  const [skippedPaths, setSkippedPaths] = useState<ReadonlySet<string>>(new Set());
  const [driveActive, setDriveActive] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({
    open: false,
    isBatch: false,
  });
  const [batchSummary, setBatchSummary] = useState<BatchSummaryState>({ open: false, results: [] });

  const videosRef = useRef(videos);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const busyRef = useRef(false);
  const cancelBatchRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const pendingCancelIsBatchRef = useRef(false);
  const lastProgressKeyRef = useRef('');

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
        addLine(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      }

      activeJobIdRef.current = jobId;
      try {
        const final = await pollJobUntilTerminal(jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          onSnapshot: (job) => {
            if (job.progress === null) return;
            const view = toProgressView(job.progress, dictionary);
            setProgress(view);
            const key = `${view.step}:${String(view.percentage)}`;
            if (key !== lastProgressKeyRef.current) {
              lastProgressKeyRef.current = key;
              addLine(dictionary.processing.progressLine(view.percentage, view.stepLabel), 'info');
              addLine(JSON.stringify(job.progress), 'info', true);
            }
          },
        });
        switch (final.status) {
          case 'completed':
            addLine(dictionary.processing.analysisCompleted(video.filename), 'success');
            return { success: true };
          case 'cancelled':
            addLine(dictionary.processing.cancelledByUser, 'info');
            return { success: false, error: dictionary.processing.cancelledByUser };
          case 'failed': {
            const message = final.error?.message ?? dictionary.processing.processingFailed;
            addLine(dictionary.processing.error(message), 'error');
            if (final.error !== null) addLine(JSON.stringify(final.error), 'error', true);
            return { success: false, error: message };
          }
          case 'queued':
          case 'running':
            return { success: false, error: dictionary.processing.processingDidNotFinish };
        }
      } catch (error) {
        const message = messageOf(error);
        addLine(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      } finally {
        activeJobIdRef.current = null;
      }
    },
    [processAsync, queryClient, addLine, intervalMs, dictionary],
  );

  const analyze = useCallback(
    (video: ProcessVideo, options?: { force?: boolean }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      cancelBatchRef.current = false;
      void (async () => {
        if (checkReadiness !== undefined && !await checkReadiness()) {
          addLine(dictionary.processing.setupIncomplete, 'error');
          busyRef.current = false;
          return;
        }
        setAnalyzingPath(video.path);
        addLine(dictionary.processing.startingAnalysis(video.filename), 'info');
        await runVideo(video, options?.force ?? false);
        busyRef.current = false;
        setAnalyzingPath(null);
        setProgress(null);
        await queryClient.invalidateQueries();
      })();
    },
    [runVideo, addLine, queryClient, checkReadiness, dictionary],
  );

  const batchAnalyze = useCallback(() => {
    if (busyRef.current) return;
    const pending = videosRef.current.filter((video) => isPending(video.status));
    if (pending.length === 0) {
      addLine(dictionary.processing.noPendingVideos, 'info');
      return;
    }
    busyRef.current = true;
    cancelBatchRef.current = false;
    void (async () => {
      if (checkReadiness !== undefined && !await checkReadiness()) {
        addLine(dictionary.processing.setupIncomplete, 'error');
        busyRef.current = false;
        return;
      }
      addLine(dictionary.processing.batchStart(pending.length), 'info');
      const results: BatchResultItem[] = [];
      for (const [index, video] of pending.entries()) {
        if (cancelBatchRef.current) {
          addLine(
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
        setAnalyzingPath(video.path);
        addLine(dictionary.processing.batchProcessing(index + 1, pending.length, video.filename), 'info');
        const outcome = await runVideo(video);
        results.push({
          filename: video.filename,
          success: outcome.success,
          ...(outcome.success ? {} : { error: outcome.error }),
        });
      }

      const successCount = results.filter((result) => result.success).length;
      const failedCount = results.length - successCount;
      addLine(dictionary.processing.batchComplete, 'info');
      addLine(dictionary.processing.successCount(successCount), 'success');
      if (failedCount > 0) addLine(dictionary.processing.failedCount(failedCount), 'error');

      busyRef.current = false;
      setAnalyzingPath(null);
      setProgress(null);
      setBatchProgress(null);
      await queryClient.invalidateQueries();
      setBatchSummary({ open: true, results });
    })();
  }, [runVideo, addLine, queryClient, checkReadiness, dictionary]);

  const runDrive = useCallback(
    async (root: string): Promise<RunOutcome> => {
      setDriveProgress(null);
      setDriveFileProgress(null);

      let jobId: string;
      try {
        const accepted = await processDriveAsync({ root });
        jobId = accepted.jobId;
      } catch (error) {
        const message = messageOf(error);
        addLine(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      }

      activeJobIdRef.current = jobId;
      const rendered = new Set<number>();
      const counts: DriveCounts = { currentFolder: 0, totalFolders: 0, filesDone: 0, filesSkipped: 0 };
      try {
        const final = await pollJobUntilTerminal(jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          onSnapshot: (job) => {
            for (const event of job.progressEvents) {
              if (rendered.has(event.sequence)) continue;
              rendered.add(event.sequence);
              renderDriveEvent(event.progress, counts, {
                dictionary,
                addLine,
                onFolderProgress: setDriveProgress,
                onFileProgress: setDriveFileProgress,
                onFolderComplete: () => {
                  void queryClient.invalidateQueries();
                },
                onSkipped: (path) => {
                  setSkippedPaths((current) => new Set(current).add(path));
                },
              });
            }
          },
        });
        switch (final.status) {
          case 'completed':
            addLine(dictionary.processing.folderTreeCompleted, 'success');
            return { success: true };
          case 'cancelled':
            addLine(dictionary.processing.cancelledByUser, 'info');
            return { success: false, error: dictionary.processing.cancelledByUser };
          case 'failed': {
            const message = final.error?.message ?? dictionary.processing.driveProcessingFailed;
            addLine(dictionary.processing.error(message), 'error');
            if (final.error !== null) addLine(JSON.stringify(final.error), 'error', true);
            return { success: false, error: message };
          }
          case 'queued':
          case 'running':
            return { success: false, error: dictionary.processing.driveProcessingDidNotFinish };
        }
      } catch (error) {
        const message = messageOf(error);
        addLine(dictionary.processing.error(message), 'error');
        return { success: false, error: message };
      } finally {
        activeJobIdRef.current = null;
      }
    },
    [processDriveAsync, queryClient, addLine, intervalMs, dictionary],
  );

  const driveAnalyze = useCallback(
    (root: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      cancelBatchRef.current = false;
      void (async () => {
        if (checkReadiness !== undefined && !await checkReadiness()) {
          addLine(dictionary.processing.setupIncomplete, 'error');
          busyRef.current = false;
          return;
        }
        setDriveActive(true);
        setSkippedPaths(new Set());
        addLine(dictionary.processing.driveStart(root), 'info');
        await runDrive(root);
        busyRef.current = false;
        setDriveActive(false);
        setDriveProgress(null);
        setDriveFileProgress(null);
        await queryClient.invalidateQueries();
      })();
    },
    [runDrive, addLine, queryClient, checkReadiness, dictionary],
  );

  const driveCancel = useCallback(() => {
    const jobId = activeJobIdRef.current;
    if (jobId === null) return;
    addLine(dictionary.processing.stoppingDrive, 'info');
    void cancelAsync({ jobId });
  }, [addLine, cancelAsync, dictionary]);

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
      addLine(
        isBatch ? dictionary.processing.cancellingCurrentAndBatch : dictionary.processing.cancellingAnalysis,
        'info',
      );
      void cancelAsync({ jobId });
    }
    setCancelConfirmation({ open: false, isBatch });
  }, [addLine, cancelAsync, dictionary]);

  const closeCancelDialog = useCallback(() => {
    setCancelConfirmation((current) => ({ ...current, open: false }));
  }, []);

  const closeBatchSummary = useCallback(() => {
    setBatchSummary({ open: false, results: [] });
  }, []);

  const pendingCount = videos.filter((video) => isPending(video.status)).length;

  return {
    analyzingPath,
    progress,
    isBusy: analyzingPath !== null || driveActive,
    pendingCount,
    batchProgress,
    driveProgress,
    driveFileProgress,
    skippedPaths,
    cancelConfirmation,
    batchSummary,
    analyze,
    batchAnalyze,
    driveAnalyze,
    driveCancel,
    requestCancel,
    requestBatchCancel,
    confirmCancel,
    closeCancelDialog,
    closeBatchSummary,
  };
};
