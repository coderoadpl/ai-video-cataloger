/**
 * Main App Component
 */
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.js';
import VideoDetails from './components/VideoDetails.js';
import Toolbar from './components/Toolbar.js';
import PrerequisitesPanel from './components/PrerequisitesPanel.js';
import ModelManagerPanel from './components/ModelManagerPanel.js';
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
  } | null>(null);
  const [isPrerequisitesPanelOpen, setIsPrerequisitesPanelOpen] = useState(false);
  const [isModelManagerPanelOpen, setIsModelManagerPanelOpen] = useState(false);

  // For single selection display (VideoDetails), use the first selected or last clicked
  const selectedVideo = selectedVideoIds.length > 0
    ? videos.find((v) => v.id === selectedVideoIds[selectedVideoIds.length - 1]) || null
    : null;

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
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: 1, step: 'Starting...' });

    const result = await window.electronAPI.processVideo(videoId);

    setIsProcessing(false);
    setProcessingProgress(null);

    if (!result.success) {
      console.error('Processing failed:', result.error);
    }
  }, []);

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

    const videoIds = unprocessedVideos.map((v) => v.id);
    await window.electronAPI.processBatch(videoIds);

    setIsProcessing(false);
    setProcessingProgress(null);
  }, [videos]);

  // Handle cancel processing
  const handleCancel = useCallback(async () => {
    await window.electronAPI.cancelProcessing();
    setIsProcessing(false);
    setProcessingProgress(null);
  }, []);

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

    return () => {
      unsubscribeOpenFolder();
      unsubscribeRefresh();
      unsubscribeOpenPrerequisites();
      unsubscribeOpenModelManager();
    };
  }, [handleSelectFolder, handleRefresh]);

  // Listen for processing progress
  useEffect(() => {
    const unsubscribeProgress = window.electronAPI.onProcessingProgress((progress) => {
      setProcessingProgress((prev) => ({
        current: prev?.current ?? 0,
        total: prev?.total ?? 1,
        step: progress.step,
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
          v.id === error.videoId ? { ...v, status: 'error' as const, errorMessage: error.error } : v
        )
      );
    });

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
      unsubscribeError();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar
        currentFolder={currentFolder}
        onSelectFolder={handleSelectFolder}
        onSelectRecentFolder={handleSelectRecentFolder}
        onAnalyzeAll={handleAnalyzeAll}
        onCancel={handleCancel}
        onRefresh={handleRefresh}
        isProcessing={isProcessing}
        processingProgress={processingProgress}
        hasUnprocessedVideos={videos.some((v) => v.status === 'none')}
        hasErrors={videos.some((v) => v.status === 'error')}
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
    </div>
  );
}

export default App;
