/**
 * Prerequisites Verification Panel
 * Displays status of all required and optional dependencies
 */
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/PrerequisitesPanel.css';

interface PrerequisitesData {
  ffmpeg: { available: boolean; version: string; bundled: boolean; path: string };
  ffprobe: { available: boolean; path: string };
  whisper: { available: boolean; version: string | null; path: string | null; type: 'whisper.cpp' | 'whisper' | null };
  claudeCode: { available: boolean; version: string | null; path: string | null };
  claudeApi: { available: boolean };
  ollama: { installed: boolean; running: boolean; version: string | null };
  openaiKey: { available: boolean };
  analysisMethods: string[];
  transcriptionMethods: string[];
}

interface PrerequisitesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type DependencyStatus = 'available' | 'missing' | 'warning';

interface DependencyItemProps {
  name: string;
  status: DependencyStatus;
  details?: string;
  installInstructions?: string;
  isOptional?: boolean;
}

function DependencyItem({ name, status, details, installInstructions, isOptional }: DependencyItemProps): React.ReactElement {
  const getStatusIcon = () => {
    switch (status) {
      case 'available':
        return <span className="status-icon success">✓</span>;
      case 'missing':
        return <span className="status-icon error">✗</span>;
      case 'warning':
        return <span className="status-icon warning">!</span>;
    }
  };

  return (
    <div className={`dependency-item ${status}`}>
      <div className="dependency-header">
        {getStatusIcon()}
        <span className="dependency-name">{name}</span>
        {isOptional && <span className="optional-badge">Optional</span>}
      </div>
      {details && <div className="dependency-details">{details}</div>}
      {status === 'missing' && installInstructions && (
        <div className="install-instructions">
          <strong>Install:</strong> {installInstructions}
        </div>
      )}
    </div>
  );
}

function PrerequisitesPanel({ isOpen, onClose }: PrerequisitesPanelProps): React.ReactElement | null {
  const [prerequisites, setPrerequisites] = useState<PrerequisitesData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkPrerequisites = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.checkPrerequisites();
      setPrerequisites(result);
    } catch (error) {
      console.error('Failed to check prerequisites:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      checkPrerequisites();
    }
  }, [isOpen, checkPrerequisites]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getFFmpegStatus = (): DependencyStatus => {
    if (!prerequisites) return 'missing';
    return prerequisites.ffmpeg.available ? 'available' : 'missing';
  };

  const getFFmpegDetails = (): string => {
    if (!prerequisites?.ffmpeg.available) return '';
    const parts = [];
    if (prerequisites.ffmpeg.version) parts.push(`v${prerequisites.ffmpeg.version}`);
    if (prerequisites.ffmpeg.bundled) parts.push('(Bundled)');
    return parts.join(' ');
  };

  const getWhisperStatus = (): DependencyStatus => {
    if (!prerequisites) return 'missing';
    if (prerequisites.whisper.available) return 'available';
    if (prerequisites.openaiKey.available) return 'warning';
    return 'missing';
  };

  const getWhisperDetails = (): string => {
    if (!prerequisites) return '';
    if (prerequisites.whisper.available) {
      const type = prerequisites.whisper.type === 'whisper.cpp' ? 'whisper.cpp' : 'Whisper CLI';
      return prerequisites.whisper.version ? `${type} - ${prerequisites.whisper.version}` : type;
    }
    if (prerequisites.openaiKey.available) {
      return 'Using OpenAI Whisper API';
    }
    return '';
  };

  const getClaudeCodeStatus = (): DependencyStatus => {
    if (!prerequisites) return 'missing';
    return prerequisites.claudeCode.available ? 'available' : 'missing';
  };

  const getClaudeApiStatus = (): DependencyStatus => {
    if (!prerequisites) return 'missing';
    return prerequisites.claudeApi.available ? 'available' : 'missing';
  };

  const getOllamaStatus = (): DependencyStatus => {
    if (!prerequisites) return 'missing';
    if (prerequisites.ollama.running) return 'available';
    if (prerequisites.ollama.installed) return 'warning';
    return 'missing';
  };

  const getOllamaDetails = (): string => {
    if (!prerequisites) return '';
    if (prerequisites.ollama.running) {
      return prerequisites.ollama.version || 'Running';
    }
    if (prerequisites.ollama.installed) {
      return 'Installed but not running';
    }
    return '';
  };

  const hasAnalysisMethods = prerequisites && prerequisites.analysisMethods.length > 0;
  const hasTranscriptionMethods = prerequisites && prerequisites.transcriptionMethods.length > 0;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="prerequisites-panel">
        <div className="panel-header">
          <h2>Prerequisites</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="panel-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Checking dependencies...</span>
            </div>
          ) : (
            <>
              {/* Required Dependencies */}
              <section className="dependency-section">
                <h3>Required Dependencies</h3>
                <DependencyItem
                  name="FFmpeg"
                  status={getFFmpegStatus()}
                  details={getFFmpegDetails()}
                  installInstructions="brew install ffmpeg"
                />
              </section>

              {/* Analysis Methods */}
              <section className="dependency-section">
                <h3>Analysis Methods</h3>
                <p className="section-note">At least one analysis method is required</p>
                <DependencyItem
                  name="Claude Code CLI"
                  status={getClaudeCodeStatus()}
                  details={prerequisites?.claudeCode.available ? `Installed at ${prerequisites.claudeCode.path}` : ''}
                  installInstructions="npm install -g @anthropic-ai/claude-code"
                  isOptional
                />
                <DependencyItem
                  name="Claude API"
                  status={getClaudeApiStatus()}
                  details={prerequisites?.claudeApi.available ? 'API key configured' : ''}
                  installInstructions="Set ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable"
                  isOptional
                />
                <DependencyItem
                  name="Ollama (LLaVA)"
                  status={getOllamaStatus()}
                  details={getOllamaDetails()}
                  installInstructions="brew install ollama && ollama serve"
                  isOptional
                />
                {!hasAnalysisMethods && prerequisites && (
                  <div className="warning-message">
                    No analysis methods available. Install Claude Code CLI, configure Claude API key, or install Ollama.
                  </div>
                )}
              </section>

              {/* Transcription Methods */}
              <section className="dependency-section">
                <h3>Transcription Methods</h3>
                <p className="section-note">At least one transcription method is required</p>
                <DependencyItem
                  name="Whisper (Local)"
                  status={getWhisperStatus()}
                  details={getWhisperDetails()}
                  installInstructions="brew install whisper-cpp or pip install openai-whisper"
                  isOptional
                />
                <DependencyItem
                  name="OpenAI Whisper API"
                  status={prerequisites?.openaiKey.available ? 'available' : 'missing'}
                  details={prerequisites?.openaiKey.available ? 'API key configured' : ''}
                  installInstructions="Set OPENAI_API_KEY environment variable"
                  isOptional
                />
                {!hasTranscriptionMethods && prerequisites && (
                  <div className="warning-message">
                    No transcription methods available. Install Whisper or configure OpenAI API key.
                  </div>
                )}
              </section>

              {/* Available Methods Summary */}
              {prerequisites && (
                <section className="summary-section">
                  <h3>Available Methods</h3>
                  <div className="methods-summary">
                    <div className="method-group">
                      <strong>Analysis:</strong>{' '}
                      {prerequisites.analysisMethods.length > 0
                        ? prerequisites.analysisMethods.join(', ')
                        : 'None available'}
                    </div>
                    <div className="method-group">
                      <strong>Transcription:</strong>{' '}
                      {prerequisites.transcriptionMethods.length > 0
                        ? prerequisites.transcriptionMethods.join(', ')
                        : 'None available'}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <div className="panel-footer">
          <button className="action-button" onClick={checkPrerequisites} disabled={isLoading}>
            {isLoading ? 'Checking...' : 'Check Again'}
          </button>
          <button className="action-button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default PrerequisitesPanel;
