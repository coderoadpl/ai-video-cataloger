import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TerminalLog, LogLine, createLogLine } from '@/components/terminal-log';
import { AppLayout } from '@/components/layout';
import { VideoList, VideoItem } from '@/components/video-list';
import { VideoDetails } from '@/components/video-details';
import { FolderOpen, Settings, HelpCircle, AlertTriangle, ChevronDown, Folder, Loader2, XCircle, Play, CheckCircle2, XOctagon } from 'lucide-react';

interface JsonEvent {
  type: 'started' | 'progress' | 'completed' | 'error';
  timestamp: string;
  message?: string;
  step?: string;
  percentage?: number;
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

interface NestedDbError {
  open: boolean;
  paths: string[];
}

interface CancelConfirmation {
  open: boolean;
  isBatch?: boolean;
}

// Processing progress state
interface ProcessingProgress {
  videoPath: string;
  step: string;
  percentage: number;
  stepNumber: number;
  totalSteps: number;
}

// Batch processing progress state
interface BatchProgress {
  currentIndex: number;
  totalCount: number;
  currentVideo: VideoItem;
  successCount: number;
  errorCount: number;
  cancelled: boolean;
}

// Batch result for summary
interface BatchResult {
  video: VideoItem;
  success: boolean;
  error?: string;
}

// Scanned video from CLI (matches folder-scan.ts ScannedVideo)
interface ScannedVideo {
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  duration: number | null;
  durationFormatted: string | null;
  status: string;
  errorMessage?: string | null;
}

// Folder scan result from CLI
interface FolderScanResult {
  folder: string;
  databasePath: string | null;
  videos: ScannedVideo[];
  summary: {
    total: number;
    tracked: number;
    pending: number;
    inProgress: number;
    completed: number;
    error: number;
    notTracked: number;
  };
}

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [nestedDbError, setNestedDbError] = useState<NestedDbError>({ open: false, paths: [] });
  const [showRecentMenu, setShowRecentMenu] = useState(false);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const thumbnailGenerationRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [analyzingVideoPath, setAnalyzingVideoPath] = useState<string | null>(null);
  const [currentSpawnId, setCurrentSpawnId] = useState<string | null>(null);
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({ open: false });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const batchCancelledRef = useRef(false);

  // Load initial state
  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
    window.electronAPI?.folder.getRecent().then(setRecentFolders).catch(console.error);
    window.electronAPI?.folder.getCurrent().then(setCurrentFolder).catch(console.error);
  }, []);

  const handleClear = useCallback(() => {
    setLogLines([]);
  }, []);

  const handleCopy = useCallback(async () => {
    // Strip ANSI codes when copying
    const plainText = logLines
      .map((line) => line.content.replace(/\x1b\[[0-9;]*m/g, ''))
      .join('\n');
    await navigator.clipboard.writeText(plainText);
  }, [logLines]);

  const addLogLine = useCallback((content: string, type: LogLine['type'] = 'stdout') => {
    setLogLines((prev) => [...prev, createLogLine(content, type)]);
  }, []);

  // Check folder for nested databases using CLI
  const checkFolderForNestedDbs = useCallback(
    async (folderPath: string): Promise<{ valid: boolean; nestedPaths: string[] }> => {
      return new Promise((resolve) => {
        setIsCheckingFolder(true);
        addLogLine(`\x1b[36mChecking folder for nested databases...\x1b[0m`, 'info');

        let nestedPaths: string[] = [];
        let hasError = false;

        const handleOutput = (_spawnId: string, line: string): void => {
          addLogLine(line, 'stdout');
        };

        const handleJson = (_spawnId: string, event: JsonEvent): void => {
          if (event.type === 'completed' && event.data) {
            const paths = event.data.nestedDatabases;
            if (Array.isArray(paths) && paths.length > 0) {
              nestedPaths = paths as string[];
            }
          } else if (event.type === 'error') {
            hasError = true;
            addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
          }
        };

        const handleExit = (_spawnId: string, code: number | null): void => {
          cleanupListeners();
          setIsCheckingFolder(false);

          if (hasError || code !== 0) {
            if (nestedPaths.length > 0) {
              resolve({ valid: false, nestedPaths });
            } else {
              resolve({ valid: false, nestedPaths: [] });
            }
          } else {
            resolve({ valid: true, nestedPaths: [] });
          }
        };

        // Set up listeners
        const cleanupStdout = window.electronAPI?.cli.onStdout(handleOutput);
        const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
        const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

        const cleanupListeners = (): void => {
          cleanupStdout?.();
          cleanupJson?.();
          cleanupExit?.();
        };

        // Spawn the check command
        window.electronAPI?.cli
          .spawn(['check', folderPath], { json: true })
          .catch((err: Error) => {
            addLogLine(`\x1b[31mError:\x1b[0m Failed to run check: ${err.message}`, 'error');
            cleanupListeners();
            setIsCheckingFolder(false);
            resolve({ valid: false, nestedPaths: [] });
          });
      });
    },
    [addLogLine]
  );

  // Get thumbnail path for a video
  const getThumbnailPath = useCallback((videoPath: string, folderPath: string): string => {
    const videoName = videoPath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'thumbnail';
    return `${folderPath}/.ai-video-cataloger/thumbnails/${videoName}.jpg`;
  }, []);

  // Load thumbnail for a video and return data URL
  const loadThumbnail = useCallback(async (videoPath: string, folderPath: string): Promise<string | null> => {
    const thumbnailPath = getThumbnailPath(videoPath, folderPath);
    return window.electronAPI?.file.readAsDataUrl(thumbnailPath) || null;
  }, [getThumbnailPath]);

  // Generate thumbnail for a video via CLI
  const generateThumbnail = useCallback(async (videoPath: string): Promise<boolean> => {
    return new Promise((resolve) => {
      let completed = false;

      const handleJson = (_spawnId: string, event: JsonEvent): void => {
        if (event.type === 'completed') {
          completed = true;
        } else if (event.type === 'error') {
          addLogLine(`\x1b[31mThumbnail error:\x1b[0m ${event.error || event.message}`, 'error');
        }
      };

      const handleExit = (_spawnId: string, _code: number | null): void => {
        cleanupListeners();
        resolve(completed);
      };

      const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
      const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

      const cleanupListeners = (): void => {
        cleanupJson?.();
        cleanupExit?.();
      };

      window.electronAPI?.cli
        .spawn(['thumbnail', videoPath], { json: true })
        .catch(() => {
          cleanupListeners();
          resolve(false);
        });
    });
  }, [addLogLine]);

  // Scan folder for videos using CLI
  const scanFolder = useCallback(async (folderPath: string): Promise<FolderScanResult | null> => {
    return new Promise((resolve) => {
      setIsLoadingVideos(true);
      addLogLine(`\x1b[36mScanning folder for videos...\x1b[0m`, 'info');

      let scanResult: FolderScanResult | null = null;

      const handleJson = (_spawnId: string, event: JsonEvent): void => {
        if (event.type === 'completed' && event.data) {
          const data = event.data as unknown as FolderScanResult;
          if (data.videos) {
            scanResult = data;
          }
        } else if (event.type === 'error') {
          addLogLine(`\x1b[31mScan error:\x1b[0m ${event.error || event.message}`, 'error');
        }
      };

      const handleExit = (_spawnId: string, code: number | null): void => {
        cleanupListeners();
        setIsLoadingVideos(false);

        if (code === 0 && scanResult) {
          addLogLine(`\x1b[32m✓\x1b[0m Found ${scanResult.videos.length} video(s)`, 'success');
          resolve(scanResult);
        } else {
          resolve(null);
        }
      };

      const cleanupStdout = window.electronAPI?.cli.onStdout((_spawnId: string, line: string) => {
        addLogLine(line, 'stdout');
      });
      const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
      const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

      const cleanupListeners = (): void => {
        cleanupStdout?.();
        cleanupJson?.();
        cleanupExit?.();
      };

      window.electronAPI?.cli
        .spawn(['scan', folderPath], { json: true })
        .catch((err: Error) => {
          addLogLine(`\x1b[31mError:\x1b[0m Failed to scan folder: ${err.message}`, 'error');
          cleanupListeners();
          setIsLoadingVideos(false);
          resolve(null);
        });
    });
  }, [addLogLine]);

  // Load videos and generate thumbnails for a folder
  const loadVideosForFolder = useCallback(async (folderPath: string) => {
    // Cancel any ongoing thumbnail generation
    thumbnailGenerationRef.current.cancelled = true;
    thumbnailGenerationRef.current = { cancelled: false };
    const currentGeneration = thumbnailGenerationRef.current;

    // Clear previous videos
    setVideos([]);
    setSelectedVideo(null);

    // Scan folder
    const result = await scanFolder(folderPath);
    if (!result || result.videos.length === 0) {
      return;
    }

    // Convert to VideoItem format (without thumbnails initially)
    const videoItems: VideoItem[] = result.videos.map((v) => ({
      path: v.path,
      filename: v.filename,
      size: v.size,
      sizeFormatted: v.sizeFormatted,
      duration: v.duration,
      durationFormatted: v.durationFormatted,
      status: v.status as VideoItem['status'],
      errorMessage: v.errorMessage,
      thumbnailPath: getThumbnailPath(v.path, folderPath),
      thumbnailDataUrl: null,
    }));

    setVideos(videoItems);

    // Generate and load thumbnails in background
    setIsGeneratingThumbnails(true);
    addLogLine(`\x1b[36mGenerating thumbnails...\x1b[0m`, 'info');

    let generatedCount = 0;
    for (let i = 0; i < videoItems.length; i++) {
      if (currentGeneration.cancelled) {
        addLogLine(`\x1b[33mThumbnail generation cancelled\x1b[0m`, 'info');
        break;
      }

      const video = videoItems[i];

      // Try to load existing thumbnail first
      let thumbnailDataUrl = await loadThumbnail(video.path, folderPath);

      // If no thumbnail, generate it
      if (!thumbnailDataUrl) {
        const generated = await generateThumbnail(video.path);
        if (generated) {
          thumbnailDataUrl = await loadThumbnail(video.path, folderPath);
          generatedCount++;
        }
      }

      if (thumbnailDataUrl && !currentGeneration.cancelled) {
        // Update video with thumbnail
        setVideos((prev) =>
          prev.map((v) =>
            v.path === video.path ? { ...v, thumbnailDataUrl } : v
          )
        );
      }
    }

    if (!currentGeneration.cancelled) {
      setIsGeneratingThumbnails(false);
      if (generatedCount > 0) {
        addLogLine(`\x1b[32m✓\x1b[0m Generated ${generatedCount} thumbnail(s)`, 'success');
      } else {
        addLogLine(`\x1b[32m✓\x1b[0m Thumbnails loaded`, 'success');
      }
    }
  }, [scanFolder, getThumbnailPath, loadThumbnail, generateThumbnail, addLogLine]);

  // Load videos for current folder on initial load
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (initialLoadRef.current && currentFolder && videos.length === 0 && !isLoadingVideos) {
      initialLoadRef.current = false;
      loadVideosForFolder(currentFolder);
    }
  }, [currentFolder, videos.length, isLoadingVideos, loadVideosForFolder]);

  // Map step names to human-readable labels
  const getStepLabel = (step: string): string => {
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

  // Analyze a single video using CLI
  const handleAnalyzeVideo = useCallback(async (video: VideoItem): Promise<void> => {
    if (!currentFolder || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalyzingVideoPath(video.path);
    setProcessingProgress(null);
    setCurrentSpawnId(null);

    addLogLine(`\x1b[36mStarting analysis of ${video.filename}...\x1b[0m`, 'info');

    return new Promise((resolve) => {
      let hasError = false;
      let wasCancelled = false;

      const handleOutput = (_spawnId: string, line: string): void => {
        addLogLine(line, 'stdout');
      };

      const handleStderr = (_spawnId: string, line: string): void => {
        addLogLine(line, 'stderr');
      };

      const handleJson = (_spawnId: string, event: JsonEvent): void => {
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
          hasError = true;
          addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
        }
      };

      const handleExit = (_spawnId: string, code: number | null, signal: string | null): void => {
        cleanupListeners();

        // Check if the process was killed (SIGTERM)
        if (signal === 'SIGTERM') {
          wasCancelled = true;
          addLogLine(`\x1b[33mCancelled by user\x1b[0m`, 'info');
        }

        setIsAnalyzing(false);
        setAnalyzingVideoPath(null);
        setProcessingProgress(null);
        setCurrentSpawnId(null);

        // Refresh video list to get updated status
        if (currentFolder) {
          // Re-scan to get updated status
          scanFolder(currentFolder).then((result) => {
            if (result) {
              // Update video list with new statuses
              setVideos((prev) => prev.map((v) => {
                const updated = result.videos.find((rv) => rv.path === v.path);
                if (updated) {
                  return {
                    ...v,
                    status: updated.status as VideoItem['status'],
                    errorMessage: updated.errorMessage,
                  };
                }
                return v;
              }));

              // Update selected video if it was the one being analyzed
              if (selectedVideo?.path === video.path) {
                const updatedVideo = result.videos.find((rv) => rv.path === video.path);
                if (updatedVideo) {
                  setSelectedVideo((prev) => prev ? {
                    ...prev,
                    status: updatedVideo.status as VideoItem['status'],
                    errorMessage: updatedVideo.errorMessage,
                  } : null);
                }
              }
            }
          });
        }

        if (!wasCancelled && (code !== 0 || hasError)) {
          addLogLine(`\x1b[31mAnalysis failed with exit code ${code}\x1b[0m`, 'error');
        }

        resolve();
      };

      // Set up listeners
      const cleanupStdout = window.electronAPI?.cli.onStdout(handleOutput);
      const cleanupStderr = window.electronAPI?.cli.onStderr(handleStderr);
      const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
      const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

      const cleanupListeners = (): void => {
        cleanupStdout?.();
        cleanupStderr?.();
        cleanupJson?.();
        cleanupExit?.();
      };

      // Spawn the process command
      window.electronAPI?.cli
        .spawn(['process', video.path], { json: true })
        .then((result) => {
          setCurrentSpawnId(result.spawnId);
        })
        .catch((err: Error) => {
          addLogLine(`\x1b[31mError:\x1b[0m Failed to start analysis: ${err.message}`, 'error');
          cleanupListeners();
          setIsAnalyzing(false);
          setAnalyzingVideoPath(null);
          setProcessingProgress(null);
          setCurrentSpawnId(null);
          resolve();
        });
    });
  }, [currentFolder, isAnalyzing, addLogLine, scanFolder, selectedVideo]);

  // Handle cancel button click - show confirmation modal
  const handleCancelClick = useCallback(() => {
    setCancelConfirmation({ open: true });
  }, []);

  // Handle cancel confirmation - kill the process
  const handleConfirmCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });

    if (currentSpawnId) {
      addLogLine(`\x1b[33mCancelling analysis...\x1b[0m`, 'info');
      await window.electronAPI?.cli.kill(currentSpawnId);
    }
  }, [currentSpawnId, addLogLine]);

  // Handle cancel modal close
  const handleCloseCancelModal = useCallback(() => {
    setCancelConfirmation({ open: false });
  }, []);

  // Process a single video in batch mode (returns success/error status)
  const processSingleVideoInBatch = useCallback(async (video: VideoItem): Promise<{ success: boolean; error?: string }> => {
    if (!currentFolder) return { success: false, error: 'No folder selected' };

    return new Promise((resolve) => {
      let hasError = false;
      let errorMessage = '';
      let wasCancelled = false;

      const handleOutput = (_spawnId: string, line: string): void => {
        addLogLine(line, 'stdout');
      };

      const handleStderr = (_spawnId: string, line: string): void => {
        addLogLine(line, 'stderr');
      };

      const handleJson = (_spawnId: string, event: JsonEvent): void => {
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
          hasError = true;
          errorMessage = event.error || event.message || 'Unknown error';
          addLogLine(`\x1b[31mError:\x1b[0m ${errorMessage}`, 'error');
        }
      };

      const handleExit = (_spawnId: string, code: number | null, signal: string | null): void => {
        cleanupListeners();

        if (signal === 'SIGTERM') {
          wasCancelled = true;
          addLogLine(`\x1b[33mCancelled by user\x1b[0m`, 'info');
        }

        setProcessingProgress(null);
        setCurrentSpawnId(null);

        if (wasCancelled) {
          resolve({ success: false, error: 'Cancelled by user' });
        } else if (code !== 0 || hasError) {
          resolve({ success: false, error: errorMessage || `Exit code ${code}` });
        } else {
          resolve({ success: true });
        }
      };

      const cleanupStdout = window.electronAPI?.cli.onStdout(handleOutput);
      const cleanupStderr = window.electronAPI?.cli.onStderr(handleStderr);
      const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
      const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

      const cleanupListeners = (): void => {
        cleanupStdout?.();
        cleanupStderr?.();
        cleanupJson?.();
        cleanupExit?.();
      };

      window.electronAPI?.cli
        .spawn(['process', video.path], { json: true })
        .then((result) => {
          setCurrentSpawnId(result.spawnId);
        })
        .catch((err: Error) => {
          addLogLine(`\x1b[31mError:\x1b[0m Failed to start analysis: ${err.message}`, 'error');
          cleanupListeners();
          resolve({ success: false, error: err.message });
        });
    });
  }, [currentFolder, addLogLine]);

  // Handle batch analysis of all pending videos
  const handleBatchAnalyze = useCallback(async (): Promise<void> => {
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

    // Refresh video list
    if (currentFolder) {
      const scanResult = await scanFolder(currentFolder);
      if (scanResult) {
        setVideos((prev) => prev.map((v) => {
          const updated = scanResult.videos.find((rv) => rv.path === v.path);
          if (updated) {
            return {
              ...v,
              status: updated.status as VideoItem['status'],
              errorMessage: updated.errorMessage,
            };
          }
          return v;
        }));
      }
    }

    // Show summary dialog
    setBatchResults(results);
    setShowBatchSummary(true);
  }, [currentFolder, isAnalyzing, isBatchProcessing, videos, addLogLine, processSingleVideoInBatch, scanFolder]);

  // Handle batch cancel button click
  const handleBatchCancelClick = useCallback(() => {
    setCancelConfirmation({ open: true, isBatch: true });
  }, []);

  // Handle batch cancel confirmation
  const handleConfirmBatchCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });
    batchCancelledRef.current = true;

    if (currentSpawnId) {
      addLogLine(`\x1b[33mCancelling current video and stopping batch...\x1b[0m`, 'info');
      await window.electronAPI?.cli.kill(currentSpawnId);
    }
  }, [currentSpawnId, addLogLine]);

  // Close batch summary dialog
  const handleCloseBatchSummary = useCallback(() => {
    setShowBatchSummary(false);
    setBatchResults([]);
  }, []);

  // Handle video selection
  const handleSelectVideo = useCallback((video: VideoItem) => {
    setSelectedVideo(video);
  }, []);

  // Handle folder selection
  const handleOpenFolder = useCallback(async () => {
    const selectedPath = await window.electronAPI?.folder.showPicker();
    if (!selectedPath) return;

    // Check for nested databases
    const result = await checkFolderForNestedDbs(selectedPath);

    if (!result.valid && result.nestedPaths.length > 0) {
      // Show error modal with nested paths
      setNestedDbError({ open: true, paths: result.nestedPaths });
      return;
    }

    if (!result.valid) {
      // Check failed for other reasons
      addLogLine(`\x1b[31mFailed to validate folder.\x1b[0m`, 'error');
      return;
    }

    // Folder is valid, set it as current
    await window.electronAPI?.folder.setCurrent(selectedPath);
    setCurrentFolder(selectedPath);
    setRecentFolders(await window.electronAPI?.folder.getRecent() || []);
    addLogLine(`\x1b[32m✓\x1b[0m Opened folder: ${selectedPath}`, 'success');

    // Load videos for the folder
    await loadVideosForFolder(selectedPath);
  }, [checkFolderForNestedDbs, addLogLine, loadVideosForFolder]);

  // Handle selecting a recent folder
  const handleSelectRecentFolder = useCallback(
    async (folderPath: string) => {
      setShowRecentMenu(false);

      // Check for nested databases
      const result = await checkFolderForNestedDbs(folderPath);

      if (!result.valid && result.nestedPaths.length > 0) {
        setNestedDbError({ open: true, paths: result.nestedPaths });
        return;
      }

      if (!result.valid) {
        addLogLine(`\x1b[31mFailed to validate folder.\x1b[0m`, 'error');
        return;
      }

      await window.electronAPI?.folder.setCurrent(folderPath);
      setCurrentFolder(folderPath);
      setRecentFolders(await window.electronAPI?.folder.getRecent() || []);
      addLogLine(`\x1b[32m✓\x1b[0m Opened folder: ${folderPath}`, 'success');

      // Load videos for the folder
      await loadVideosForFolder(folderPath);
    },
    [checkFolderForNestedDbs, addLogLine, loadVideosForFolder]
  );

  // Close nested DB error dialog
  const handleCloseNestedDbError = useCallback(() => {
    setNestedDbError({ open: false, paths: [] });
  }, []);

  // Get folder display name (last path component)
  const getFolderName = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  };

  // Count pending videos for "Analyze All" button
  const pendingVideosCount = videos.filter((v) =>
    v.status === 'pending' || v.status === 'not_tracked'
  ).length;

  // Sidebar content
  const sidebarContent = currentFolder ? (
    <div className="flex flex-col h-full">
      {/* Folder header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm truncate" title={currentFolder}>
            {getFolderName(currentFolder)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate" title={currentFolder}>
          {currentFolder}
        </p>
        {isGeneratingThumbnails && (
          <p className="text-xs text-muted-foreground animate-pulse">
            Generating thumbnails...
          </p>
        )}
        {/* Analyze All button */}
        {pendingVideosCount > 0 && !isBatchProcessing && !isAnalyzing && (
          <Button
            size="sm"
            className="w-full"
            onClick={handleBatchAnalyze}
          >
            <Play className="h-4 w-4 mr-2" />
            Analyze All ({pendingVideosCount})
          </Button>
        )}
        {/* Batch progress indicator in sidebar */}
        {isBatchProcessing && batchProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Processing {batchProgress.currentIndex} of {batchProgress.totalCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-destructive hover:text-destructive"
                onClick={handleBatchCancelClick}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Stop
              </Button>
            </div>
            <Progress value={(batchProgress.currentIndex / batchProgress.totalCount) * 100} className="h-1.5" />
            <p className="text-xs text-muted-foreground truncate">
              {batchProgress.currentVideo.filename}
            </p>
          </div>
        )}
      </div>
      {/* Video list */}
      <div className="flex-1 min-h-0">
        <VideoList
          videos={videos}
          selectedVideoPath={selectedVideo?.path || null}
          onSelectVideo={handleSelectVideo}
          isLoading={isLoadingVideos}
        />
      </div>
    </div>
  ) : (
    <div className="p-4 space-y-2">
      <p className="text-sm text-muted-foreground">No folder selected</p>
      <p className="text-xs text-muted-foreground">
        Click "Open Folder" to select a video folder.
      </p>
    </div>
  );

  // Main content
  const mainContent = (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-6 py-3 bg-card border-b border-border">
        <h1 className="text-lg font-semibold">AI Video Cataloger</h1>
        {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {/* Open Folder button with recent folders dropdown */}
          <div className="relative">
            <div className="flex">
              <Button
                size="sm"
                onClick={handleOpenFolder}
                disabled={isCheckingFolder}
                className="rounded-r-none"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {isCheckingFolder ? 'Checking...' : 'Open Folder'}
              </Button>
              {recentFolders.length > 0 && (
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  onClick={() => setShowRecentMenu(!showRecentMenu)}
                  disabled={isCheckingFolder}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </div>
            {/* Recent folders dropdown */}
            {showRecentMenu && recentFolders.length > 0 && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-md shadow-lg z-50">
                <div className="p-2">
                  <p className="text-xs font-medium text-muted-foreground px-2 pb-2">
                    Recent Folders
                  </p>
                  {recentFolders.map((folder, index) => (
                    <button
                      key={index}
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm truncate"
                      onClick={() => handleSelectRecentFolder(folder)}
                      title={folder}
                    >
                      {getFolderName(folder)}
                      <span className="block text-xs text-muted-foreground truncate">
                        {folder}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button variant="ghost" size="sm">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content area */}
      <main className="flex-1 overflow-hidden">
        {selectedVideo && currentFolder ? (
          <div className="flex flex-col h-full">
            {/* Progress bar overlay when analyzing */}
            {isAnalyzing && analyzingVideoPath === selectedVideo.path && processingProgress && (
              <div className="px-6 py-3 bg-card border-b border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">
                      {getStepLabel(processingProgress.step)}
                    </span>
                    <span className="text-muted-foreground">
                      (Step {processingProgress.stepNumber} of {processingProgress.totalSteps})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-primary">
                      {processingProgress.percentage}%
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancelClick}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
                <Progress value={processingProgress.percentage} />
              </div>
            )}
            <VideoDetails
              video={selectedVideo}
              currentFolder={currentFolder}
              onAnalyze={handleAnalyzeVideo}
              isAnalyzing={isAnalyzing && analyzingVideoPath === selectedVideo.path}
              className="flex-1 min-h-0"
            />
          </div>
        ) : (
          <div className="p-6 overflow-auto scrollbar-macos h-full">
            <div className="max-w-3xl space-y-6">
              {/* Welcome message */}
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">Welcome to AI Video Cataloger</h2>
                <p className="text-muted-foreground">
                  Select a folder containing videos to get started. The app will analyze your videos
                  using AI to generate summaries, transcriptions, and smart file names.
                </p>
              </div>

              {/* Instructions */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <h3 className="font-medium">Getting Started</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Click "Open Folder" to select a folder with video files</li>
                  <li>The sidebar will show all detected videos</li>
                  <li>Select a video to view details and analysis results</li>
                  <li>Click "Analyze" to process individual videos</li>
                  <li>Terminal output shows real-time progress</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );

  // Terminal content
  const terminalContent = (
    <TerminalLog lines={logLines} onClear={handleClear} className="h-full" showHeader={false} />
  );

  // Close recent menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest('.relative')) {
        setShowRecentMenu(false);
      }
    };
    if (showRecentMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showRecentMenu]);

  return (
    <>
      <AppLayout
        sidebar={sidebarContent}
        content={mainContent}
        terminal={terminalContent}
        terminalCollapsed={terminalCollapsed}
        onTerminalCollapsedChange={setTerminalCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onTerminalClear={handleClear}
        onTerminalCopy={handleCopy}
      />

      {/* Nested Database Error Dialog */}
      <AlertDialog open={nestedDbError.open} onOpenChange={(open) => !open && handleCloseNestedDbError()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Nested Databases Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The selected folder contains nested <code className="bg-muted px-1 py-0.5 rounded">.ai-video-cataloger</code> folders.
                  This can cause data conflicts and unexpected behavior.
                </p>
                <p>Please remove or merge these nested databases before continuing:</p>
                <div className="bg-muted rounded-md p-3 max-h-40 overflow-auto">
                  <ul className="text-sm space-y-1 font-mono">
                    {nestedDbError.paths.map((path, index) => (
                      <li key={index} className="truncate" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseNestedDbError}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Processing Confirmation Dialog */}
      <AlertDialog open={cancelConfirmation.open} onOpenChange={(open) => !open && handleCloseCancelModal()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              {cancelConfirmation.isBatch ? 'Cancel Batch Processing?' : 'Cancel Processing?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                {cancelConfirmation.isBatch ? (
                  <>
                    <p>
                      Are you sure you want to cancel the batch analysis?
                      This will stop after the current video finishes processing.
                    </p>
                    <p className="text-amber-600">
                      Warning: The current video may be left in an incomplete state.
                      Already processed videos will keep their results.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Are you sure you want to cancel the current video analysis?
                    </p>
                    <p className="text-amber-600">
                      Warning: This may leave the video in an incomplete state.
                      Partial data (extracted frames, audio, etc.) may remain and you may need to
                      re-analyze the video from the beginning.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCloseCancelModal}>
              Continue Processing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={cancelConfirmation.isBatch ? handleConfirmBatchCancel : handleConfirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelConfirmation.isBatch ? 'Stop Batch' : 'Cancel Analysis'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Summary Dialog */}
      <AlertDialog open={showBatchSummary} onOpenChange={(open) => !open && handleCloseBatchSummary()}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Batch Analysis Complete
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                {/* Summary stats */}
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm">
                      <span className="font-medium text-foreground">{batchResults.filter((r) => r.success).length}</span>
                      {' '}successful
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XOctagon className="h-4 w-4 text-red-600" />
                    <span className="text-sm">
                      <span className="font-medium text-foreground">{batchResults.filter((r) => !r.success).length}</span>
                      {' '}failed
                    </span>
                  </div>
                </div>

                {/* Failed videos list */}
                {batchResults.filter((r) => !r.success).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Failed videos:</p>
                    <div className="bg-muted rounded-md p-3 max-h-40 overflow-auto">
                      <ul className="text-sm space-y-2">
                        {batchResults.filter((r) => !r.success).map((result, index) => (
                          <li key={index} className="space-y-0.5">
                            <div className="font-medium truncate" title={result.video.filename}>
                              {result.video.filename}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {result.error || 'Unknown error'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseBatchSummary}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default App;
