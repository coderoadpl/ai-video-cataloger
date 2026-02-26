/**
 * Model Manager Panel
 * Allows downloading and managing Whisper GGML models
 */
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/ModelManagerPanel.css';

// Available Whisper GGML models from Hugging Face
// https://huggingface.co/ggerganov/whisper.cpp/tree/main
interface WhisperModel {
  name: string;
  filename: string;
  size: string; // Human readable size
  sizeBytes: number;
  description: string;
  url: string;
}

const WHISPER_MODELS: WhisperModel[] = [
  {
    name: 'tiny',
    filename: 'ggml-tiny.bin',
    size: '75 MB',
    sizeBytes: 75_000_000,
    description: 'Fastest, lowest accuracy. Good for quick tests.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  },
  {
    name: 'tiny.en',
    filename: 'ggml-tiny.en.bin',
    size: '75 MB',
    sizeBytes: 75_000_000,
    description: 'English-only tiny model. Faster for English content.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  {
    name: 'base',
    filename: 'ggml-base.bin',
    size: '142 MB',
    sizeBytes: 142_000_000,
    description: 'Good balance of speed and accuracy.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  {
    name: 'base.en',
    filename: 'ggml-base.en.bin',
    size: '142 MB',
    sizeBytes: 142_000_000,
    description: 'English-only base model.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  {
    name: 'small',
    filename: 'ggml-small.bin',
    size: '466 MB',
    sizeBytes: 466_000_000,
    description: 'Better accuracy, moderate speed.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  },
  {
    name: 'small.en',
    filename: 'ggml-small.en.bin',
    size: '466 MB',
    sizeBytes: 466_000_000,
    description: 'English-only small model.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
  {
    name: 'medium',
    filename: 'ggml-medium.bin',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'High accuracy, slower speed.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  },
  {
    name: 'medium.en',
    filename: 'ggml-medium.en.bin',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'English-only medium model.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  },
  {
    name: 'large-v3',
    filename: 'ggml-large-v3.bin',
    size: '3.1 GB',
    sizeBytes: 3_100_000_000,
    description: 'Best accuracy, slowest. Recommended for important content.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
  },
];

interface DownloadedModel {
  name: string;
  filename: string;
  path: string;
  sizeBytes: number;
}

interface DownloadProgress {
  modelName: string;
  bytesDownloaded: number;
  totalBytes: number;
  speed: string; // e.g., "2.5 MB/s"
}

interface WhisperCppStatus {
  bundled: { available: boolean; path: string; version: string };
  system: {
    whisperCpp: { available: boolean; path: string | null; version: string | null };
    whisperCli: { available: boolean; path: string | null; version: string | null };
  };
}

interface WhisperSettings {
  preferBuiltIn: boolean;
  selectedModel: string;
}

interface ModelManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function ModelManagerPanel({ isOpen, onClose }: ModelManagerPanelProps): React.ReactElement | null {
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsPath, setModelsPath] = useState<string>('');
  const [whisperStatus, setWhisperStatus] = useState<WhisperCppStatus | null>(null);
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings>({
    preferBuiltIn: true,
    selectedModel: 'base',
  });

  // Load downloaded models and whisper status
  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [modelsResult, statusResult, settingsResult] = await Promise.all([
        window.electronAPI.getWhisperModels(),
        window.electronAPI.getWhisperCppStatus(),
        window.electronAPI.getWhisperSettings(),
      ]);
      setDownloadedModels(modelsResult.models);
      setModelsPath(modelsResult.modelsPath);
      setWhisperStatus(statusResult);
      setWhisperSettings(settingsResult);
    } catch (err) {
      console.error('Failed to load models:', err);
      setError('Failed to load models');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load models when panel opens
  useEffect(() => {
    if (isOpen) {
      loadModels();
    }
  }, [isOpen, loadModels]);

  // Listen for download progress
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = window.electronAPI.onModelDownloadProgress((progress) => {
      setDownloadProgress(progress);
    });

    const unsubscribeComplete = window.electronAPI.onModelDownloadComplete((result) => {
      setDownloadProgress(null);
      if (result.success) {
        loadModels(); // Refresh the list
      } else {
        setError(result.error || 'Download failed');
      }
    });

    return () => {
      unsubscribe();
      unsubscribeComplete();
    };
  }, [isOpen, loadModels]);

  // Handle download
  const handleDownload = async (model: WhisperModel) => {
    setError(null);
    setDownloadProgress({
      modelName: model.name,
      bytesDownloaded: 0,
      totalBytes: model.sizeBytes,
      speed: '0 B/s',
    });

    try {
      const result = await window.electronAPI.downloadWhisperModel(model.name);
      if (!result.success) {
        setError(result.error || 'Download failed');
        setDownloadProgress(null);
      }
    } catch (err) {
      console.error('Download failed:', err);
      setError('Download failed');
      setDownloadProgress(null);
    }
  };

  // Handle cancel download
  const handleCancelDownload = async () => {
    try {
      await window.electronAPI.cancelWhisperModelDownload();
      setDownloadProgress(null);
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  // Handle delete
  const handleDelete = async (modelName: string) => {
    setError(null);
    try {
      const result = await window.electronAPI.deleteWhisperModel(modelName);
      if (result.success) {
        loadModels(); // Refresh the list
      } else {
        setError(result.error || 'Delete failed');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      setError('Delete failed');
    }
  };

  // Handle whisper settings change
  const handleSettingsChange = async (newSettings: Partial<WhisperSettings>) => {
    const updated = { ...whisperSettings, ...newSettings };
    setWhisperSettings(updated);
    try {
      await window.electronAPI.saveWhisperSettings(updated);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  // Check if a model is downloaded
  const isModelDownloaded = (modelName: string): boolean => {
    return downloadedModels.some((m) => m.name === modelName);
  };

  // Check if a model is currently downloading
  const isModelDownloading = (modelName: string): boolean => {
    return downloadProgress?.modelName === modelName;
  };

  // Calculate total disk space used
  const totalDiskSpace = downloadedModels.reduce((acc, m) => acc + m.sizeBytes, 0);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="model-manager-panel">
        <div className="panel-header">
          <h2>Model Manager</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="panel-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Loading models...</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="error-message">
                  {error}
                  <button className="dismiss-error" onClick={() => setError(null)}>
                    ✕
                  </button>
                </div>
              )}

              {/* Whisper Settings Section */}
              <section className="settings-section">
                <h3>Whisper Settings</h3>

                {/* Runtime Status */}
                <div className="status-grid">
                  <div className="status-item">
                    <span className="status-label">Built-in whisper.cpp</span>
                    <span className={`status-value ${whisperStatus?.bundled.available ? 'available' : 'unavailable'}`}>
                      {whisperStatus?.bundled.available ? 'Available' : 'Not bundled'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">System whisper.cpp</span>
                    <span className={`status-value ${whisperStatus?.system.whisperCpp.available ? 'available' : 'unavailable'}`}>
                      {whisperStatus?.system.whisperCpp.available ? 'Available' : 'Not found'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">System Whisper CLI</span>
                    <span className={`status-value ${whisperStatus?.system.whisperCli.available ? 'available' : 'unavailable'}`}>
                      {whisperStatus?.system.whisperCli.available ? 'Available' : 'Not found'}
                    </span>
                  </div>
                </div>

                {/* Preference Toggle */}
                <div className="setting-row">
                  <label className="setting-label">
                    Whisper Runtime
                    <span className="setting-description">
                      Choose which whisper implementation to use for transcription
                    </span>
                  </label>
                  <div className="toggle-group">
                    <button
                      className={`toggle-button ${whisperSettings.preferBuiltIn ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ preferBuiltIn: true })}
                    >
                      Built-in
                    </button>
                    <button
                      className={`toggle-button ${!whisperSettings.preferBuiltIn ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ preferBuiltIn: false })}
                    >
                      System
                    </button>
                  </div>
                </div>

                {/* Model Selection */}
                <div className="setting-row">
                  <label className="setting-label">
                    Default Model
                    <span className="setting-description">
                      Select the model to use for transcription
                    </span>
                  </label>
                  <select
                    className="setting-select"
                    value={whisperSettings.selectedModel}
                    onChange={(e) => handleSettingsChange({ selectedModel: e.target.value })}
                  >
                    {WHISPER_MODELS.map((model) => (
                      <option
                        key={model.name}
                        value={model.name}
                        disabled={!isModelDownloaded(model.name)}
                      >
                        {model.name} ({model.size}){isModelDownloaded(model.name) ? '' : ' - Not downloaded'}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* Whisper Models Section */}
              <section className="model-section">
                <h3>Whisper Models</h3>
                <p className="section-note">
                  Download GGML models for local transcription with whisper.cpp
                </p>

                <div className="model-list">
                  {WHISPER_MODELS.map((model) => {
                    const downloaded = isModelDownloaded(model.name);
                    const downloading = isModelDownloading(model.name);

                    return (
                      <div
                        key={model.name}
                        className={`model-item ${downloaded ? 'downloaded' : ''} ${downloading ? 'downloading' : ''}`}
                      >
                        <div className="model-info">
                          <div className="model-header">
                            <span className="model-name">{model.name}</span>
                            <span className="model-size">{model.size}</span>
                            {downloaded && <span className="downloaded-badge">Downloaded</span>}
                          </div>
                          <div className="model-description">{model.description}</div>

                          {/* Download Progress */}
                          {downloading && downloadProgress && (
                            <div className="download-progress">
                              <div className="progress-bar">
                                <div
                                  className="progress-fill"
                                  style={{
                                    width: `${(downloadProgress.bytesDownloaded / downloadProgress.totalBytes) * 100}%`,
                                  }}
                                />
                              </div>
                              <div className="progress-text">
                                <span>
                                  {formatBytes(downloadProgress.bytesDownloaded)} /{' '}
                                  {formatBytes(downloadProgress.totalBytes)}
                                </span>
                                <span>{downloadProgress.speed}</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="model-actions">
                          {downloading ? (
                            <button
                              className="action-button danger"
                              onClick={handleCancelDownload}
                            >
                              Cancel
                            </button>
                          ) : downloaded ? (
                            <button
                              className="action-button danger"
                              onClick={() => handleDelete(model.name)}
                            >
                              Delete
                            </button>
                          ) : (
                            <button
                              className="action-button primary"
                              onClick={() => handleDownload(model)}
                              disabled={downloadProgress !== null}
                            >
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Disk Usage Summary */}
              <section className="summary-section">
                <h3>Disk Usage</h3>
                <div className="disk-usage">
                  <div className="usage-stat">
                    <strong>{downloadedModels.length}</strong> models downloaded
                  </div>
                  <div className="usage-stat">
                    <strong>{formatBytes(totalDiskSpace)}</strong> used
                  </div>
                </div>
                {modelsPath && (
                  <div className="models-path">
                    <span className="path-label">Models stored in:</span>
                    <code>{modelsPath}</code>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="panel-footer">
          <button className="action-button" onClick={loadModels} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="action-button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModelManagerPanel;
