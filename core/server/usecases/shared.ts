import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  type AppConfig,
  type ConfigKey,
  type VideoStatus,
} from '@core/domain/index.js';
import {
  analyzerBackendSchema,
  configSchema,
  whisperModeSchema,
} from '@core/domain/config.js';
import { whisperModelNameSchema } from '@core/domain/models.js';
import { z } from 'zod';

import type { FileSystemPort } from '../ports.js';

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;
export const IN_PROGRESS_STATUSES: readonly VideoStatus[] = [
  'frames_extracted',
  'audio_extracted',
  'transcribed',
  'analyzed',
] as const;

const summaryDataSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  analyzedAt: z.string(),
});

export type SummaryData = z.output<typeof summaryDataSchema>;

export const isSupportedVideoExtension = (extension: string): boolean =>
  VIDEO_EXTENSIONS.some((videoExtension) => videoExtension === extension.toLowerCase());

export const isInProgressStatus = (status: VideoStatus): boolean =>
  IN_PROGRESS_STATUSES.some((candidate) => candidate === status);

export const statusLabel = (status: VideoStatus): string => {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'frames_extracted':
      return 'In Progress (frames extracted)';
    case 'audio_extracted':
      return 'In Progress (audio extracted)';
    case 'transcribed':
      return 'In Progress (transcribed)';
    case 'analyzed':
      return 'In Progress (analyzed)';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
  }
};

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const paddedSecs = secs.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${paddedSecs}`;
  return `${minutes}:${paddedSecs}`;
};

export const artifactBaseName = (fs: FileSystemPort, videoPath: string, newName: string | null): string => {
  if (newName !== null) return stripExtension(newName);
  return fs.basenameWithoutExtension(videoPath);
};

export const artifactPaths = (
  fs: FileSystemPort,
  folder: string,
  videoPath: string,
  newName: string | null,
): {
  framesDir: string;
  transcriptPath: string;
  summaryPath: string;
  summaryJsonPath: string;
  debugLogPath: string;
  thumbnailPath: string;
} => {
  const baseName = artifactBaseName(fs, videoPath, newName);
  return {
    framesDir: fs.join(folder, 'frames', baseName),
    transcriptPath: fs.join(folder, 'transcripts', `${baseName}.txt`),
    summaryPath: fs.join(folder, 'summaries', `${baseName}.txt`),
    summaryJsonPath: fs.join(folder, 'summaries', `${baseName}.json`),
    debugLogPath: fs.join(folder, 'summaries', `${baseName}-debug.log`),
    thumbnailPath: fs.join(folder, '.ai-video-cataloger', 'thumbnails', `${baseName}.jpg`),
  };
};

export const parseSummary = (content: string | null): SummaryData | null => {
  if (content === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = summaryDataSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
};

export const stringifyConfigDefault = (key: ConfigKey): string => stringifyConfigValue(CONFIG_DEFAULTS[key]);

export const stringifyConfigValue = (value: AppConfig[ConfigKey]): string => String(value);

export const configValueForKey = (key: ConfigKey, value: string): AppConfig[ConfigKey] => {
  switch (key) {
    case 'whisper_model':
      return whisperModelNameSchema.parse(value);
    case 'whisper_mode':
      return whisperModeSchema.parse(value);
    case 'frames':
      return configSchema.shape.frames.parse(value);
    case 'timeout':
      return configSchema.shape.timeout.parse(value);
    case 'skip_rename':
      return configSchema.shape.skip_rename.parse(value);
    case 'analyzer_backend':
      return analyzerBackendSchema.parse(value);
    case 'local_model':
      return configSchema.shape.local_model.parse(value);
  }
};

const stripExtension = (filename: string): string => {
  const index = filename.lastIndexOf('.');
  if (index <= 0) return filename;
  return filename.slice(0, index);
};

export const emptyStoredConfig = (): Record<ConfigKey, string | null> => ({
  whisper_model: null,
  whisper_mode: null,
  frames: null,
  timeout: null,
  skip_rename: null,
  analyzer_backend: null,
  local_model: null,
});

export const storedDefaults = (): Record<ConfigKey, string> => ({
  whisper_model: stringifyConfigDefault('whisper_model'),
  whisper_mode: stringifyConfigDefault('whisper_mode'),
  frames: stringifyConfigDefault('frames'),
  timeout: stringifyConfigDefault('timeout'),
  skip_rename: stringifyConfigDefault('skip_rename'),
  analyzer_backend: stringifyConfigDefault('analyzer_backend'),
  local_model: stringifyConfigDefault('local_model'),
});

export const configKeys = (): readonly ConfigKey[] => CONFIG_KEYS;
