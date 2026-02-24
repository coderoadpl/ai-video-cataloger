/**
 * Toolbar Component
 */
import React from 'react';
import '../styles/Toolbar.css';

interface ToolbarProps {
  currentFolder: string | null;
  onSelectFolder: () => void;
  onAnalyzeAll: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  isProcessing: boolean;
  processingProgress: { current: number; total: number; step: string } | null;
  hasUnprocessedVideos: boolean;
  hasErrors: boolean;
}

function Toolbar({
  currentFolder,
  onSelectFolder,
  onAnalyzeAll,
  onCancel,
  onRefresh,
  isProcessing,
  processingProgress,
  hasUnprocessedVideos,
  hasErrors,
}: ToolbarProps): React.ReactElement {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button className="toolbar-button primary" onClick={onSelectFolder}>
          Open Folder
        </button>
        {currentFolder && (
          <span className="current-folder" title={currentFolder}>
            {currentFolder.split('/').pop()}
          </span>
        )}
      </div>

      <div className="toolbar-center">
        {isProcessing && processingProgress && (
          <div className="progress-indicator">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(processingProgress.current / processingProgress.total) * 100}%`,
                }}
              />
            </div>
            <span className="progress-text">
              {processingProgress.current}/{processingProgress.total} - {processingProgress.step}
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
            {hasUnprocessedVideos && (
              <button className="toolbar-button" onClick={onAnalyzeAll}>
                Analyze All
              </button>
            )}
            {hasErrors && (
              <button className="toolbar-button warning" onClick={() => {/* TODO: Retry failed */}}>
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
