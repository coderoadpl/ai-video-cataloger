/**
 * Shared types and option lists for the Settings modal (kept separate to
 * keep the modal component readable).
 */

import type { AnalyzerBackend } from '@/components/settings-analyzer-section';

export type { AnalyzerBackend };

// Config types matching the CLI config service
export type WhisperMode = 'local' | 'api' | 'skip';
export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface ConfigValues {
  whisper_model: WhisperModel;
  whisper_mode: WhisperMode;
  frames: number;
  timeout: number;
  skip_rename: boolean;
  analyzer_backend: AnalyzerBackend;
  local_model: string;
}


// Default values from the CLI config service
export const DEFAULT_CONFIG: ConfigValues = {
  whisper_model: 'base',
  whisper_mode: 'local',
  frames: 3,
  timeout: 120,
  skip_rename: false,
  analyzer_backend: 'claude',
  local_model: 'gemma3:12b',
};
// Whisper models with descriptions
export const WHISPER_MODELS: { value: WhisperModel; label: string; description: string }[] = [
  { value: 'tiny', label: 'Tiny', description: 'Fastest, lowest accuracy' },
  { value: 'base', label: 'Base', description: 'Good balance of speed and accuracy' },
  { value: 'small', label: 'Small', description: 'Better accuracy, slower' },
  { value: 'medium', label: 'Medium', description: 'High accuracy, slow' },
  { value: 'large-v3', label: 'Large v3', description: 'Best accuracy, slowest' },
];
// Whisper modes with descriptions
export const WHISPER_MODES: { value: WhisperMode; label: string; description: string }[] = [
  { value: 'local', label: 'Local (Whisper.cpp)', description: 'Uses local whisper.cpp binary' },
  { value: 'api', label: 'API (OpenAI)', description: 'Uses OpenAI Whisper API' },
  { value: 'skip', label: 'Skip Transcription', description: 'Do not transcribe audio' },
];
