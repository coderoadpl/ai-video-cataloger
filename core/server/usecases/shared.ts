import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  geminiCostEstimateSchema,
  ok,
  type AppConfig,
  type AppError,
  type ConfigKey,
  type CatalogVariant,
  type Result,
  type VideoStatus,
} from '@core/domain/index.js';
import {
  analyzerBackendSchema,
  configValueSchema,
  outputLanguageSchema,
  whisperLanguageSchema,
  whisperModeSchema,
} from '@core/domain/config.js';
import { whisperModelNameSchema } from '@core/domain/models.js';
import { analyzerProviderConfigSchema } from '@core/domain/providers.js';
import { z } from 'zod';

import type { FileSystemPort } from '../ports.js';
import type { ArtifactRoot } from './artifact-root.js';
import { parseRichSegments, type HallucinationSegment } from './transcript-hallucinations.js';

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;
export const GRID_THUMBNAIL_EDGE = 512;
export const IN_PROGRESS_STATUSES: readonly VideoStatus[] = [
  'frames_extracted',
  'audio_extracted',
  'transcribed',
  'analyzed',
] as const;

export const summaryDataSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  suggestedFilename: z.string(),
  fullAnalysis: z.string(),
  tags: z.array(z.string()).default([]),
  analyzedAt: z.string(),
  costEstimate: geminiCostEstimateSchema.optional(),
  usage: z.record(z.string(), z.json()).optional(),
});

export type SummaryData = z.output<typeof summaryDataSchema>;

export const isSupportedVideoExtension = (extension: string): boolean =>
  VIDEO_EXTENSIONS.some((videoExtension) => videoExtension === extension.toLowerCase());

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.ai-video-cataloger',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.TemporaryItems',
  'System Volume Information',
  'frames',
  'transcripts',
  'summaries',
]);

export const shouldSkipDirectory = (name: string): boolean =>
  name.startsWith('.') || EXCLUDED_DIRECTORY_NAMES.has(name);

export const isUnderExcludedDirectory = (fs: FileSystemPort, path: string): boolean => {
  let current = fs.dirname(path);
  for (;;) {
    const name = fs.basename(current);
    if (name === '') return false;
    if (shouldSkipDirectory(name)) return true;
    const parent = fs.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};

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

export const variantProvenanceLabel = (variant: CatalogVariant): string => {
  if (variant.configId === 'legacy') return 'settings partly unknown';
  return [variant.analyzer, variant.model]
    .filter((value): value is string => value !== null && value.length > 0)
    .join(' / ') || variant.configId;
};

export const artifactBaseName = (fs: FileSystemPort, videoPath: string, newName: string | null): string => {
  if (newName !== null) return stripExtension(newName);
  return fs.basenameWithoutExtension(videoPath);
};

export const artifactPaths = (
  fs: FileSystemPort,
  root: ArtifactRoot,
  videoPath: string,
  newName: string | null,
): {
  framesDir: string;
  transcriptPath: string;
  transcriptJsonPath: string;
  summaryPath: string;
  summaryJsonPath: string;
  debugLogPath: string;
  thumbnailPath: string;
  gridThumbnailPath: string;
} => {
  const baseName = artifactBaseName(fs, videoPath, newName);
  return {
    framesDir: fs.join(root.path, 'frames', baseName),
    transcriptPath: fs.join(root.path, 'transcripts', `${baseName}.txt`),
    transcriptJsonPath: fs.join(root.path, 'transcripts', `${baseName}.json`),
    summaryPath: fs.join(root.path, 'summaries', `${baseName}.txt`),
    summaryJsonPath: fs.join(root.path, 'summaries', `${baseName}.json`),
    debugLogPath: fs.join(root.path, 'summaries', `${baseName}-debug.log`),
    thumbnailPath: fs.join(root.catalogDirectory, 'thumbnails', `${baseName}.jpg`),
    gridThumbnailPath: fs.join(root.catalogDirectory, 'thumbnails', `${baseName}.grid.jpg`),
  };
};

export const thumbnailArtifactPath = (fs: FileSystemPort, root: ArtifactRoot, videoPath: string): string =>
  fs.join(root.catalogDirectory, 'thumbnails', `${fs.basenameWithoutExtension(videoPath)}.jpg`);

export const gridThumbnailArtifactPath = (fs: FileSystemPort, root: ArtifactRoot, videoPath: string): string =>
  fs.join(root.catalogDirectory, 'thumbnails', `${fs.basenameWithoutExtension(videoPath)}.grid.jpg`);

export const readRichSegments = async (
  fs: FileSystemPort,
  transcriptJsonPath: string,
): Promise<HallucinationSegment[] | null> => {
  const content = await fs.readTextFile(transcriptJsonPath);
  if (!content.ok || content.value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.value);
  } catch {
    return null;
  }
  return parseRichSegments(decoded);
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

export const stringifyConfigValue = (value: AppConfig[ConfigKey]): string =>
  typeof value === 'object' ? JSON.stringify(value) : String(value);

export const configValueForKey = (key: ConfigKey, value: string): AppConfig[ConfigKey] => {
  switch (key) {
    case 'whisper_binary_path':
      return configValueSchema.shape.whisper_binary_path.parse(value);
    case 'whisper_model':
      return whisperModelNameSchema.parse(value);
    case 'whisper_language':
      return whisperLanguageSchema.parse(value);
    case 'whisper_mode':
      return whisperModeSchema.parse(value);
    case 'whisper_api_base_url':
      return configValueSchema.shape.whisper_api_base_url.parse(value);
    case 'whisper_api_model':
      return configValueSchema.shape.whisper_api_model.parse(value);
    case 'frames':
      return configValueSchema.shape.frames.parse(value);
    case 'timeout':
      return configValueSchema.shape.timeout.parse(value);
    case 'skip_rename':
      return configValueSchema.shape.skip_rename.parse(value);
    case 'analyzer_backend':
      return analyzerBackendSchema.parse(value);
    case 'local_model':
      return configValueSchema.shape.local_model.parse(value);
    case 'analyzer_provider': {
      const decoded: unknown = JSON.parse(value);
      return analyzerProviderConfigSchema.parse(decoded);
    }
    case 'faces_enabled':
      return configValueSchema.shape.faces_enabled.parse(value);
    case 'gemini_batch_mode':
      return configValueSchema.shape.gemini_batch_mode.parse(value);
    case 'gemini_monthly_budget_usd':
      return configValueSchema.shape.gemini_monthly_budget_usd.parse(value);
    case 'output_language':
      return configValueSchema.shape.output_language.parse(value);
    case 'tag_language':
      return outputLanguageSchema.parse(value);
    case 'ui_language':
      return configValueSchema.shape.ui_language.parse(value);
    case 'backup_enabled':
      return configValueSchema.shape.backup_enabled.parse(value);
    case 'backup_provider':
      return configValueSchema.shape.backup_provider.parse(value);
    case 'backup_include_optional':
      return configValueSchema.shape.backup_include_optional.parse(value);
    case 'backup_keep_last':
      return configValueSchema.shape.backup_keep_last.parse(value);
    case 'backup_keep_weekly':
      return configValueSchema.shape.backup_keep_weekly.parse(value);
    case 'backup_folder_id':
      return configValueSchema.shape.backup_folder_id.parse(value);
    case 'backup_shared_drive_id':
      return configValueSchema.shape.backup_shared_drive_id.parse(value);
    case 'backup_service_account_fingerprint':
      return configValueSchema.shape.backup_service_account_fingerprint.parse(value);
    case 'backup_account_email':
      return configValueSchema.shape.backup_account_email.parse(value);
  }
};

const stripExtension = (filename: string): string => {
  const index = filename.lastIndexOf('.');
  if (index <= 0) return filename;
  return filename.slice(0, index);
};

export const emptyStoredConfig = (): Record<ConfigKey, string | null> => ({
  whisper_binary_path: null,
  whisper_model: null,
  whisper_language: null,
  whisper_mode: null,
  whisper_api_base_url: null,
  whisper_api_model: null,
  frames: null,
  timeout: null,
  skip_rename: null,
  analyzer_backend: null,
  local_model: null,
  analyzer_provider: null,
  faces_enabled: null,
  gemini_batch_mode: null,
  gemini_monthly_budget_usd: null,
  output_language: null,
  tag_language: null,
  ui_language: null,
  backup_enabled: null,
  backup_provider: null,
  backup_include_optional: null,
  backup_keep_last: null,
  backup_keep_weekly: null,
  backup_folder_id: null,
  backup_shared_drive_id: null,
  backup_service_account_fingerprint: null,
  backup_account_email: null,
});

export const storedDefaults = (): Record<ConfigKey, string> => ({
  whisper_binary_path: stringifyConfigDefault('whisper_binary_path'),
  whisper_model: stringifyConfigDefault('whisper_model'),
  whisper_language: stringifyConfigDefault('whisper_language'),
  whisper_mode: stringifyConfigDefault('whisper_mode'),
  whisper_api_base_url: stringifyConfigDefault('whisper_api_base_url'),
  whisper_api_model: stringifyConfigDefault('whisper_api_model'),
  frames: stringifyConfigDefault('frames'),
  timeout: stringifyConfigDefault('timeout'),
  skip_rename: stringifyConfigDefault('skip_rename'),
  analyzer_backend: stringifyConfigDefault('analyzer_backend'),
  local_model: stringifyConfigDefault('local_model'),
  analyzer_provider: stringifyConfigDefault('analyzer_provider'),
  faces_enabled: stringifyConfigDefault('faces_enabled'),
  gemini_batch_mode: stringifyConfigDefault('gemini_batch_mode'),
  gemini_monthly_budget_usd: stringifyConfigDefault('gemini_monthly_budget_usd'),
  output_language: stringifyConfigDefault('output_language'),
  tag_language: stringifyConfigDefault('tag_language'),
  ui_language: stringifyConfigDefault('ui_language'),
  backup_enabled: stringifyConfigDefault('backup_enabled'),
  backup_provider: stringifyConfigDefault('backup_provider'),
  backup_include_optional: stringifyConfigDefault('backup_include_optional'),
  backup_keep_last: stringifyConfigDefault('backup_keep_last'),
  backup_keep_weekly: stringifyConfigDefault('backup_keep_weekly'),
  backup_folder_id: stringifyConfigDefault('backup_folder_id'),
  backup_shared_drive_id: stringifyConfigDefault('backup_shared_drive_id'),
  backup_service_account_fingerprint: stringifyConfigDefault('backup_service_account_fingerprint'),
  backup_account_email: stringifyConfigDefault('backup_account_email'),
});

export const configKeys = (): readonly ConfigKey[] => CONFIG_KEYS;

export type OfflineReason = 'drive-disconnected' | 'file-missing';

const VOLUME_ROOT_PATTERN = /^(\/Volumes\/[^/]+)(?:\/|$)/;

export const classifyOfflineFolder = async (
  fs: FileSystemPort,
  folderPath: string,
): Promise<Result<OfflineReason, AppError>> => {
  const volumeRoot = VOLUME_ROOT_PATTERN.exec(folderPath)?.[1];
  if (volumeRoot === undefined) return ok('file-missing');
  const rootExists = await fs.exists(volumeRoot);
  if (!rootExists.ok) return rootExists;
  return ok(rootExists.value ? 'file-missing' : 'drive-disconnected');
};
