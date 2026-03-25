/**
 * First Launch Setup Wizard Component
 */
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/SetupWizard.css';

interface SetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenFolder: () => void;
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface Prerequisites {
  ffmpeg: { available: boolean; version: string; bundled: boolean };
  whisper: { available: boolean; type: string | null };
  ollama: { installed: boolean; running: boolean };
  claudeCode: { available: boolean; version: string | null; path: string | null };
  claudeApi: { available: boolean };
  analysisMethods: string[];
  transcriptionMethods: string[];
}

interface WhisperModel {
  name: string;
  filename: string;
  path: string;
  sizeBytes: number;
}

interface LlavaModel {
  name: string;
  tag: string;
  description: string;
  sizeGb: number;
  minRamGb: number;
  isPulled: boolean;
}

function SetupWizard({
  isOpen,
  onClose,
  onComplete,
  onOpenFolder,
}: SetupWizardProps): React.ReactElement | null {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [prerequisites, setPrerequisites] = useState<Prerequisites | null>(null);
  const [analysisMethod, setAnalysisMethod] = useState<'claude-code' | 'claude-api' | 'ollama'>('claude-code');
  const [transcriptionMethod, setTranscriptionMethod] = useState<'local' | 'api'>('local');
  const [whisperModels, setWhisperModels] = useState<WhisperModel[]>([]);
  const [llavaModels, setLlavaModels] = useState<LlavaModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load prerequisites on mount
  useEffect(() => {
    if (isOpen && currentStep === 2) {
      loadPrerequisites();
    }
  }, [isOpen, currentStep]);

  // Load models on step 5
  useEffect(() => {
    if (isOpen && currentStep === 5) {
      loadModels();
    }
  }, [isOpen, currentStep]);

  const loadPrerequisites = async () => {
    setIsLoading(true);
    try {
      const prereqs = await window.electronAPI.checkPrerequisites();
      setPrerequisites(prereqs);

      // Set default analysis method based on availability
      if (prereqs.claudeCode?.available) {
        setAnalysisMethod('claude-code');
      } else if (prereqs.claudeApi?.available) {
        setAnalysisMethod('claude-api');
      } else if (prereqs.ollama?.installed) {
        setAnalysisMethod('ollama');
      }
    } catch (error) {
      console.error('Failed to load prerequisites:', error);
    }
    setIsLoading(false);
  };

  const loadModels = async () => {
    setIsLoading(true);
    try {
      const [whisperResult, ollamaResult] = await Promise.all([
        window.electronAPI.getWhisperModels(),
        window.electronAPI.getOllamaStatus(),
      ]);
      setWhisperModels(whisperResult.models);
      setLlavaModels(ollamaResult.llavaModels || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
    setIsLoading(false);
  };

  const handleNext = () => {
    if (currentStep < 6) {
      setCurrentStep((currentStep + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as WizardStep);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const handleFinish = useCallback(async () => {
    // Save settings
    try {
      await window.electronAPI.saveAnalysisSettings({
        method: analysisMethod,
        ollamaModel: 'llava:7b',
      });
      await window.electronAPI.saveWhisperSettings({
        preferBuiltIn: transcriptionMethod === 'local',
        selectedModel: 'base.en',
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }

    onComplete();
    onOpenFolder();
  }, [analysisMethod, transcriptionMethod, onComplete, onOpenFolder]);

  if (!isOpen) {
    return null;
  }

  const renderStepIndicator = () => (
    <div className="wizard-steps">
      {[1, 2, 3, 4, 5, 6].map((step) => (
        <div
          key={step}
          className={`wizard-step-dot ${step === currentStep ? 'active' : ''} ${step < currentStep ? 'completed' : ''}`}
        />
      ))}
    </div>
  );

  const renderStep1Welcome = () => (
    <div className="wizard-step">
      <div className="wizard-icon">🎬</div>
      <h2>Welcome to AI Video Cataloger</h2>
      <p className="wizard-description">
        This wizard will help you set up the app to analyze your video collection
        using AI-powered transcription and visual analysis.
      </p>
      <div className="wizard-features">
        <div className="feature">
          <span className="feature-icon">🖼️</span>
          <span>Extract key frames from videos</span>
        </div>
        <div className="feature">
          <span className="feature-icon">🎤</span>
          <span>Transcribe audio to text</span>
        </div>
        <div className="feature">
          <span className="feature-icon">🤖</span>
          <span>Generate AI summaries and titles</span>
        </div>
      </div>
    </div>
  );

  const renderStep2Prerequisites = () => (
    <div className="wizard-step">
      <h2>Prerequisites Check</h2>
      <p className="wizard-description">
        Let's verify your system has everything needed.
      </p>
      {isLoading ? (
        <div className="wizard-loading">Checking prerequisites...</div>
      ) : prerequisites ? (
        <div className="prereq-list">
          <div className={`prereq-item ${prerequisites.ffmpeg?.available ? 'available' : 'missing'}`}>
            <span className="prereq-icon">{prerequisites.ffmpeg?.available ? '✓' : '✕'}</span>
            <div className="prereq-info">
              <span className="prereq-name">FFmpeg</span>
              <span className="prereq-status">
                {prerequisites.ffmpeg?.available
                  ? prerequisites.ffmpeg.bundled ? 'Bundled' : 'Installed'
                  : 'Not found'}
              </span>
            </div>
          </div>
          <div className={`prereq-item ${prerequisites.whisper?.available ? 'available' : 'warning'}`}>
            <span className="prereq-icon">{prerequisites.whisper?.available ? '✓' : '⚠'}</span>
            <div className="prereq-info">
              <span className="prereq-name">Whisper (Transcription)</span>
              <span className="prereq-status">
                {prerequisites.whisper?.available
                  ? `${prerequisites.whisper.type} available`
                  : 'Not found - will use API'}
              </span>
            </div>
          </div>
          <div className={`prereq-item ${prerequisites.claudeCode?.available ? 'available' : 'warning'}`}>
            <span className="prereq-icon">{prerequisites.claudeCode?.available ? '✓' : '⚠'}</span>
            <div className="prereq-info">
              <span className="prereq-name">Claude Code CLI</span>
              <span className="prereq-status">
                {prerequisites.claudeCode?.available ? 'Installed' : 'Not found'}
              </span>
            </div>
          </div>
          <div className={`prereq-item ${prerequisites.claudeApi?.available ? 'available' : 'warning'}`}>
            <span className="prereq-icon">{prerequisites.claudeApi?.available ? '✓' : '⚠'}</span>
            <div className="prereq-info">
              <span className="prereq-name">Claude API Key</span>
              <span className="prereq-status">
                {prerequisites.claudeApi?.available ? 'API key found' : 'No API key set'}
              </span>
            </div>
          </div>
          <div className={`prereq-item ${prerequisites.ollama?.installed ? 'available' : 'warning'}`}>
            <span className="prereq-icon">{prerequisites.ollama?.installed ? '✓' : '⚠'}</span>
            <div className="prereq-info">
              <span className="prereq-name">Ollama (Local AI)</span>
              <span className="prereq-status">
                {prerequisites.ollama?.installed
                  ? prerequisites.ollama.running ? 'Running' : 'Installed (not running)'
                  : 'Not installed'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="wizard-error">Failed to check prerequisites</div>
      )}
    </div>
  );

  const renderStep3AnalysisMethod = () => {
    const claudeCodeAvailable = prerequisites?.claudeCode?.available;
    const claudeApiAvailable = prerequisites?.claudeApi?.available;
    const ollamaAvailable = prerequisites?.ollama?.installed;
    const noneAvailable = !claudeCodeAvailable && !claudeApiAvailable && !ollamaAvailable;

    return (
      <div className="wizard-step">
        <h2>Choose Analysis Method</h2>
        <p className="wizard-description">
          Select how you want to analyze your videos.
        </p>
        {noneAvailable && (
          <p className="wizard-warning">
            No analysis method is currently available. You can still select your preferred method and configure it later in Settings.
          </p>
        )}
        <div className="method-options">
          <button
            className={`method-option ${analysisMethod === 'claude-code' ? 'selected' : ''} ${!claudeCodeAvailable ? 'unavailable' : ''}`}
            onClick={() => setAnalysisMethod('claude-code')}
          >
            <div className="method-header">
              <span className="method-icon">🖥️</span>
              <span className="method-name">Claude Code CLI</span>
              {claudeCodeAvailable && <span className="method-badge available">Installed</span>}
              {!claudeCodeAvailable && <span className="method-badge unavailable">Not Found</span>}
            </div>
            <p className="method-desc">
              Use the Claude Code CLI tool for analysis. Best quality, works offline with your Claude subscription.
            </p>
          </button>
          <button
            className={`method-option ${analysisMethod === 'claude-api' ? 'selected' : ''} ${!claudeApiAvailable ? 'unavailable' : ''}`}
            onClick={() => setAnalysisMethod('claude-api')}
          >
            <div className="method-header">
              <span className="method-icon">☁️</span>
              <span className="method-name">Claude API</span>
              {claudeApiAvailable && <span className="method-badge available">API Key Set</span>}
              {!claudeApiAvailable && <span className="method-badge unavailable">No API Key</span>}
            </div>
            <p className="method-desc">
              Direct API calls to Claude. Requires ANTHROPIC_API_KEY environment variable.
            </p>
          </button>
          <button
            className={`method-option ${analysisMethod === 'ollama' ? 'selected' : ''} ${!ollamaAvailable ? 'unavailable' : ''}`}
            onClick={() => setAnalysisMethod('ollama')}
          >
            <div className="method-header">
              <span className="method-icon">💻</span>
              <span className="method-name">Ollama (Local)</span>
              {ollamaAvailable && <span className="method-badge available">Installed</span>}
              {!ollamaAvailable && <span className="method-badge unavailable">Not Installed</span>}
            </div>
            <p className="method-desc">
              Run LLaVA locally for private, offline analysis. Free and fully local.
            </p>
          </button>
        </div>
      </div>
    );
  };

  const renderStep4TranscriptionMethod = () => (
    <div className="wizard-step">
      <h2>Choose Transcription Method</h2>
      <p className="wizard-description">
        Select how you want to transcribe audio.
      </p>
      <div className="method-options">
        <button
          className={`method-option ${transcriptionMethod === 'local' ? 'selected' : ''}`}
          onClick={() => setTranscriptionMethod('local')}
        >
          <div className="method-header">
            <span className="method-icon">💻</span>
            <span className="method-name">Local Whisper</span>
          </div>
          <p className="method-desc">
            Run whisper.cpp locally for private, offline transcription.
          </p>
        </button>
        <button
          className={`method-option ${transcriptionMethod === 'api' ? 'selected' : ''}`}
          onClick={() => setTranscriptionMethod('api')}
        >
          <div className="method-header">
            <span className="method-icon">☁️</span>
            <span className="method-name">Whisper API</span>
          </div>
          <p className="method-desc">
            Use OpenAI's Whisper API for faster transcription. Requires API key.
          </p>
        </button>
      </div>
    </div>
  );

  const renderStep5Models = () => {
    const hasWhisperModel = whisperModels.length > 0;
    const hasLlavaModel = llavaModels.some(m => m.isPulled);
    const hasSystemWhisper = prerequisites?.whisper?.available;
    const whisperReady = hasWhisperModel || hasSystemWhisper;

    return (
      <div className="wizard-step">
        <h2>Download Models</h2>
        <p className="wizard-description">
          Check if you have the required models downloaded.
        </p>
        {isLoading ? (
          <div className="wizard-loading">Checking models...</div>
        ) : (
          <div className="models-status">
            <div className={`model-item ${whisperReady ? 'available' : 'missing'}`}>
              <span className="model-icon">{whisperReady ? '✓' : '⚠'}</span>
              <div className="model-info">
                <span className="model-name">Whisper (Transcription)</span>
                <span className="model-status">
                  {hasSystemWhisper && hasWhisperModel
                    ? `System whisper available + ${whisperModels.length} GGML model(s)`
                    : hasSystemWhisper
                    ? `System whisper available (${prerequisites?.whisper?.type})`
                    : hasWhisperModel
                    ? `${whisperModels.length} GGML model(s) downloaded`
                    : 'No whisper available'}
                </span>
              </div>
            </div>
            {analysisMethod === 'ollama' && (
              <div className={`model-item ${hasLlavaModel ? 'available' : 'missing'}`}>
                <span className="model-icon">{hasLlavaModel ? '✓' : '⚠'}</span>
                <div className="model-info">
                  <span className="model-name">LLaVA Models</span>
                  <span className="model-status">
                    {hasLlavaModel
                      ? `${llavaModels.filter(m => m.isPulled).length} model(s) ready`
                      : 'No models pulled yet'}
                  </span>
                </div>
              </div>
            )}
            <p className="models-note">
              {whisperReady
                ? 'Transcription is ready! You can optionally download additional models from Settings → Manage Models.'
                : 'You can download models later from Settings → Manage Models.'}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderStep6Ready = () => (
    <div className="wizard-step">
      <div className="wizard-icon success">✓</div>
      <h2>You're All Set!</h2>
      <p className="wizard-description">
        The setup is complete. Click the button below to open a folder
        and start cataloging your videos.
      </p>
      <div className="setup-summary">
        <div className="summary-item">
          <span className="summary-label">Analysis:</span>
          <span className="summary-value">
            {analysisMethod === 'claude-code' ? 'Claude Code CLI' :
             analysisMethod === 'claude-api' ? 'Claude API' : 'Ollama (Local)'}
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Transcription:</span>
          <span className="summary-value">
            {transcriptionMethod === 'local' ? 'Local Whisper' : 'Whisper API'}
          </span>
        </div>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1Welcome();
      case 2:
        return renderStep2Prerequisites();
      case 3:
        return renderStep3AnalysisMethod();
      case 4:
        return renderStep4TranscriptionMethod();
      case 5:
        return renderStep5Models();
      case 6:
        return renderStep6Ready();
      default:
        return null;
    }
  };

  return (
    <div className="wizard-overlay" onClick={handleSkip}>
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          {renderStepIndicator()}
          <button className="wizard-skip" onClick={handleSkip}>
            Skip Setup
          </button>
        </div>

        <div className="wizard-content">
          {renderCurrentStep()}
        </div>

        <div className="wizard-footer">
          {currentStep > 1 && (
            <button className="wizard-button secondary" onClick={handleBack}>
              Back
            </button>
          )}
          <div className="wizard-footer-spacer" />
          {currentStep < 6 ? (
            <button className="wizard-button primary" onClick={handleNext}>
              Next
            </button>
          ) : (
            <button className="wizard-button primary" onClick={handleFinish}>
              Open Folder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupWizard;
