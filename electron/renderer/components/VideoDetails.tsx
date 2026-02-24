/**
 * Video Details Panel Component
 */
import React from 'react';
import type { VideoFile } from '../App.js';
import '../styles/VideoDetails.css';

interface VideoDetailsProps {
  video: VideoFile | null;
  onAnalyze: (videoId: number) => void;
  isProcessing: boolean;
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

function formatDate(date?: Date): string {
  if (!date) return 'Unknown';
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function VideoDetails({ video, onAnalyze, isProcessing }: VideoDetailsProps): React.ReactElement {
  // Empty state - no video selected
  if (!video) {
    return (
      <div className="video-details">
        <div className="video-details-empty">
          <p>Select a video to view details</p>
        </div>
      </div>
    );
  }

  // Error state
  if (video.status === 'error') {
    return (
      <div className="video-details">
        <div className="video-details-header">
          <h2>{video.filename}</h2>
          <span className="status-label error">Error</span>
        </div>

        <div className="video-details-content">
          <div className="info-section">
            <div className="info-row">
              <span className="info-label">Path:</span>
              <span className="info-value">{video.path}</span>
            </div>
          </div>

          <div className="error-section">
            <h3>Error Details</h3>
            <p className="error-message">{video.errorMessage || 'Unknown error occurred'}</p>
          </div>

          {/* Show partial results if any */}
          {video.frames && video.frames.length > 0 && (
            <div className="frames-section">
              <h3>Partial Results - Frames</h3>
              <div className="frames-grid">
                {video.frames.map((frame, index) => (
                  <img key={index} src={`file://${frame}`} alt={`Frame ${index + 1}`} />
                ))}
              </div>
            </div>
          )}

          <div className="action-section">
            <button
              className="action-button primary"
              onClick={() => onAnalyze(video.id)}
              disabled={isProcessing}
            >
              Retry
            </button>
            <button
              className="action-button"
              onClick={() => window.electronAPI.revealInFinder(video.path)}
            >
              Reveal in Finder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Processed state
  if (video.status === 'completed') {
    return (
      <div className="video-details">
        <div className="video-details-header">
          <h2>{video.filename}</h2>
          <span className="status-label completed">
            Completed {video.analysisMethod && `(via ${video.analysisMethod})`}
          </span>
        </div>

        <div className="video-details-content">
          <div className="info-section">
            <div className="info-row">
              <span className="info-label">Processed:</span>
              <span className="info-value">{formatDate(video.processedAt)}</span>
            </div>
            {video.suggestedName && video.suggestedName !== video.filename && (
              <div className="info-row">
                <span className="info-label">Suggested Name:</span>
                <span className="info-value suggested-name">{video.suggestedName}</span>
              </div>
            )}
          </div>

          {video.summary && (
            <div className="summary-section">
              <h3>Summary</h3>
              <p className="summary-text">{video.summary}</p>
            </div>
          )}

          {video.frames && video.frames.length > 0 && (
            <div className="frames-section">
              <h3>Frames</h3>
              <div className="frames-grid">
                {video.frames.map((frame, index) => (
                  <img
                    key={index}
                    src={`file://${frame}`}
                    alt={`Frame ${index + 1}`}
                    onClick={() => {/* TODO: Open frame modal */}}
                  />
                ))}
              </div>
            </div>
          )}

          {video.transcript && (
            <div className="transcript-section">
              <h3>Transcript</h3>
              <div className="transcript-text">{video.transcript}</div>
            </div>
          )}

          <div className="action-section">
            <button
              className="action-button"
              onClick={() => onAnalyze(video.id)}
              disabled={isProcessing}
            >
              Re-analyze
            </button>
            <button
              className="action-button"
              onClick={() => window.electronAPI.revealInFinder(video.path)}
            >
              Reveal in Finder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Processing state
  if (video.status === 'processing') {
    return (
      <div className="video-details">
        <div className="video-details-header">
          <h2>{video.filename}</h2>
          <span className="status-label processing">Processing...</span>
        </div>

        <div className="video-details-content">
          <div className="processing-indicator">
            <div className="spinner" />
            <p>Analyzing video...</p>
          </div>
        </div>
      </div>
    );
  }

  // Unprocessed state (default)
  return (
    <div className="video-details">
      <div className="video-details-header">
        <h2>{video.filename}</h2>
        <span className="status-label">Not yet analyzed</span>
      </div>

      <div className="video-details-content">
        <div className="info-section">
          <div className="info-row">
            <span className="info-label">Path:</span>
            <span className="info-value">{video.path}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Size:</span>
            <span className="info-value">{formatFileSize(video.size)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Duration:</span>
            <span className="info-value">{formatDuration(video.duration)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Modified:</span>
            <span className="info-value">{formatDate(video.modifiedDate)}</span>
          </div>
        </div>

        <div className="action-section">
          <button
            className="action-button primary large"
            onClick={() => onAnalyze(video.id)}
            disabled={isProcessing}
          >
            Analyze
          </button>
          <button
            className="action-button"
            onClick={() => window.electronAPI.revealInFinder(video.path)}
          >
            Reveal in Finder
          </button>
        </div>
      </div>
    </div>
  );
}

export default VideoDetails;
