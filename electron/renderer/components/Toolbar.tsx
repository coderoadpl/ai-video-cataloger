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
  isProcessing: boolean;
  processingProgress: {
    current: number;
    total: number;
    step: string;
    videoName?: string;
  } | null;
  hasUnprocessedVideos: boolean;
  hasErrors: boolean;
  selectedUnprocessedCount: number;
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
  isProcessing,
  processingProgress,
  hasUnprocessedVideos,
  hasErrors,
  selectedUnprocessedCount,
}: ToolbarProps): React.ReactElement {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
                Processing {processingProgress.current} of {processingProgress.total} videos
              </span>
              {processingProgress.videoName && (
                <span className="progress-video-name" title={processingProgress.videoName}>
                  {processingProgress.videoName}
                </span>
              )}
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(processingProgress.current / processingProgress.total) * 100}%`,
                }}
              />
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
          </>
        )}
      </div>
    </div>
  );
}

export default Toolbar;
