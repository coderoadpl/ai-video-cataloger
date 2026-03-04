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

interface AnalysisSettings {
  method: 'claude' | 'ollama';
  ollamaModel: string;
}

interface LlavaModel {
  name: string;
  tag: string;
  description: string;
  sizeGb: number;
  minRamGb: number;
  isPulled: boolean;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  pulledModels: string[];
  llavaModels: LlavaModel[];
}

interface SystemMemoryInfo {
  totalGb: number;
  freeGb: number;
  recommendedModel: string | null;
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
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings>({
    method: 'claude',
    ollamaModel: 'llava:7b',
  });
  const [ollamaPullProgress, setOllamaPullProgress] = useState<{
    modelTag: string;
    message: string;
  } | null>(null);
  const [isStartingOllama, setIsStartingOllama] = useState(false);
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null);

  // Load downloaded models and whisper status
  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [modelsResult, statusResult, settingsResult, ollamaResult, analysisResult, memoryResult] = await Promise.all([
        window.electronAPI.getWhisperModels(),
        window.electronAPI.getWhisperCppStatus(),
        window.electronAPI.getWhisperSettings(),
        window.electronAPI.getOllamaStatus(),
        window.electronAPI.getAnalysisSettings(),
        window.electronAPI.getSystemMemory(),
      ]);
      setDownloadedModels(modelsResult.models);
      setModelsPath(modelsResult.modelsPath);
      setWhisperStatus(statusResult);
      setWhisperSettings(settingsResult);
      setOllamaStatus(ollamaResult);
      setAnalysisSettings(analysisResult);
      setSystemMemory(memoryResult);
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

    // Listen for Ollama pull progress
    const unsubscribeOllamaPull = window.electronAPI.onOllamaPullProgress((progress) => {
      setOllamaPullProgress({
        modelTag: progress.modelTag,
        message: progress.message,
      });
    });

    const unsubscribeOllamaPullComplete = window.electronAPI.onOllamaPullComplete((result) => {
      setOllamaPullProgress(null);
      if (result.success) {
        loadModels(); // Refresh the list
      } else {
        setError(result.error || 'Pull failed');
      }
    });

    return () => {
      unsubscribe();
      unsubscribeComplete();
      unsubscribeOllamaPull();
      unsubscribeOllamaPullComplete();
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

  // Handle analysis settings change
  const handleAnalysisSettingsChange = async (newSettings: Partial<AnalysisSettings>) => {
    const updated = { ...analysisSettings, ...newSettings };
    setAnalysisSettings(updated);
    try {
      await window.electronAPI.saveAnalysisSettings(updated);
    } catch (err) {
      console.error('Failed to save analysis settings:', err);
    }
  };

  // Handle Ollama start
  const handleStartOllama = async () => {
    setIsStartingOllama(true);
    setError(null);
    try {
      const result = await window.electronAPI.startOllama();
      if (result.success) {
        loadModels(); // Refresh status
      } else {
        setError(result.error || 'Failed to start Ollama');
      }
    } catch (err) {
      console.error('Failed to start Ollama:', err);
      setError('Failed to start Ollama');
    } finally {
      setIsStartingOllama(false);
    }
  };

  // Handle LLaVA model pull
  const handlePullLlavaModel = async (modelTag: string) => {
    setError(null);
    setOllamaPullProgress({
      modelTag,
      message: 'Starting pull...',
    });

    try {
      const result = await window.electronAPI.pullLlavaModel(modelTag);
      if (!result.success) {
        setError(result.error || 'Pull failed');
        setOllamaPullProgress(null);
      }
    } catch (err) {
      console.error('Pull failed:', err);
      setError('Pull failed');
      setOllamaPullProgress(null);
    }
  };

  // Handle LLaVA model removal
  const handleRemoveLlavaModel = async (modelTag: string) => {
    setError(null);
    try {
      const result = await window.electronAPI.removeLlavaModel(modelTag);
      if (result.success) {
        loadModels(); // Refresh status
      } else {
        setError(result.error || 'Remove failed');
      }
    } catch (err) {
      console.error('Remove failed:', err);
      setError('Remove failed');
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

              {/* Analysis Settings Section */}
              <section className="settings-section">
                <h3>Analysis Settings</h3>

                {/* Analysis Method Toggle */}
                <div className="setting-row">
                  <label className="setting-label">
                    Analysis Method
                    <span className="setting-description">
                      Choose which AI model to use for video analysis
                    </span>
                  </label>
                  <div className="toggle-group">
                    <button
                      className={`toggle-button ${analysisSettings.method === 'claude' ? 'active' : ''}`}
                      onClick={() => handleAnalysisSettingsChange({ method: 'claude' })}
                    >
                      Claude API
                    </button>
                    <button
                      className={`toggle-button ${analysisSettings.method === 'ollama' ? 'active' : ''}`}
                      onClick={() => handleAnalysisSettingsChange({ method: 'ollama' })}
                      disabled={!ollamaStatus?.installed}
                      title={!ollamaStatus?.installed ? 'Ollama is not installed' : undefined}
                    >
                      Ollama (LLaVA)
                    </button>
                  </div>
                </div>

                {/* Ollama Status */}
                <div className="status-grid" style={{ marginTop: 'var(--spacing-md)' }}>
                  <div className="status-item">
                    <span className="status-label">Ollama Installed</span>
                    <span className={`status-value ${ollamaStatus?.installed ? 'available' : 'unavailable'}`}>
                      {ollamaStatus?.installed ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Ollama Running</span>
                    <span className={`status-value ${ollamaStatus?.running ? 'available' : 'unavailable'}`}>
                      {ollamaStatus?.running ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">LLaVA Models</span>
                    <span className="status-value">
                      {ollamaStatus?.llavaModels?.filter(m => m.isPulled).length || 0} pulled
                    </span>
                  </div>
                </div>

                {/* Start Ollama button if installed but not running */}
                {ollamaStatus?.installed && !ollamaStatus?.running && (
                  <div className="setting-row">
                    <label className="setting-label">
                      Ollama is not running
                      <span className="setting-description">
                        Start Ollama to use local LLaVA analysis
                      </span>
                    </label>
                    <button
                      className="action-button primary"
                      onClick={handleStartOllama}
                      disabled={isStartingOllama}
                    >
                      {isStartingOllama ? 'Starting...' : 'Start Ollama'}
                    </button>
                  </div>
                )}

                {/* Install Ollama link if not installed */}
                {!ollamaStatus?.installed && (
                  <div className="info-box">
                    <span>Ollama is not installed. </span>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        // Open Ollama download page
                        window.open?.('https://ollama.ai/download', '_blank');
                      }}
                    >
                      Download Ollama
                    </a>
                    <span> to use local LLaVA models for analysis.</span>
                  </div>
                )}

                {/* LLaVA Model Selection (when using Ollama) */}
                {analysisSettings.method === 'ollama' && ollamaStatus?.running && (
                  <div className="setting-row">
                    <label className="setting-label">
                      LLaVA Model
                      <span className="setting-description">
                        Select the LLaVA model for image analysis
                      </span>
                    </label>
                    <select
                      className="setting-select"
                      value={analysisSettings.ollamaModel}
                      onChange={(e) => handleAnalysisSettingsChange({ ollamaModel: e.target.value })}
                    >
                      {ollamaStatus?.llavaModels?.map((model) => (
                        <option
                          key={model.tag}
                          value={model.tag}
                          disabled={!model.isPulled}
                        >
                          {model.tag} ({model.sizeGb} GB){model.isPulled ? '' : ' - Not pulled'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </section>

              {/* LLaVA Models Section (when Ollama is installed) */}
              {ollamaStatus?.installed && (
                <section className="model-section">
                  <h3>LLaVA Models</h3>
                  <p className="section-note">
                    Pull vision-language models for local image analysis with Ollama
                  </p>

                  {/* System RAM Info */}
                  {systemMemory && (
                    <div className="system-ram-info">
                      <div className="ram-stats">
                        <span className="ram-label">System RAM:</span>
                        <span className="ram-value">{systemMemory.totalGb} GB total</span>
                        <span className="ram-separator">•</span>
                        <span className="ram-value">{systemMemory.freeGb} GB free</span>
                      </div>
                      {systemMemory.recommendedModel && (
                        <div className="ram-recommendation">
                          Recommended model for your system: <strong>{systemMemory.recommendedModel}</strong>
                        </div>
                      )}
                      {!systemMemory.recommendedModel && systemMemory.totalGb < 8 && (
                        <div className="ram-warning">
                          Your system has limited RAM. LLaVA models require at least 8 GB of RAM.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="model-list">
                    {ollamaStatus?.llavaModels?.map((model) => {
                      const isPulling = ollamaPullProgress?.modelTag === model.tag;
                      const isRecommended = systemMemory?.recommendedModel === model.tag;
                      const hasEnoughRam = systemMemory ? systemMemory.totalGb >= model.minRamGb : true;

                      return (
                        <div
                          key={model.tag}
                          className={`model-item ${model.isPulled ? 'downloaded' : ''} ${isPulling ? 'downloading' : ''} ${isRecommended ? 'recommended' : ''}`}
                        >
                          <div className="model-info">
                            <div className="model-header">
                              <span className="model-name">{model.tag}</span>
                              {isRecommended && <span className="recommended-badge">Recommended</span>}
                              <span className="model-size">{model.sizeGb} GB</span>
                              <span className={`model-ram ${!hasEnoughRam ? 'insufficient' : ''}`}>
                                {model.minRamGb} GB RAM required
                              </span>
                              {model.isPulled && <span className="downloaded-badge">Pulled</span>}
                            </div>
                            <div className="model-description">{model.description}</div>
                            {!hasEnoughRam && (
                              <div className="ram-warning-inline">
                                Your system may not have enough RAM for this model
                              </div>
                            )}

                            {/* Pull Progress */}
                            {isPulling && ollamaPullProgress && (
                              <div className="download-progress">
                                <div className="progress-text">
                                  <span>{ollamaPullProgress.message}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="model-actions">
                            {isPulling ? (
                              <span className="action-button" style={{ cursor: 'wait' }}>
                                Pulling...
                              </span>
                            ) : model.isPulled ? (
                              <button
                                className="action-button danger"
                                onClick={() => handleRemoveLlavaModel(model.tag)}
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                className="action-button primary"
                                onClick={() => handlePullLlavaModel(model.tag)}
                                disabled={!ollamaStatus?.running || ollamaPullProgress !== null}
                              >
                                Pull
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
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
