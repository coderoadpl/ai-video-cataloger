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
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { stepLabel } from './step-labels.js';

type ProcessVideo = Pick<z.output<typeof scanVideoSchema>, 'path' | 'filename' | 'status'>;

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
  cancelConfirmation: CancelConfirmation;
  batchSummary: BatchSummaryState;
  analyze: (video: ProcessVideo) => void;
  batchAnalyze: () => void;
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

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const toProgressView = (progress: NonNullable<JobOutput['progress']>): ProgressView => ({
  step: progress.step,
  stepLabel: stepLabel(progress.step),
  percentage: progress.percentage ?? 0,
  stepNumber: progress.stepNumber ?? 0,
  totalSteps: progress.totalSteps ?? 5,
});

export const useProcessing = ({
  videos,
  addLine,
  intervalMs = 1000,
  checkReadiness,
}: UseProcessingOptions): ProcessingState => {
  const queryClient = useQueryClient();
  const process = useMutation(actions.processVideo);
  const cancel = useMutation(actions.cancelJob);
  const processAsync = process.mutateAsync;
  const cancelAsync = cancel.mutateAsync;

  const [analyzingPath, setAnalyzingPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressView | null>(null);
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
    async (video: ProcessVideo): Promise<RunOutcome> => {
      setProgress(null);
      lastProgressKeyRef.current = '';

      let jobId: string;
      try {
        const accepted = await processAsync({ videoPath: video.path });
        jobId = accepted.jobId;
      } catch (error) {
        const message = messageOf(error);
        addLine(`Error: ${message}`, 'error');
        return { success: false, error: message };
      }

      activeJobIdRef.current = jobId;
      const final = await pollJobUntilTerminal(jobId, {
        intervalMs,
        delay: sleep,
        fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
        isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
        onSnapshot: (job) => {
          if (job.progress === null) return;
          const view = toProgressView(job.progress);
          setProgress(view);
          const key = `${view.step}:${String(view.percentage)}`;
          if (key !== lastProgressKeyRef.current) {
            lastProgressKeyRef.current = key;
            addLine(`[${String(view.percentage)}%] ${view.stepLabel}`, 'info');
            addLine(JSON.stringify(job.progress), 'info', true);
          }
        },
      });
      activeJobIdRef.current = null;

      switch (final.status) {
        case 'completed':
          addLine(`✓ Analysis completed for ${video.filename}`, 'success');
          return { success: true };
        case 'cancelled':
          addLine('Cancelled by user', 'info');
          return { success: false, error: 'Cancelled by user' };
        case 'failed': {
          const message = final.error?.message ?? 'Processing failed';
          addLine(`Error: ${message}`, 'error');
          if (final.error !== null) addLine(JSON.stringify(final.error), 'error', true);
          return { success: false, error: message };
        }
        case 'queued':
        case 'running':
          return { success: false, error: 'Processing did not finish' };
      }
    },
    [processAsync, queryClient, addLine, intervalMs],
  );

  const analyze = useCallback(
    (video: ProcessVideo) => {
      if (busyRef.current) return;
      busyRef.current = true;
      cancelBatchRef.current = false;
      void (async () => {
        if (checkReadiness !== undefined && !await checkReadiness()) {
          addLine('Processing setup is incomplete. Open Settings or run the Setup Wizard.', 'error');
          busyRef.current = false;
          return;
        }
        setAnalyzingPath(video.path);
        addLine(`Starting analysis of ${video.filename}…`, 'info');
        await runVideo(video);
        busyRef.current = false;
        setAnalyzingPath(null);
        setProgress(null);
        await queryClient.invalidateQueries();
      })();
    },
    [runVideo, addLine, queryClient, checkReadiness],
  );

  const batchAnalyze = useCallback(() => {
    if (busyRef.current) return;
    const pending = videosRef.current.filter((video) => isPending(video.status));
    if (pending.length === 0) {
      addLine('No pending videos to analyze', 'info');
      return;
    }
    busyRef.current = true;
    cancelBatchRef.current = false;
    void (async () => {
      if (checkReadiness !== undefined && !await checkReadiness()) {
        addLine('Processing setup is incomplete. Open Settings or run the Setup Wizard.', 'error');
        busyRef.current = false;
        return;
      }
      addLine(`=== Starting batch analysis of ${String(pending.length)} video(s) ===`, 'info');
      const results: BatchResultItem[] = [];
      for (const [index, video] of pending.entries()) {
        if (cancelBatchRef.current) {
          addLine(
            `Batch processing cancelled. Processed ${String(index)} of ${String(pending.length)} videos.`,
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
        addLine(`[${String(index + 1)}/${String(pending.length)}] Processing: ${video.filename}`, 'info');
        const outcome = await runVideo(video);
        results.push({
          filename: video.filename,
          success: outcome.success,
          ...(outcome.success ? {} : { error: outcome.error }),
        });
      }

      const successCount = results.filter((result) => result.success).length;
      const failedCount = results.length - successCount;
      addLine('=== Batch analysis complete ===', 'info');
      addLine(`Success: ${String(successCount)}`, 'success');
      if (failedCount > 0) addLine(`Failed: ${String(failedCount)}`, 'error');

      busyRef.current = false;
      setAnalyzingPath(null);
      setProgress(null);
      setBatchProgress(null);
      await queryClient.invalidateQueries();
      setBatchSummary({ open: true, results });
    })();
  }, [runVideo, addLine, queryClient, checkReadiness]);

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
        isBatch ? 'Cancelling current video and stopping batch…' : 'Cancelling analysis…',
        'info',
      );
      void cancelAsync({ jobId });
    }
    setCancelConfirmation({ open: false, isBatch });
  }, [addLine, cancelAsync]);

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
    isBusy: analyzingPath !== null,
    pendingCount,
    batchProgress,
    cancelConfirmation,
    batchSummary,
    analyze,
    batchAnalyze,
    requestCancel,
    requestBatchCancel,
    confirmCancel,
    closeCancelDialog,
    closeBatchSummary,
  };
};
