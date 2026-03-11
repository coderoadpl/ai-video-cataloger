/**
 * Settings Panel
 * Allows users to configure analysis, transcription, and output options
 */
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/SettingsPanel.css';

interface SettingsData {
  analysisMethod: 'claude' | 'ollama';
  ollamaModel: string;
  transcriptionMethod: 'local' | 'api';
  whisperModel: string;
  preferBuiltInWhisper: boolean;
  frameCount: number;
  renameFiles: boolean;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  llavaModels: Array<{
    tag: string;
    description: string;
    isPulled: boolean;
  }>;
}

interface WhisperModels {
  models: Array<{
    name: string;
  }>;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenModelManager: () => void;
}

const DEFAULT_SETTINGS: SettingsData = {
  analysisMethod: 'claude',
  ollamaModel: 'llava:7b',
  transcriptionMethod: 'local',
  whisperModel: 'base',
  preferBuiltInWhisper: true,
  frameCount: 3,
  renameFiles: true,
};

const FRAME_COUNT_OPTIONS = [1, 3, 5, 10];

const WHISPER_MODEL_OPTIONS = [
  { name: 'tiny', label: 'Tiny (fastest, lowest quality)' },
  { name: 'tiny.en', label: 'Tiny English' },
  { name: 'base', label: 'Base (recommended)' },
  { name: 'base.en', label: 'Base English' },
  { name: 'small', label: 'Small' },
  { name: 'small.en', label: 'Small English' },
  { name: 'medium', label: 'Medium' },
  { name: 'medium.en', label: 'Medium English' },
  { name: 'large-v3', label: 'Large v3 (best quality, slowest)' },
];

function SettingsPanel({ isOpen, onClose, onOpenModelManager }: SettingsPanelProps): React.ReactElement | null {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [whisperModels, setWhisperModels] = useState<WhisperModels | null>(null);
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [openaiAvailable, setOpenaiAvailable] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings and status on open
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load all data in parallel
      const [
        analysisSettings,
        whisperSettings,
        appSettings,
        ollamaStatusResult,
        whisperModelsResult,
        prerequisites,
      ] = await Promise.all([
        window.electronAPI.getAnalysisSettings(),
        window.electronAPI.getWhisperSettings(),
        window.electronAPI.getSettings(),
        window.electronAPI.getOllamaStatus(),
        window.electronAPI.getWhisperModels(),
        window.electronAPI.checkPrerequisites(),
      ]);

      const loadedSettings: SettingsData = {
        analysisMethod: analysisSettings.method,
        ollamaModel: analysisSettings.ollamaModel,
        transcriptionMethod: 'local', // Default to local for now
        whisperModel: whisperSettings.selectedModel,
        preferBuiltInWhisper: whisperSettings.preferBuiltIn,
        frameCount: (appSettings.frameCount as number) || 3,
        renameFiles: appSettings.renameFiles !== false,
      };

      setSettings(loadedSettings);
      setOriginalSettings(loadedSettings);
      setOllamaStatus(ollamaStatusResult);
      setWhisperModels(whisperModelsResult);
      setClaudeAvailable(prerequisites.claude.available);
      setOpenaiAvailable(prerequisites.openaiKey.available);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Track if settings have changed
  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    setHasChanges(changed);
  }, [settings, originalSettings]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      // Reset to original settings on close without save
      setSettings(originalSettings);
    }
    onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save analysis settings
      await window.electronAPI.saveAnalysisSettings({
        method: settings.analysisMethod,
        ollamaModel: settings.ollamaModel,
      });

      // Save whisper settings
      await window.electronAPI.saveWhisperSettings({
        preferBuiltIn: settings.preferBuiltInWhisper,
        selectedModel: settings.whisperModel,
      });

      // Save general settings
      await window.electronAPI.saveSettings({
        frameCount: settings.frameCount,
        renameFiles: settings.renameFiles,
      });

      setOriginalSettings(settings);
      setHasChanges(false);
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleOpenModelManager = () => {
    onClose();
    onOpenModelManager();
  };

  // Get available LLaVA models
  const availableLlavaModels = ollamaStatus?.llavaModels.filter(m => m.isPulled) || [];
  const hasLlavaModels = availableLlavaModels.length > 0;

  // Get downloaded Whisper models
  const downloadedWhisperModels = whisperModels?.models.map(m => m.name) || [];

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="settings-panel">
        <div className="panel-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="panel-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Loading settings...</span>
            </div>
          ) : (
            <>
              {/* Analysis Section */}
              <section className="settings-section">
                <h3>Analysis</h3>
                <p className="section-description">
                  Choose how video frames are analyzed to generate descriptions
                </p>

                <div className="setting-row">
                  <div className="setting-label">
                    <span>Analysis Method</span>
                    <span className="setting-description">
                      {settings.analysisMethod === 'claude'
                        ? 'Uses Claude API for high-quality analysis'
                        : 'Uses local LLaVA model via Ollama'}
                    </span>
                  </div>
                  <div className="toggle-group">
                    <button
                      className={`toggle-button ${settings.analysisMethod === 'claude' ? 'active' : ''}`}
                      onClick={() => updateSetting('analysisMethod', 'claude')}
                      disabled={!claudeAvailable}
                      title={!claudeAvailable ? 'Claude API key not configured' : undefined}
                    >
                      Claude
                    </button>
                    <button
                      className={`toggle-button ${settings.analysisMethod === 'ollama' ? 'active' : ''}`}
                      onClick={() => updateSetting('analysisMethod', 'ollama')}
                      disabled={!ollamaStatus?.running}
                      title={!ollamaStatus?.running ? 'Ollama is not running' : undefined}
                    >
                      Ollama
                    </button>
                  </div>
                </div>

                {settings.analysisMethod === 'ollama' && (
                  <div className="setting-row nested">
                    <div className="setting-label">
                      <span>LLaVA Model</span>
                    </div>
                    <select
                      className="setting-select"
                      value={settings.ollamaModel}
                      onChange={(e) => updateSetting('ollamaModel', e.target.value)}
                      disabled={!hasLlavaModels}
                    >
                      {hasLlavaModels ? (
                        availableLlavaModels.map((model) => (
                          <option key={model.tag} value={model.tag}>
                            {model.tag}
                          </option>
                        ))
                      ) : (
                        <option value="">No models available</option>
                      )}
                    </select>
                  </div>
                )}

                {settings.analysisMethod === 'ollama' && !hasLlavaModels && (
                  <div className="setting-note warning">
                    No LLaVA models are pulled. Use Model Manager to download a model.
                  </div>
                )}

                {settings.analysisMethod === 'claude' && !claudeAvailable && (
                  <div className="setting-note warning">
                    Claude API key not configured. Set ANTHROPIC_API_KEY environment variable.
                  </div>
                )}
              </section>

              {/* Transcription Section */}
              <section className="settings-section">
                <h3>Transcription</h3>
                <p className="section-description">
                  Configure how audio is transcribed from videos
                </p>

                <div className="setting-row">
                  <div className="setting-label">
                    <span>Transcription Method</span>
                    <span className="setting-description">
                      {settings.transcriptionMethod === 'local'
                        ? 'Uses local Whisper for privacy'
                        : 'Uses OpenAI Whisper API'}
                    </span>
                  </div>
                  <div className="toggle-group">
                    <button
                      className={`toggle-button ${settings.transcriptionMethod === 'local' ? 'active' : ''}`}
                      onClick={() => updateSetting('transcriptionMethod', 'local')}
                    >
                      Local
                    </button>
                    <button
                      className={`toggle-button ${settings.transcriptionMethod === 'api' ? 'active' : ''}`}
                      onClick={() => updateSetting('transcriptionMethod', 'api')}
                      disabled={!openaiAvailable}
                      title={!openaiAvailable ? 'OpenAI API key not configured' : undefined}
                    >
                      API
                    </button>
                  </div>
                </div>

                {settings.transcriptionMethod === 'local' && (
                  <>
                    <div className="setting-row nested">
                      <div className="setting-label">
                        <span>Whisper Runtime</span>
                        <span className="setting-description">
                          {settings.preferBuiltInWhisper
                            ? 'Prefer bundled whisper.cpp'
                            : 'Prefer system whisper'}
                        </span>
                      </div>
                      <div className="toggle-group">
                        <button
                          className={`toggle-button ${settings.preferBuiltInWhisper ? 'active' : ''}`}
                          onClick={() => updateSetting('preferBuiltInWhisper', true)}
                        >
                          Built-in
                        </button>
                        <button
                          className={`toggle-button ${!settings.preferBuiltInWhisper ? 'active' : ''}`}
                          onClick={() => updateSetting('preferBuiltInWhisper', false)}
                        >
                          System
                        </button>
                      </div>
                    </div>

                    <div className="setting-row nested">
                      <div className="setting-label">
                        <span>Whisper Model</span>
                      </div>
                      <select
                        className="setting-select"
                        value={settings.whisperModel}
                        onChange={(e) => updateSetting('whisperModel', e.target.value)}
                      >
                        {WHISPER_MODEL_OPTIONS.map((model) => {
                          const isDownloaded = downloadedWhisperModels.includes(model.name);
                          return (
                            <option
                              key={model.name}
                              value={model.name}
                              disabled={!isDownloaded}
                            >
                              {model.label} {isDownloaded ? '✓' : '(not downloaded)'}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </>
                )}

                {settings.transcriptionMethod === 'api' && !openaiAvailable && (
                  <div className="setting-note warning">
                    OpenAI API key not configured. Set OPENAI_API_KEY environment variable.
                  </div>
                )}
              </section>

              {/* Output Section */}
              <section className="settings-section">
                <h3>Output</h3>
                <p className="section-description">
                  Configure how processed videos are handled
                </p>

                <div className="setting-row">
                  <div className="setting-label">
                    <span>Frames to Extract</span>
                    <span className="setting-description">
                      Number of frames to extract for analysis
                    </span>
                  </div>
                  <select
                    className="setting-select small"
                    value={settings.frameCount}
                    onChange={(e) => updateSetting('frameCount', parseInt(e.target.value, 10))}
                  >
                    {FRAME_COUNT_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count} frame{count !== 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="setting-row">
                  <div className="setting-label">
                    <span>Auto-rename Files</span>
                    <span className="setting-description">
                      Automatically rename videos based on content
                    </span>
                  </div>
                  <div className="toggle-group">
                    <button
                      className={`toggle-button ${settings.renameFiles ? 'active' : ''}`}
                      onClick={() => updateSetting('renameFiles', true)}
                    >
                      On
                    </button>
                    <button
                      className={`toggle-button ${!settings.renameFiles ? 'active' : ''}`}
                      onClick={() => updateSetting('renameFiles', false)}
                    >
                      Off
                    </button>
                  </div>
                </div>
              </section>

              {/* Manage Models */}
              <section className="settings-section no-border">
                <div className="model-manager-link">
                  <div>
                    <h3>Model Manager</h3>
                    <p className="section-description">
                      Download and manage Whisper and LLaVA models
                    </p>
                  </div>
                  <button
                    className="action-button"
                    onClick={handleOpenModelManager}
                  >
                    Manage Models
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="panel-footer">
          <button className="action-button" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="action-button primary"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
