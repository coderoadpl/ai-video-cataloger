/**
 * Main App Component
 */
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.js';
import VideoDetails from './components/VideoDetails.js';
import Toolbar from './components/Toolbar.js';
import PrerequisitesPanel from './components/PrerequisitesPanel.js';
import ModelManagerPanel from './components/ModelManagerPanel.js';
import SettingsPanel from './components/SettingsPanel.js';
import './styles/App.css';

// Video file type definition
export interface VideoFile {
  id: number;
  filename: string;
  path: string;
  size: number;
  duration?: number;
  modifiedDate: Date;
  status: 'none' | 'processing' | 'completed' | 'error';
  thumbnail?: string;
  summary?: string;
  transcript?: string;
  suggestedName?: string;
  frames?: string[];
  framesDir?: string;
  transcriptPath?: string;
  errorMessage?: string;
  errorStep?: 'frame_extraction' | 'audio_extraction' | 'transcription' | 'analysis';
  analysisMethod?: string;
  processedAt?: Date;
}

function App(): React.ReactElement {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{
    current: number;
    total: number;
    step: string;
    videoName?: string;
  } | null>(null);
  const [batchNotification, setBatchNotification] = useState<{
    show: boolean;
    success: boolean;
    successCount: number;
    failureCount: number;
    totalVideos: number;
    cancelled: boolean;
  } | null>(null);
  const [isPrerequisitesPanelOpen, setIsPrerequisitesPanelOpen] = useState(false);
  const [isModelManagerPanelOpen, setIsModelManagerPanelOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);

  // For single selection display (VideoDetails), use the first selected or last clicked
  const selectedVideo = selectedVideoIds.length > 0
    ? videos.find((v) => v.id === selectedVideoIds[selectedVideoIds.length - 1]) || null
    : null;

  // Count selected unprocessed videos for batch processing
  const selectedUnprocessedCount = videos.filter(
    (v) => selectedVideoIds.includes(v.id) && v.status === 'none'
  ).length;

  // Restore last used folder on app launch
  useEffect(() => {
    const restoreLastFolder = async () => {
      const lastFolder = await window.electronAPI.getLastFolder();
      if (lastFolder) {
        setCurrentFolder(lastFolder);
        const scannedVideos = await window.electronAPI.scanFolder(lastFolder);
        setVideos(scannedVideos as VideoFile[]);
      }
    };
    restoreLastFolder();
  }, []);

  // Handle folder selection via dialog
  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      setCurrentFolder(folderPath);
      setSelectedVideoIds([]);
      const scannedVideos = await window.electronAPI.scanFolder(folderPath);
      setVideos(scannedVideos as VideoFile[]);
    }
  }, []);

  // Handle selecting a folder from recent list
  const handleSelectRecentFolder = useCallback(async (folderPath: string) => {
    // Update folder history in store
    await window.electronAPI.setCurrentFolder(folderPath);
    setCurrentFolder(folderPath);
    setSelectedVideoIds([]);
    const scannedVideos = await window.electronAPI.scanFolder(folderPath);
    setVideos(scannedVideos as VideoFile[]);
  }, []);

  // Handle video selection (supports multi-select with Cmd/Ctrl+click)
  const handleSelectVideo = useCallback((videoId: number, multiSelect: boolean) => {
    if (multiSelect) {
      setSelectedVideoIds((prev) => {
        if (prev.includes(videoId)) {
          // Deselect if already selected
          return prev.filter((id) => id !== videoId);
        } else {
          // Add to selection
          return [...prev, videoId];
        }
      });
    } else {
      // Single click - replace selection
      setSelectedVideoIds([videoId]);
    }
  }, []);

  // Handle analyze single video
  const handleAnalyze = useCallback(async (videoId: number) => {
    // Find the video by ID to get its path
    const video = videos.find((v) => v.id === videoId);
    if (!video) {
      console.error('Video not found:', videoId);
      return;
    }

    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: 1, step: 'Starting...' });

    // Update the video status to processing immediately
    setVideos((prevVideos) =>
      prevVideos.map((v) => (v.id === videoId ? { ...v, status: 'processing' as const } : v))
    );

    const result = await window.electronAPI.processVideo(video.path);

    setIsProcessing(false);
    setProcessingProgress(null);

    if (!result.success) {
      console.error('Processing failed:', result.error);
      // Update video to error state
      setVideos((prevVideos) =>
        prevVideos.map((v) =>
          v.id === videoId
            ? {
                ...v,
                status: 'error' as const,
                errorMessage: result.error,
                errorStep: result.errorStep as VideoFile['errorStep'],
              }
            : v
        )
      );
    } else {
      // Rescan the folder to get updated video data
      if (currentFolder) {
        const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
        setVideos(scannedVideos as VideoFile[]);
      }
    }
  }, [videos, currentFolder]);

  // Handle analyze all unprocessed videos
  const handleAnalyzeAll = useCallback(async () => {
    const unprocessedVideos = videos.filter((v) => v.status === 'none');
    if (unprocessedVideos.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress({
      current: 0,
      total: unprocessedVideos.length,
      step: 'Starting...',
    });

    // Mark all videos as processing
    const videoPaths = unprocessedVideos.map((v) => v.path);
    setVideos((prevVideos) =>
      prevVideos.map((v) =>
        videoPaths.includes(v.path) ? { ...v, status: 'processing' as const } : v
      )
    );

    await window.electronAPI.processBatch(videoPaths);

    // Processing complete - rescan folder to get updated data
    if (currentFolder) {
      const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
      setVideos(scannedVideos as VideoFile[]);
    }

    setIsProcessing(false);
    setProcessingProgress(null);
  }, [videos, currentFolder]);

  // Handle analyze selected videos (multiple)
  const handleAnalyzeSelected = useCallback(async () => {
    const selectedUnprocessed = videos.filter(
      (v) => selectedVideoIds.includes(v.id) && v.status === 'none'
    );
    if (selectedUnprocessed.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress({
      current: 0,
      total: selectedUnprocessed.length,
      step: 'Starting...',
    });

    // Mark selected videos as processing
    const videoPaths = selectedUnprocessed.map((v) => v.path);
    setVideos((prevVideos) =>
      prevVideos.map((v) =>
        videoPaths.includes(v.path) ? { ...v, status: 'processing' as const } : v
      )
    );

    await window.electronAPI.processBatch(videoPaths);

    // Processing complete - rescan folder to get updated data
    if (currentFolder) {
      const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
      setVideos(scannedVideos as VideoFile[]);
    }

    setIsProcessing(false);
    setProcessingProgress(null);
  }, [videos, selectedVideoIds, currentFolder]);

  // Handle cancel processing
  const handleCancel = useCallback(async () => {
    await window.electronAPI.cancelProcessing();
    setIsProcessing(false);
    setProcessingProgress(null);

    // Rescan folder to update video statuses based on actual state
    // Videos with partial results will show as 'none' or 'completed' based on what was saved
    if (currentFolder) {
      const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
      setVideos(scannedVideos as VideoFile[]);
    }
  }, [currentFolder]);

  // Handle retry all failed videos
  const handleRetryFailed = useCallback(async () => {
    const failedVideos = videos.filter((v) => v.status === 'error');
    if (failedVideos.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress({
      current: 0,
      total: failedVideos.length,
      step: 'Starting retry...',
    });

    // Mark failed videos as processing
    const videoPaths = failedVideos.map((v) => v.path);
    setVideos((prevVideos) =>
      prevVideos.map((v) =>
        videoPaths.includes(v.path) ? { ...v, status: 'processing' as const, errorMessage: undefined, errorStep: undefined } : v
      )
    );

    await window.electronAPI.processBatch(videoPaths);

    // Processing complete - rescan folder to get updated data
    if (currentFolder) {
      const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
      setVideos(scannedVideos as VideoFile[]);
    }

    setIsProcessing(false);
    setProcessingProgress(null);
  }, [videos, currentFolder]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    if (currentFolder) {
      const scannedVideos = await window.electronAPI.scanFolder(currentFolder);
      setVideos(scannedVideos as VideoFile[]);
    }
  }, [currentFolder]);

  // Listen for menu events
  useEffect(() => {
    const unsubscribeOpenFolder = window.electronAPI.onMenuOpenFolder(handleSelectFolder);
    const unsubscribeRefresh = window.electronAPI.onMenuRefresh(handleRefresh);
    const unsubscribeOpenPrerequisites = window.electronAPI.onMenuOpenPrerequisites(() => {
      setIsPrerequisitesPanelOpen(true);
    });
    const unsubscribeOpenModelManager = window.electronAPI.onMenuOpenModelManager(() => {
      setIsModelManagerPanelOpen(true);
    });
    const unsubscribeOpenSettings = window.electronAPI.onMenuOpenSettings(() => {
      setIsSettingsPanelOpen(true);
    });

    return () => {
      unsubscribeOpenFolder();
      unsubscribeRefresh();
      unsubscribeOpenPrerequisites();
      unsubscribeOpenModelManager();
      unsubscribeOpenSettings();
    };
  }, [handleSelectFolder, handleRefresh]);

  // Listen for processing progress
  useEffect(() => {
    const unsubscribeProgress = window.electronAPI.onProcessingProgress((progress) => {
      setProcessingProgress((prev) => ({
        current: prev?.current ?? 0,
        total: prev?.total ?? 1,
        step: progress.step,
        videoName: prev?.videoName,
      }));

      // Update video status
      setVideos((prevVideos) =>
        prevVideos.map((v) => (v.id === progress.videoId ? { ...v, status: 'processing' as const } : v))
      );
    });

    const unsubscribeComplete = window.electronAPI.onProcessingComplete((result) => {
      setVideos((prevVideos) =>
        prevVideos.map((v) =>
          v.id === result.videoId ? { ...v, status: result.success ? 'completed' : 'error' } : v
        )
      );
    });

    const unsubscribeError = window.electronAPI.onProcessingError((error) => {
      setVideos((prevVideos) =>
        prevVideos.map((v) =>
          v.id === error.videoId
            ? {
                ...v,
                status: 'error' as const,
                errorMessage: error.error,
                errorStep: error.step as VideoFile['errorStep'],
              }
            : v
        )
      );
    });

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
      unsubscribeError();
    };
  }, []);

  // Listen for batch processing events
  useEffect(() => {
    const unsubscribeBatchStart = window.electronAPI.onBatchStart((_info) => {
      // Batch started, progress already set up
    });

    const unsubscribeBatchProgress = window.electronAPI.onBatchProgress((progress) => {
      setProcessingProgress({
        current: progress.currentVideo,
        total: progress.totalVideos,
        step: 'Starting...',
        videoName: progress.videoName,
      });

      // Update the specific video status
      setVideos((prevVideos) =>
        prevVideos.map((v) =>
          v.id === progress.videoId ? { ...v, status: 'processing' as const } : v
        )
      );
    });

    const unsubscribeBatchComplete = window.electronAPI.onBatchComplete((result) => {
      // Show notification
      setBatchNotification({
        show: true,
        success: result.success,
        successCount: result.successCount,
        failureCount: result.failureCount,
        totalVideos: result.totalVideos,
        cancelled: result.cancelled,
      });

      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        setBatchNotification(null);
      }, 5000);
    });

    const unsubscribeBatchCancelled = window.electronAPI.onBatchCancelled((info) => {
      setBatchNotification({
        show: true,
        success: false,
        successCount: info.successCount,
        failureCount: info.failureCount,
        totalVideos: info.totalVideos,
        cancelled: true,
      });

      setTimeout(() => {
        setBatchNotification(null);
      }, 5000);
    });

    return () => {
      unsubscribeBatchStart();
      unsubscribeBatchProgress();
      unsubscribeBatchComplete();
      unsubscribeBatchCancelled();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar
        currentFolder={currentFolder}
        onSelectFolder={handleSelectFolder}
        onSelectRecentFolder={handleSelectRecentFolder}
        onAnalyzeAll={handleAnalyzeAll}
        onAnalyzeSelected={handleAnalyzeSelected}
        onRetryFailed={handleRetryFailed}
        onCancel={handleCancel}
        onRefresh={handleRefresh}
        isProcessing={isProcessing}
        processingProgress={processingProgress}
        hasUnprocessedVideos={videos.some((v) => v.status === 'none')}
        hasErrors={videos.some((v) => v.status === 'error')}
        selectedUnprocessedCount={selectedUnprocessedCount}
      />
      <div className="main-content">
        <Sidebar
          videos={videos}
          selectedVideoIds={selectedVideoIds}
          onSelectVideo={handleSelectVideo}
          currentFolder={currentFolder}
        />
        <VideoDetails
          video={selectedVideo}
          onAnalyze={handleAnalyze}
          isProcessing={isProcessing}
          processingStep={processingProgress?.step}
        />
      </div>

      {/* Modals */}
      <PrerequisitesPanel
        isOpen={isPrerequisitesPanelOpen}
        onClose={() => setIsPrerequisitesPanelOpen(false)}
      />
      <ModelManagerPanel
        isOpen={isModelManagerPanelOpen}
        onClose={() => setIsModelManagerPanelOpen(false)}
      />
      <SettingsPanel
        isOpen={isSettingsPanelOpen}
        onClose={() => setIsSettingsPanelOpen(false)}
        onOpenModelManager={() => {
          setIsSettingsPanelOpen(false);
          setIsModelManagerPanelOpen(true);
        }}
      />

      {/* Batch completion notification */}
      {batchNotification && batchNotification.show && (
        <div className={`batch-notification ${batchNotification.cancelled ? 'cancelled' : batchNotification.success ? 'success' : 'partial'}`}>
          <div className="notification-content">
            <span className="notification-icon">
              {batchNotification.cancelled ? '⏹' : batchNotification.success ? '✓' : '⚠'}
            </span>
            <span className="notification-text">
              {batchNotification.cancelled
                ? `Batch cancelled: ${batchNotification.successCount} completed, ${batchNotification.totalVideos - batchNotification.successCount - batchNotification.failureCount} remaining`
                : batchNotification.success
                ? `Batch complete: ${batchNotification.successCount} videos processed successfully`
                : `Batch complete: ${batchNotification.successCount} succeeded, ${batchNotification.failureCount} failed`}
            </span>
            <button className="notification-close" onClick={() => setBatchNotification(null)}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
