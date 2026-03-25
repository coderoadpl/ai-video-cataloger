/**
 * Toolbar Component
 */
import React, { useState, useEffect, useRef } from 'react';
import '../styles/Toolbar.css';

interface ToolbarProps {
  currentFolder: string | null;
  onSelectFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onAnalyzeAll: () => void;
  onAnalyzeSelected: () => void;
  onRetryFailed: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isProcessing: boolean;
  processingProgress: {
    current: number;
    total: number;
    step: string;
    videoName?: string;
    videoPercent?: number;
  } | null;
  hasUnprocessedVideos: boolean;
  hasErrors: boolean;
  selectedUnprocessedCount: number;
}

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

function Toolbar({
  currentFolder,
  onSelectFolder,
  onSelectRecentFolder,
  onAnalyzeAll,
  onAnalyzeSelected,
  onRetryFailed,
  onCancel,
  onRefresh,
  onOpenSettings,
  isProcessing,
  processingProgress,
  hasUnprocessedVideos,
  hasErrors,
  selectedUnprocessedCount,
}: ToolbarProps): React.ReactElement {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Elapsed time tracking
  const [totalStartTime, setTotalStartTime] = useState<number | null>(null);
  const [videoStartTime, setVideoStartTime] = useState<number | null>(null);
  const [elapsedTotal, setElapsedTotal] = useState(0);
  const [elapsedVideo, setElapsedVideo] = useState(0);

  // Track when processing starts/stops
  useEffect(() => {
    if (isProcessing && !totalStartTime) {
      setTotalStartTime(Date.now());
      setVideoStartTime(Date.now());
    } else if (!isProcessing) {
      setTotalStartTime(null);
      setVideoStartTime(null);
      setElapsedTotal(0);
      setElapsedVideo(0);
    }
  }, [isProcessing, totalStartTime]);

  // Track when current video changes
  useEffect(() => {
    if (isProcessing && processingProgress?.current !== undefined) {
      setVideoStartTime(Date.now());
      setElapsedVideo(0);
    }
  }, [isProcessing, processingProgress?.current]);

  // Update elapsed time every second
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      if (totalStartTime) {
        setElapsedTotal((Date.now() - totalStartTime) / 1000);
      }
      if (videoStartTime) {
        setElapsedVideo((Date.now() - videoStartTime) / 1000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing, totalStartTime, videoStartTime]);

  // Load recent folders
  useEffect(() => {
    const loadRecentFolders = async () => {
      const folders = await window.electronAPI.getRecentFolders();
      setRecentFolders(folders);
    };
    loadRecentFolders();
  }, [currentFolder]); // Reload when current folder changes

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectRecent = (folderPath: string) => {
    setIsDropdownOpen(false);
    onSelectRecentFolder(folderPath);
  };

  const getFolderDisplayName = (folderPath: string): string => {
    return folderPath.split('/').pop() || folderPath;
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="folder-button-group" ref={dropdownRef}>
          <button className="toolbar-button primary" onClick={onSelectFolder}>
            Open Folder
          </button>
          {recentFolders.length > 0 && (
            <button
              className="toolbar-button primary dropdown-toggle"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              title="Recent folders"
            >
              ▼
            </button>
          )}
          {isDropdownOpen && recentFolders.length > 0 && (
            <div className="recent-folders-dropdown">
              <div className="dropdown-header">Recent Folders</div>
              {recentFolders.map((folder) => (
                <button
                  key={folder}
                  className={`dropdown-item ${folder === currentFolder ? 'active' : ''}`}
                  onClick={() => handleSelectRecent(folder)}
                  title={folder}
                >
                  <span className="folder-name">{getFolderDisplayName(folder)}</span>
                  <span className="folder-path">{folder}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {currentFolder && (
          <span className="current-folder" title={currentFolder}>
            {currentFolder.split('/').pop()}
          </span>
        )}
      </div>

      <div className="toolbar-center">
        {isProcessing && processingProgress && (
          <div className="progress-indicator">
            <div className="progress-info">
              <span className="progress-count">
                Processing {Math.max(1, processingProgress.current)} of {processingProgress.total} videos
              </span>
              {processingProgress.videoName && (
                <span className="progress-video-name" title={processingProgress.videoName}>
                  {processingProgress.videoName}
                </span>
              )}
            </div>
            <div className="progress-bars">
              <div className="progress-bar-container">
                <div className="progress-bar-label">Overall</div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((Math.max(0, processingProgress.current - 1) + (processingProgress.videoPercent || 0) / 100) / processingProgress.total) * 100))}%`,
                    }}
                  />
                </div>
                <div className="progress-bar-percent">
                  {Math.max(0, Math.round(((Math.max(0, processingProgress.current - 1) + (processingProgress.videoPercent || 0) / 100) / processingProgress.total) * 100))}%
                </div>
                <div className="progress-bar-time">{formatElapsedTime(elapsedTotal)}</div>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar-label">Current</div>
                <div className="progress-bar current-video">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${processingProgress.videoPercent || 0}%`,
                    }}
                  />
                </div>
                <div className="progress-bar-percent">
                  {processingProgress.videoPercent || 0}%
                </div>
                <div className="progress-bar-time">{formatElapsedTime(elapsedVideo)}</div>
              </div>
            </div>
            <span className="progress-text">
              {processingProgress.step}
            </span>
          </div>
        )}
      </div>

      <div className="toolbar-right">
        {isProcessing ? (
          <button className="toolbar-button danger" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            {selectedUnprocessedCount > 1 && (
              <button className="toolbar-button primary" onClick={onAnalyzeSelected}>
                Analyze Selected ({selectedUnprocessedCount})
              </button>
            )}
            {hasUnprocessedVideos && (
              <button className="toolbar-button" onClick={onAnalyzeAll}>
                Analyze All
              </button>
            )}
            {hasErrors && (
              <button className="toolbar-button warning" onClick={onRetryFailed}>
                Retry Failed
              </button>
            )}
            <button className="toolbar-button" onClick={onRefresh} title="Refresh (Cmd+R)">
              Refresh
            </button>
            <button className="toolbar-button settings-button" onClick={onOpenSettings} title="Settings (Cmd+,)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
                <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default Toolbar;
