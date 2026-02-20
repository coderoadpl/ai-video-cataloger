/**
 * Services barrel export
 */

export { checkPrerequisites, type PrerequisiteOptions } from './prerequisites.js';
export { scanDirectory, type ScanResult, type ScanOptions } from './scanner.js';
export { extractFrames, getFramesDir, checkExistingFrames } from './frames.js';
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
  checkExistingTranscript,
  type TranscriptionResult,
  type TranscriptionOptions,
} from './transcription.js';
export {
  analyzeVideo,
  getSummariesDir,
  getSummaryPath,
  getSuggestedFilenameFromSummary,
  getDebugLogPath,
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
  configureSettings,
  type MenuSettings,
  type MenuAction,
  type WhisperModel,
} from './menu.js';
export {
  listModels,
  displayModelList,
  isModelDownloaded,
  getActiveModel,
  setActiveModel,
  isValidModelName,
  getWhisperCacheDir,
  type WhisperModelName,
  type WhisperModelInfo,
} from './models.js';
export { displayStatus } from './status.js';
export {
  resetAllVideos,
  resetSingleVideo,
  type ResetOptions,
} from './reset.js';
