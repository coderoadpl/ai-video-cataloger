/**
 * Sidebar Component - Video File List
 */
import React from 'react';
import type { VideoFile } from '../App.js';
import '../styles/Sidebar.css';

interface SidebarProps {
  videos: VideoFile[];
  selectedVideoId: number | null;
  onSelectVideo: (videoId: number) => void;
  currentFolder: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getStatusBadge(status: VideoFile['status']): React.ReactElement | null {
  switch (status) {
    case 'completed':
      return <span className="status-badge completed" title="Completed">G</span>;
    case 'processing':
      return <span className="status-badge processing" title="Processing">Y</span>;
    case 'error':
      return <span className="status-badge error" title="Error">R</span>;
    default:
      return null;
  }
}

function Sidebar({
  videos,
  selectedVideoId,
  onSelectVideo,
  currentFolder,
}: SidebarProps): React.ReactElement {
  if (!currentFolder) {
    return (
      <div className="sidebar">
        <div className="sidebar-empty">
          <p>Open a folder to get started</p>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="folder-name">{currentFolder.split('/').pop()}</span>
        </div>
        <div className="sidebar-empty">
          <p>No video files found in this folder</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="folder-name">{currentFolder.split('/').pop()}</span>
        <span className="video-count">{videos.length} videos</span>
      </div>
      <div className="video-list">
        {videos.map((video) => (
          <div
            key={video.id}
            className={`video-item ${selectedVideoId === video.id ? 'selected' : ''}`}
            onClick={() => onSelectVideo(video.id)}
          >
            <div className="video-thumbnail">
              {video.thumbnail ? (
                <img src={video.thumbnail} alt={video.filename} />
              ) : (
                <div className="thumbnail-placeholder">No Preview</div>
              )}
              {getStatusBadge(video.status)}
            </div>
            <div className="video-info">
              <span className="video-name" title={video.filename}>
                {video.filename}
              </span>
              <div className="video-meta">
                <span>{formatFileSize(video.size)}</span>
                <span>{formatDuration(video.duration)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Sidebar;
