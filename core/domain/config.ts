import { z } from 'zod';

import { WHISPER_MODEL_NAMES, whisperModelNameSchema } from './models.js';
import { analyzerProviderConfigSchema, legacyAnalyzerProvider } from './providers.js';

export const WHISPER_MODES = ['local', 'api', 'skip'] as const;
export const ANALYZER_BACKENDS = ['claude', 'local'] as const;

export const whisperModeSchema = z.enum(WHISPER_MODES);
export const analyzerBackendSchema = z.enum(ANALYZER_BACKENDS);

export const OUTPUT_LANGUAGES = ['auto', 'en', 'pl'] as const;
export const WHISPER_LANGUAGES = ['auto', 'en', 'pl'] as const;
const bcp47LikePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const outputLanguageSchema = z
  .string()
  .trim()
  .refine((value) => value === 'auto' || bcp47LikePattern.test(value), {
    message: 'Output language must be "auto" or a BCP-47-like code (e.g. en, pl, pt-BR)',
  });
export type OutputLanguage = z.output<typeof outputLanguageSchema>;

export const whisperLanguageSchema = z.union([
  z.enum(WHISPER_LANGUAGES),
  z.string().trim().regex(bcp47LikePattern, {
    message: 'Whisper language must be "auto" or a BCP-47-like code (e.g. en, pl, pt-BR)',
  }),
]);
export type WhisperLanguage = z.output<typeof whisperLanguageSchema>;

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English',
  pl: 'Polish',
};

export const UI_LANGUAGES = ['en', 'pl'] as const;
export const uiLanguageSchema = z.enum(UI_LANGUAGES);
export type UiLanguage = z.output<typeof uiLanguageSchema>;

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

const nullablePositiveNumberFromPersistedValue = (value: unknown): unknown => {
  if (value === null || value === '' || value === 'null') return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return value;
  return Number(value);
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
  whisper_language: whisperLanguageSchema.default('auto'),
  whisper_mode: whisperModeSchema.default('local'),
  whisper_api_base_url: z.url().default('https://api.openai.com/v1'),
  whisper_api_model: z.string().trim().min(1).default('whisper-1'),
  frames: z.preprocess(integerFromPersistedValue, z.number().int().min(1).max(10)).default(3),
  timeout: z.preprocess(integerFromPersistedValue, z.number().int().min(30).max(600)).default(120),
  skip_rename: z.preprocess(booleanFromPersistedValue, z.boolean()).default(false),
  analyzer_backend: analyzerBackendSchema.default('claude'),
  local_model: z.string().min(1).default('gemma3:12b'),
  analyzer_provider: z.preprocess(providerFromPersistedValue, analyzerProviderConfigSchema.optional()),
  faces_enabled: z.preprocess(booleanFromPersistedValue, z.boolean()).default(false),
  gemini_batch_mode: z.preprocess(booleanFromPersistedValue, z.boolean()).default(false),
  gemini_monthly_budget_usd: z.preprocess(nullablePositiveNumberFromPersistedValue, z.number().positive().nullable()).default(null),
  output_language: outputLanguageSchema.default('auto'),
  tag_language: outputLanguageSchema.optional(),
  ui_language: uiLanguageSchema.default('en'),
});

export const configSchema = configValueSchema.transform((config) => ({
  ...config,
  tag_language: config.tag_language ?? config.output_language,
  analyzer_provider: config.analyzer_provider ?? legacyAnalyzerProvider(config.analyzer_backend, config.local_model),
}));

export type AppConfig = z.output<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export const CONFIG_KEYS = [
  'whisper_binary_path',
  'whisper_model',
  'whisper_language',
  'whisper_mode',
  'whisper_api_base_url',
  'whisper_api_model',
  'frames',
  'timeout',
  'skip_rename',
  'analyzer_backend',
  'local_model',
  'analyzer_provider',
  'faces_enabled',
  'gemini_batch_mode',
  'gemini_monthly_budget_usd',
  'output_language',
  'tag_language',
  'ui_language',
] as const;

export const configKeySchema = z.enum(CONFIG_KEYS);
export type ConfigKey = z.output<typeof configKeySchema>;

export const APP_GLOBAL_CONFIG_KEYS: readonly ConfigKey[] = ['ui_language', 'faces_enabled', 'gemini_monthly_budget_usd'];

export const isAppGlobalConfigKey = (key: ConfigKey): boolean => APP_GLOBAL_CONFIG_KEYS.includes(key);

export const configPatchSchema = configValueSchema.partial();

export const CONFIG_DEFAULTS = configSchema.parse({});

export const configDescriptions: Record<ConfigKey, string> = {
  whisper_binary_path: 'Path to a custom whisper.cpp executable',
  whisper_model: `Whisper model (${WHISPER_MODEL_NAMES.join(', ')})`,
  whisper_language: 'Transcription language (auto, en, pl, or a BCP-47 code)',
  whisper_mode: 'Transcription mode',
  whisper_api_base_url: 'OpenAI-compatible Whisper API base URL',
  whisper_api_model: 'OpenAI-compatible Whisper API model',
  frames: 'Number of frames to extract for analysis',
  timeout: 'Analyzer timeout in seconds',
  skip_rename: 'Skip automatic video renaming',
  analyzer_backend: 'AI analyzer backend',
  local_model: 'Local AI model tag',
  analyzer_provider: 'Analyzer provider configuration',
  faces_enabled: 'Experimental local face grouping (opt-in, all data stays on this machine)',
  gemini_batch_mode: 'Send gemini-native drive runs through the Gemini Batch API (half price, results may take up to 24h)',
  gemini_monthly_budget_usd: 'Pause Gemini drive runs when the local monthly estimated spend reaches this amount in USD',
  output_language: 'Language for generated descriptions and filenames (auto, en, pl, or a BCP-47 code)',
  tag_language: 'Language of generated tags (auto, en, pl, or a BCP-47 code); unset follows output_language',
  ui_language: 'Language of the desktop app interface (en, pl)',
};
