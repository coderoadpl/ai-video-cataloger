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
  getLegacyWhisperCacheDir,
  downloadModel,
  deleteModel,
  getModelDownloadUrl,
  getModelFilePath,
  type WhisperModelName,
  type WhisperModelInfo,
  type ModelDownloadResult,
  type ModelDeleteResult,
} from './models.js';
export { displayStatus, getStatusData, type VideoStatusData, type StatusSummary } from './status.js';
export {
  resetAllVideos,
  resetSingleVideo,
  type ResetOptions,
} from './reset.js';
export {
  configureFfmpeg,
  getFFmpegPath,
  getFFprobePath,
  getFFmpegVersion,
  getFFmpegInfo,
  isBundledFFmpegAvailable,
  isBundledFFprobeAvailable,
  isFFmpegAvailable,
  isFFprobeAvailable,
  getCliBinDir,
} from './ffmpeg-setup.js';
export {
  configureWhisper,
  getWhisperPath,
  getWhisperVersion,
  getWhisperInfo,
  isBundledWhisperAvailable,
  isWhisperAvailable,
  getWhisperModelsDir,
  ensureWhisperModelsDirExists,
  isModelInModelsDir,
  getModelPath,
} from './whisper-setup.js';
export {
  setJsonMode,
  isJsonMode,
  emitStarted,
  emitProgress,
  emitCompleted,
  emitError,
  outputJson,
  logHuman,
  logHumanError,
  type JsonEvent,
  type JsonEventType,
  type JsonStartedEvent,
  type JsonProgressEvent,
  type JsonCompletedEvent,
  type JsonErrorEvent,
} from './json-output.js';
export {
  generateThumbnail,
  getThumbnailPath,
  getThumbnailsDir,
  getThumbnailFilename,
  thumbnailExists,
  type ThumbnailResult,
} from './thumbnail.js';
