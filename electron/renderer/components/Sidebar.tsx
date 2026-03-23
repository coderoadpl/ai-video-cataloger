/**
 * Sidebar Component - Video File List
 */
import React, { useState, useMemo } from 'react';
import type { VideoFile } from '../App.js';
import '../styles/Sidebar.css';

type SortField = 'name' | 'date' | 'status';
type SortOrder = 'asc' | 'desc';

interface SidebarProps {
  videos: VideoFile[];
  selectedVideoIds: number[];
  onSelectVideo: (videoId: number, multiSelect: boolean) => void;
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
      return <span className="status-badge completed" title="Completed">✓</span>;
    case 'processing':
      return <span className="status-badge processing" title="Processing">●</span>;
    case 'error':
      return <span className="status-badge error" title="Error">✕</span>;
    default:
      return null;
  }
}

function getStatusSortValue(status: VideoFile['status']): number {
  switch (status) {
    case 'error': return 0;
    case 'none': return 1;
    case 'processing': return 2;
    case 'completed': return 3;
    default: return 1;
  }
}

function Sidebar({
  videos,
  selectedVideoIds,
  onSelectVideo,
  currentFolder,
}: SidebarProps): React.ReactElement {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const sortedVideos = useMemo(() => {
    const sorted = [...videos].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.filename.localeCompare(b.filename);
          break;
        case 'date':
          comparison = new Date(a.modifiedDate).getTime() - new Date(b.modifiedDate).getTime();
          break;
        case 'status':
          comparison = getStatusSortValue(a.status) - getStatusSortValue(b.status);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [videos, sortField, sortOrder]);

  // Calculate video stats
  const videoStats = useMemo(() => {
    const completed = videos.filter(v => v.status === 'completed').length;
    const pending = videos.filter(v => v.status === 'none').length;
    const errors = videos.filter(v => v.status === 'error').length;
    const processing = videos.filter(v => v.status === 'processing').length;
    const allProcessed = pending === 0 && processing === 0 && videos.length > 0;

    return { completed, pending, errors, processing, allProcessed };
  }, [videos]);

  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      // Toggle order if same field
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleVideoClick = (videoId: number, event: React.MouseEvent) => {
    // Check for Cmd key (Mac) or Ctrl key (Windows/Linux) for multi-select
    const multiSelect = event.metaKey || event.ctrlKey;
    onSelectVideo(videoId, multiSelect);
  };

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
      <div className="sort-controls">
        <button
          className={`sort-button ${sortField === 'name' ? 'active' : ''}`}
          onClick={() => handleSortChange('name')}
          title="Sort by name"
        >
          Name {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
        </button>
        <button
          className={`sort-button ${sortField === 'date' ? 'active' : ''}`}
          onClick={() => handleSortChange('date')}
          title="Sort by date"
        >
          Date {sortField === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
        </button>
        <button
          className={`sort-button ${sortField === 'status' ? 'active' : ''}`}
          onClick={() => handleSortChange('status')}
          title="Sort by status"
        >
          Status {sortField === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
        </button>
      </div>
      {videoStats.allProcessed && (
        <div className="all-processed-summary">
          <span className="summary-icon">✓</span>
          <span className="summary-text">
            All {videoStats.completed} video{videoStats.completed !== 1 ? 's' : ''} processed
            {videoStats.errors > 0 && ` (${videoStats.errors} with errors)`}
          </span>
        </div>
      )}
      <div className="video-list">
        {sortedVideos.map((video) => (
          <div
            key={video.id}
            className={`video-item ${selectedVideoIds.includes(video.id) ? 'selected' : ''}`}
            onClick={(e) => handleVideoClick(video.id, e)}
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
