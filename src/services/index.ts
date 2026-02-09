/**
 * Services barrel export
 */

export { checkPrerequisites, type PrerequisiteOptions } from './prerequisites.js';
export { scanDirectory, type ScanResult, type ScanOptions } from './scanner.js';
export { extractFrames, getFramesDir } from './frames.js';
export {
  extractAudio,
  getTempAudioPath,
  getTempAudioDir,
  cleanupTempAudio,
  type AudioExtractionResult,
} from './audio.js';
export {
  transcribeAudio,
  getTranscriptsDir,
  getTranscriptPath,
  type TranscriptionResult,
  type TranscriptionOptions,
} from './transcription.js';
export {
  analyzeVideo,
  getSummariesDir,
  getSummaryPath,
  getSuggestedFilenameFromSummary,
  type AnalysisResult,
  type AnalysisOptions,
} from './analyzer.js';
export {
  renameVideo,
  type RenameResult,
} from './renamer.js';
export {
  runInteractiveMenu,
  countVideosInDirectory,
  displayCurrentSettings,
  type MenuSettings,
  type MenuAction,
} from './menu.js';
