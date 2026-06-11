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
import { AppLayout, TERMINAL_DEFAULT_SIZE } from '@/components/layout';
import { VideoList, VideoItem } from '@/components/video-list';
import { VideoDetails } from '@/components/video-details';
import { FolderOpen, Settings, HelpCircle, AlertTriangle, ChevronDown, Folder, Loader2, XCircle, Play, CheckCircle2, XOctagon, HardDrive } from 'lucide-react';
import { SettingsModal } from '@/components/settings-modal';
import { ModelManagerModal } from '@/components/model-manager-modal';
import { PrerequisitesModal } from '@/components/prerequisites-modal';
import { useCliCommand } from '@/hooks/use-cli-command';
import { useCatalog, keyOf } from '@/hooks/use-catalog';

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

// LocalStorage keys for persisting UI state
const STORAGE_KEY_TERMINAL_COLLAPSED = 'ai-video-cataloger:terminal-collapsed';
const STORAGE_KEY_TERMINAL_SIZE = 'ai-video-cataloger:terminal-size';

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV;

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  // Terminal collapsed: default to collapsed in production, open in development
  // Also check localStorage for user preference
  const [terminalCollapsed, setTerminalCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TERMINAL_COLLAPSED);
    if (stored !== null) {
      return stored === 'true';
    }
    // Default: collapsed in production, open in development
    return !isDevelopment;
  });

  // Terminal size from localStorage
  const [terminalSize, setTerminalSize] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TERMINAL_SIZE);
    if (stored !== null) {
      const size = parseInt(stored, 10);
      if (!isNaN(size)) {
        return size;
      }
    }
    return TERMINAL_DEFAULT_SIZE;
  });

  const [showJson, setShowJson] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [nestedDbError, setNestedDbError] = useState<NestedDbError>({ open: false, paths: [] });
  const [showRecentMenu, setShowRecentMenu] = useState(false);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const thumbnailGenerationRef = useRef<{ cancelled: boolean }>({ cancelled: false });
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
  const [showSettings, setShowSettings] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);
  const [showPrerequisites, setShowPrerequisites] = useState(false);

  // Load initial state
  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
    window.electronAPI?.folder.getRecent().then(setRecentFolders).catch(console.error);
    window.electronAPI?.folder.getCurrent().then(setCurrentFolder).catch(console.error);
  }, []);

  // Save terminal collapsed state to localStorage
  const handleTerminalCollapsedChange = useCallback((collapsed: boolean) => {
    setTerminalCollapsed(collapsed);
    localStorage.setItem(STORAGE_KEY_TERMINAL_COLLAPSED, String(collapsed));
  }, []);

  // Save terminal size to localStorage (debounced via effect)
  const handleTerminalSizeChange = useCallback((size: number) => {
    setTerminalSize(size);
  }, []);

  // Debounce saving terminal size to avoid too many writes
  useEffect(() => {
    const timeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY_TERMINAL_SIZE, String(terminalSize));
    }, 300);
    return () => clearTimeout(timeout);
  }, [terminalSize]);

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

  // CLI access and the catalog (videos + selection derived from CLI scan output)
  const runCli = useCliCommand();
  const {
    videos,
    selectedVideo,
    selectKey,
    refresh,
    isLoading: isLoadingVideos,
  } = useCatalog(currentFolder, runCli, addLogLine);

  // Check folder for nested databases using CLI
  const checkFolderForNestedDbs = useCallback(
    async (folderPath: string): Promise<{ valid: boolean; nestedPaths: string[] }> => {
      setIsCheckingFolder(true);
      addLogLine(`\x1b[36mChecking folder for nested databases...\x1b[0m`, 'info');

      try {
        const { code, events } = await runCli(['check', folderPath], {
          onJson: (event) => {
            if (event.type === 'error') {
              addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
            }
          },
          onLine: (line, source) => addLogLine(line, source),
        });

        const completed = events.find((event) => event.type === 'completed' && event.data);
        const paths = completed?.data?.nestedDatabases;
        const nestedPaths = Array.isArray(paths) ? (paths as string[]) : [];
        const hasError = events.some((event) => event.type === 'error');

        if (hasError || code !== 0) {
          return { valid: false, nestedPaths };
        }
        return { valid: true, nestedPaths: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLogLine(`\x1b[31mError:\x1b[0m Failed to run check: ${message}`, 'error');
        return { valid: false, nestedPaths: [] };
      } finally {
        setIsCheckingFolder(false);
      }
    },
    [addLogLine, runCli]
  );

  // Generate thumbnails for videos that don't have one yet, then refresh once
  // so the new thumbnail artifacts (paths + mtimes) appear in the catalog.
  const generateMissingThumbnails = useCallback(
    async (items: VideoItem[], generation: { cancelled: boolean }): Promise<void> => {
      const missing = items.filter((video) => video.artifacts.thumbnailPath == null);
      if (missing.length === 0) {
        return;
      }

      setIsGeneratingThumbnails(true);
      addLogLine(`\x1b[36mGenerating thumbnails...\x1b[0m`, 'info');

      let generatedCount = 0;
      for (const video of missing) {
        if (generation.cancelled) {
          addLogLine(`\x1b[33mThumbnail generation cancelled\x1b[0m`, 'info');
          break;
        }

        try {
          const { code, events } = await runCli(['thumbnail', video.path], {
            onJson: (event) => {
              if (event.type === 'error') {
                addLogLine(`\x1b[31mThumbnail error:\x1b[0m ${event.error || event.message}`, 'error');
              }
            },
            onLine: (line, source) => addLogLine(line, source),
          });
          if (code === 0 && events.some((event) => event.type === 'completed')) {
            generatedCount++;
          }
        } catch {
          // Spawn failed - skip this video and continue with the rest
        }
      }

      if (!generation.cancelled) {
        setIsGeneratingThumbnails(false);
        if (generatedCount > 0) {
          addLogLine(`\x1b[32m✓\x1b[0m Generated ${generatedCount} thumbnail(s)`, 'success');
          // Single refresh at the end of the loop picks up all new thumbnails
          await refresh();
        } else {
          addLogLine(`\x1b[32m✓\x1b[0m Thumbnails loaded`, 'success');
        }
      }
    },
    [runCli, addLogLine, refresh]
  );

  // Load videos for a folder: one wholesale refresh, then background thumbnails
  const loadVideosForFolder = useCallback(
    async (folderPath: string, preserveSelectionByHash?: string | null) => {
      // Cancel any ongoing thumbnail generation
      thumbnailGenerationRef.current.cancelled = true;
      thumbnailGenerationRef.current = { cancelled: false };
      const currentGeneration = thumbnailGenerationRef.current;

      const items = await refresh({
        folder: folderPath,
        selectKey: preserveSelectionByHash ?? null,
      });
      if (!items || items.length === 0) {
        return;
      }

      await generateMissingThumbnails(items, currentGeneration);
    },
    [refresh, generateMissingThumbnails]
  );

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
  const handleCancelClick = useCallback(() => {
    setCancelConfirmation({ open: true });
  }, []);

  // Handle cancel confirmation - abort the running command (kills the process)
  const handleConfirmCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });

    if (analyzeAbortRef.current) {
      addLogLine(`\x1b[33mCancelling analysis...\x1b[0m`, 'info');
      analyzeAbortRef.current.abort();
    }
  }, [addLogLine]);

  // Handle cancel modal close
  const handleCloseCancelModal = useCallback(() => {
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

    // Refresh video list - replaced wholesale with the new scan result
    await refresh();

    // Show summary dialog
    setBatchResults(results);
    setShowBatchSummary(true);
  }, [currentFolder, isAnalyzing, isBatchProcessing, videos, addLogLine, processSingleVideoInBatch, refresh]);

  // Handle batch cancel button click
  const handleBatchCancelClick = useCallback(() => {
    setCancelConfirmation({ open: true, isBatch: true });
  }, []);

  // Handle batch cancel confirmation
  const handleConfirmBatchCancel = useCallback(async () => {
    setCancelConfirmation({ open: false });
    batchCancelledRef.current = true;

    if (analyzeAbortRef.current) {
      addLogLine(`\x1b[33mCancelling current video and stopping batch...\x1b[0m`, 'info');
      analyzeAbortRef.current.abort();
    }
  }, [addLogLine]);

  // Close batch summary dialog
  const handleCloseBatchSummary = useCallback(() => {
    setShowBatchSummary(false);
    setBatchResults([]);
  }, []);

  // Handle video selection (by stable key, so the item is always the
  // up-to-date entry from the current scan)
  const handleSelectVideo = useCallback((video: VideoItem) => {
    selectKey(keyOf(video));
  }, [selectKey]);

  // Memoized log message handler for modals
  const handleModalLogMessage = useCallback((message: string, type?: 'info' | 'success' | 'error') => {
    const prefix = type === 'success' ? '\x1b[32m✓\x1b[0m ' : type === 'error' ? '\x1b[31m✗\x1b[0m ' : '\x1b[36m';
    const suffix = type === 'info' ? '\x1b[0m' : '';
    addLogLine(`${prefix}${message}${suffix}`, type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
  }, [addLogLine]);

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

  // Listen for menu events from main process
  useEffect(() => {
    const cleanupOpenFolder = window.menuAPI?.onOpenFolder(() => {
      handleOpenFolder();
    });

    const cleanupOpenRecentFolder = window.menuAPI?.onOpenRecentFolder((folderPath: string) => {
      handleSelectRecentFolder(folderPath);
    });

    const cleanupClearRecentFolders = window.menuAPI?.onClearRecentFolders(async () => {
      await window.electronAPI?.folder.clearRecent();
      setRecentFolders([]);
      setCurrentFolder(null);
      // Clearing the folder clears the catalog (videos + selection)
      await refresh({ folder: null });
      addLogLine('\x1b[32m✓\x1b[0m Recent folders cleared', 'success');
    });

    const cleanupToggleTerminal = window.menuAPI?.onToggleTerminal(() => {
      setTerminalCollapsed((prev) => {
        const newValue = !prev;
        localStorage.setItem(STORAGE_KEY_TERMINAL_COLLAPSED, String(newValue));
        return newValue;
      });
    });

    const cleanupToggleSidebar = window.menuAPI?.onToggleSidebar(() => {
      setSidebarCollapsed((prev) => !prev);
    });

    const cleanupShowSettings = window.menuAPI?.onShowSettings(() => {
      setShowSettings(true);
    });

    const cleanupShowPrerequisites = window.menuAPI?.onShowPrerequisites(() => {
      setShowPrerequisites(true);
    });

    const cleanupShowModelManager = window.menuAPI?.onShowModelManager(() => {
      setShowModelManager(true);
    });

    return () => {
      cleanupOpenFolder?.();
      cleanupOpenRecentFolder?.();
      cleanupClearRecentFolders?.();
      cleanupToggleTerminal?.();
      cleanupToggleSidebar?.();
      cleanupShowSettings?.();
      cleanupShowPrerequisites?.();
      cleanupShowModelManager?.();
    };
  }, [handleOpenFolder, handleSelectRecentFolder, addLogLine, refresh]);

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
          analyzingVideoPath={analyzingVideoPath}
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
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowModelManager(true)}>
            <HardDrive className="h-4 w-4 mr-2" />
            Models
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPrerequisites(true)} title="System Prerequisites">
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

  // Filter JSON lines based on showJson setting
  const isJsonLine = (content: string): boolean => {
    const trimmed = content.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}');
  };
  const filteredLogLines = showJson ? logLines : logLines.filter(line => !isJsonLine(line.content));

  // Terminal content
  const terminalContent = (
    <TerminalLog lines={filteredLogLines} onClear={handleClear} className="h-full" showHeader={false} />
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
        onTerminalCollapsedChange={handleTerminalCollapsedChange}
        terminalSize={terminalSize}
        onTerminalSizeChange={handleTerminalSizeChange}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onTerminalClear={handleClear}
        onTerminalCopy={handleCopy}
        showJson={showJson}
        onShowJsonChange={setShowJson}
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

      {/* Settings Modal */}
      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        currentFolder={currentFolder}
        onConfigSaved={() => {
          addLogLine('\x1b[32m✓\x1b[0m Settings saved', 'success');
        }}
      />

      {/* Model Manager Modal */}
      <ModelManagerModal
        open={showModelManager}
        onOpenChange={setShowModelManager}
        onLogMessage={handleModalLogMessage}
      />

      {/* Prerequisites Modal */}
      <PrerequisitesModal
        open={showPrerequisites}
        onOpenChange={setShowPrerequisites}
        onLogMessage={handleModalLogMessage}
      />
    </>
  );
}

export default App;
