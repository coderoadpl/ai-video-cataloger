import { z } from 'zod';

import { WHISPER_MODEL_NAMES, whisperModelNameSchema } from './models.js';
import { analyzerProviderConfigSchema, legacyAnalyzerProvider } from './providers.js';

export const WHISPER_MODES = ['local', 'api', 'skip'] as const;
export const ANALYZER_BACKENDS = ['claude', 'local'] as const;

export const whisperModeSchema = z.enum(WHISPER_MODES);
export const analyzerBackendSchema = z.enum(ANALYZER_BACKENDS);

const integerFromPersistedValue = (value: unknown): unknown => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  if (!/^-?\d+$/.test(value)) return value;
  return Number(value);
};

const booleanFromPersistedValue = (value: unknown): unknown => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return value;
};

const providerFromPersistedValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const configValueSchema = z.object({
  whisper_binary_path: z.string().default(''),
  whisper_model: whisperModelNameSchema.default('base'),
  whisper_mode: whisperModeSchema.default('local'),
  whisper_api_base_url: z.string().url().default('https://api.openai.com/v1'),
  whisper_api_model: z.string().trim().min(1).default('whisper-1'),
  frames: z.preprocess(integerFromPersistedValue, z.number().int().min(1).max(10)).default(3),
  timeout: z.preprocess(integerFromPersistedValue, z.number().int().min(30).max(600)).default(120),
  skip_rename: z.preprocess(booleanFromPersistedValue, z.boolean()).default(false),
  analyzer_backend: analyzerBackendSchema.default('claude'),
  local_model: z.string().min(1).default('gemma3:12b'),
  analyzer_provider: z.preprocess(providerFromPersistedValue, analyzerProviderConfigSchema.optional()),
});

export const configSchema = configValueSchema.transform((config) => ({
  ...config,
  analyzer_provider: config.analyzer_provider ?? legacyAnalyzerProvider(config.analyzer_backend, config.local_model),
}));

export type AppConfig = z.output<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export const CONFIG_KEYS = [
  'whisper_binary_path',
  'whisper_model',
  'whisper_mode',
  'whisper_api_base_url',
  'whisper_api_model',
  'frames',
  'timeout',
  'skip_rename',
  'analyzer_backend',
  'local_model',
  'analyzer_provider',
] as const;

export const configKeySchema = z.enum(CONFIG_KEYS);
export type ConfigKey = z.output<typeof configKeySchema>;

export const configPatchSchema = configValueSchema.partial();

export const CONFIG_DEFAULTS = configSchema.parse({});

export const configDescriptions: Record<ConfigKey, string> = {
  whisper_binary_path: 'Path to a custom whisper.cpp executable',
  whisper_model: `Whisper model (${WHISPER_MODEL_NAMES.join(', ')})`,
  whisper_mode: 'Transcription mode',
  whisper_api_base_url: 'OpenAI-compatible Whisper API base URL',
  whisper_api_model: 'OpenAI-compatible Whisper API model',
  frames: 'Number of frames to extract for analysis',
  timeout: 'Analyzer timeout in seconds',
  skip_rename: 'Skip automatic video renaming',
  analyzer_backend: 'AI analyzer backend',
  local_model: 'Local AI model tag',
  analyzer_provider: 'Analyzer provider configuration',
};
