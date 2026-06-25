/**
 * useBatchProcessor - single-video analysis and the batch queue state machine
 * (queue, progress, cancel confirmation, summary dialog data), extracted
 * from App.
 */

import { useCallback, useRef, useState } from 'react';
import type { VideoItem } from '@/components/video-list';
import type { RunCli } from '@/hooks/use-cli-command';
import type { RefreshOptions } from '@/hooks/use-catalog';
import type { LogLine } from '@/hooks/use-terminal-log';

export interface CancelConfirmation {
  open: boolean;
  isBatch?: boolean;
}

// Processing progress state
export interface ProcessingProgress {
  videoPath: string;
  step: string;
  percentage: number;
  stepNumber: number;
  totalSteps: number;
}

// Batch processing progress state
export interface BatchProgress {
  currentIndex: number;
  totalCount: number;
  currentVideo: VideoItem;
  successCount: number;
  errorCount: number;
  cancelled: boolean;
}

// Batch result for summary
export interface BatchResult {
  video: VideoItem;
  success: boolean;
  error?: string;
}

// Map step names to human-readable labels
export const getStepLabel = (step: string): string => {
  const stepLabels: Record<string, string> = {
    extracting_frames: 'Extracting frames',
    extracting_audio: 'Extracting audio',
    transcribing_audio: 'Transcribing audio',
    analyzing_with_claude: 'Analyzing with AI',
    renaming_video: 'Renaming video',
    skipping_rename: 'Finalizing',
  };
  return stepLabels[step] || step.replace(/_/g, ' ');
};

export interface UseBatchProcessorOptions {
  runCli: RunCli;
  addLogLine: (content: string, type?: LogLine['type']) => void;
  currentFolder: string | null;
  videos: VideoItem[];
  refresh: (opts?: RefreshOptions) => Promise<VideoItem[] | null>;
}

export interface UseBatchProcessorResult {
  isAnalyzing: boolean;
  analyzingVideoPath: string | null;
  processingProgress: ProcessingProgress | null;
  isBatchProcessing: boolean;
  batchProgress: BatchProgress | null;
  batchResults: BatchResult[];
  showBatchSummary: boolean;
  cancelConfirmation: CancelConfirmation;
  pendingVideosCount: number;
  analyzeVideo: (video: VideoItem) => Promise<void>;
  batchAnalyze: () => Promise<void>;
  requestCancel: () => void;
  requestBatchCancel: () => void;
  confirmCancel: () => Promise<void>;
  confirmBatchCancel: () => Promise<void>;
  closeCancelModal: () => void;
  closeBatchSummary: () => void;
}

export function useBatchProcessor({
  runCli,
  addLogLine,
  currentFolder,
  videos,
  refresh,
}: UseBatchProcessorOptions): UseBatchProcessorResult {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [analyzingVideoPath, setAnalyzingVideoPath] = useState<string | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({ open: false });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const batchCancelledRef = useRef(false);

  // Count pending videos for "Analyze All" button
  const pendingVideosCount = videos.filter((v) =>
    v.status === 'pending' || v.status === 'not_tracked'
  ).length;

  // Analyze a single video using CLI
  const analyzeVideo = useCallback(async (video: VideoItem): Promise<void> => {
    if (!currentFolder || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalyzingVideoPath(video.path);
    setProcessingProgress(null);

    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    addLogLine(`\x1b[36mStarting analysis of ${video.filename}...\x1b[0m`, 'info');

    try {
      const { code, signal, events } = await runCli(
        ['process', video.path],
        {
          onJson: (event) => {
            if (event.type === 'progress') {
              // Update progress state
              const stepNumber = event.data?.stepNumber as number | undefined;
              const totalSteps = event.data?.totalSteps as number | undefined;

              setProcessingProgress({
                videoPath: video.path,
                step: event.step || 'processing',
                percentage: event.percentage || 0,
                stepNumber: stepNumber || 0,
                totalSteps: totalSteps || 5,
              });

              addLogLine(`\x1b[33m[${event.percentage || 0}%]\x1b[0m ${getStepLabel(event.step || '')}`, 'info');
            } else if (event.type === 'completed') {
              addLogLine(`\x1b[32m✓\x1b[0m Analysis completed for ${video.filename}`, 'success');
            } else if (event.type === 'error') {
              addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
            }
          },
          onLine: (line, source) => addLogLine(line, source),
        },
        { signal: controller.signal }
      );

      // Check if the process was killed (SIGTERM)
      const wasCancelled = signal === 'SIGTERM';
      if (wasCancelled) {
        addLogLine(`\x1b[33mCancelled by user\x1b[0m`, 'info');
      }

      const hasError = events.some((event) => event.type === 'error');
      if (!wasCancelled && (code !== 0 || hasError)) {
        addLogLine(`\x1b[31mAnalysis failed with exit code ${code}\x1b[0m`, 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLogLine(`\x1b[31mError:\x1b[0m Failed to start analysis: ${message}`, 'error');
    } finally {
      analyzeAbortRef.current = null;
      setIsAnalyzing(false);
      setAnalyzingVideoPath(null);
      setProcessingProgress(null);
    }

    // Refresh the list from a fresh CLI scan. The video might have been
    // renamed, so the selection is preserved by contentHash (key), not path.
    await refresh({ selectKey: video.contentHash });
  }, [currentFolder, isAnalyzing, addLogLine, runCli, refresh]);

  // Handle cancel button click - show confirmation modal
  const requestCancel = useCallback(() => {
    setCancelConfirmation({ open: true });
  }, []);

  // Handle cancel confirmation - abort the running command (kills the process)
  const confirmCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });

    if (analyzeAbortRef.current) {
      addLogLine(`\x1b[33mCancelling analysis...\x1b[0m`, 'info');
      analyzeAbortRef.current.abort();
    }
  }, [addLogLine]);

  // Handle cancel modal close
  const closeCancelModal = useCallback(() => {
    setCancelConfirmation({ open: false });
  }, []);

  // Process a single video in batch mode (returns success/error status)
  const processSingleVideoInBatch = useCallback(async (video: VideoItem): Promise<{ success: boolean; error?: string }> => {
    if (!currentFolder) return { success: false, error: 'No folder selected' };

    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    let errorMessage = '';

    try {
      const { code, signal, events } = await runCli(
        ['process', video.path],
        {
          onJson: (event) => {
            if (event.type === 'progress') {
              const stepNumber = event.data?.stepNumber as number | undefined;
              const totalSteps = event.data?.totalSteps as number | undefined;

              setProcessingProgress({
                videoPath: video.path,
                step: event.step || 'processing',
                percentage: event.percentage || 0,
                stepNumber: stepNumber || 0,
                totalSteps: totalSteps || 5,
              });

              addLogLine(`\x1b[33m[${event.percentage || 0}%]\x1b[0m ${getStepLabel(event.step || '')}`, 'info');
            } else if (event.type === 'completed') {
              addLogLine(`\x1b[32m✓\x1b[0m Analysis completed for ${video.filename}`, 'success');
            } else if (event.type === 'error') {
              errorMessage = event.error || event.message || 'Unknown error';
              addLogLine(`\x1b[31mError:\x1b[0m ${errorMessage}`, 'error');
            }
          },
          onLine: (line, source) => addLogLine(line, source),
        },
        { signal: controller.signal }
      );

      if (signal === 'SIGTERM') {
        addLogLine(`\x1b[33mCancelled by user\x1b[0m`, 'info');
        return { success: false, error: 'Cancelled by user' };
      }

      const hasError = events.some((event) => event.type === 'error');
      if (code !== 0 || hasError) {
        return { success: false, error: errorMessage || `Exit code ${code}` };
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLogLine(`\x1b[31mError:\x1b[0m Failed to start analysis: ${message}`, 'error');
      return { success: false, error: message };
    } finally {
      analyzeAbortRef.current = null;
      setProcessingProgress(null);
    }
  }, [currentFolder, addLogLine, runCli]);

  // Handle batch analysis of all pending videos
  const batchAnalyze = useCallback(async (): Promise<void> => {
    if (!currentFolder || isAnalyzing || isBatchProcessing) return;

    // Get all pending videos
    const pendingVideos = videos.filter((v) =>
      v.status === 'pending' || v.status === 'not_tracked'
    );

    if (pendingVideos.length === 0) {
      addLogLine(`\x1b[33mNo pending videos to analyze\x1b[0m`, 'info');
      return;
    }

    // Initialize batch processing state
    batchCancelledRef.current = false;
    setIsBatchProcessing(true);
    setIsAnalyzing(true);
    setBatchResults([]);

    addLogLine(`\x1b[36m=== Starting batch analysis of ${pendingVideos.length} video(s) ===\x1b[0m`, 'info');

    const results: BatchResult[] = [];

    for (let i = 0; i < pendingVideos.length; i++) {
      // Check if cancelled
      if (batchCancelledRef.current) {
        addLogLine(`\x1b[33mBatch processing cancelled. Processed ${i} of ${pendingVideos.length} videos.\x1b[0m`, 'info');
        break;
      }

      const video = pendingVideos[i];

      // Update batch progress
      setBatchProgress({
        currentIndex: i + 1,
        totalCount: pendingVideos.length,
        currentVideo: video,
        successCount: results.filter((r) => r.success).length,
        errorCount: results.filter((r) => !r.success).length,
        cancelled: false,
      });

      setAnalyzingVideoPath(video.path);
      addLogLine(`\x1b[36m[${i + 1}/${pendingVideos.length}]\x1b[0m Processing: ${video.filename}`, 'info');

      // Process the video
      const result = await processSingleVideoInBatch(video);

      results.push({
        video,
        success: result.success,
        error: result.error,
      });

      // Update results state for real-time tracking
      setBatchResults([...results]);
    }

    // Batch processing complete
    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success && r.error !== 'Cancelled by user').length;
    const cancelledCount = results.filter((r) => r.error === 'Cancelled by user').length;
    const skippedCount = pendingVideos.length - results.length;

    addLogLine(`\x1b[36m=== Batch analysis complete ===\x1b[0m`, 'info');
    addLogLine(`\x1b[32m✓ Success:\x1b[0m ${successCount}`, 'success');
    if (errorCount > 0) {
      addLogLine(`\x1b[31m✗ Failed:\x1b[0m ${errorCount}`, 'error');
    }
    if (cancelledCount > 0) {
      addLogLine(`\x1b[33m⊘ Cancelled:\x1b[0m ${cancelledCount}`, 'info');
    }
    if (skippedCount > 0) {
      addLogLine(`\x1b[33m⊘ Skipped:\x1b[0m ${skippedCount}`, 'info');
    }

    // Reset states
    setIsBatchProcessing(false);
    setIsAnalyzing(false);
    setAnalyzingVideoPath(null);
    setBatchProgress(null);

    // Refresh video list - replaced wholesale with the new scan result
    await refresh();

    // Show summary dialog
    setBatchResults(results);
    setShowBatchSummary(true);
  }, [currentFolder, isAnalyzing, isBatchProcessing, videos, addLogLine, processSingleVideoInBatch, refresh]);

  // Handle batch cancel button click
  const requestBatchCancel = useCallback(() => {
    setCancelConfirmation({ open: true, isBatch: true });
  }, []);

  // Handle batch cancel confirmation
  const confirmBatchCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });
    batchCancelledRef.current = true;

    if (analyzeAbortRef.current) {
      addLogLine(`\x1b[33mCancelling current video and stopping batch...\x1b[0m`, 'info');
      analyzeAbortRef.current.abort();
    }
  }, [addLogLine]);

  // Close batch summary dialog
  const closeBatchSummary = useCallback(() => {
    setShowBatchSummary(false);
    setBatchResults([]);
  }, []);

  return {
    isAnalyzing,
    analyzingVideoPath,
    processingProgress,
    isBatchProcessing,
    batchProgress,
    batchResults,
    showBatchSummary,
    cancelConfirmation,
    pendingVideosCount,
    analyzeVideo,
    batchAnalyze,
    requestCancel,
    requestBatchCancel,
    confirmCancel,
    confirmBatchCancel,
    closeCancelModal,
    closeBatchSummary,
  };
}
