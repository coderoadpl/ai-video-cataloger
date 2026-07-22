import type { z } from 'zod';

import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  WHISPER_MODEL_NAMES,
  configSchema,
  type AppConfig,
  type ConfigKey,
} from '@core/domain/index.js';
import type {
  localAiTierSchema,
  machineSchema,
  storedConfigDefaultsSchema,
  storedConfigSchema,
} from '@core/contract/index.js';

export type SettingsDraft = AppConfig;
export type LocalAiTier = z.output<typeof localAiTierSchema>;
export type Machine = z.output<typeof machineSchema>;

type StoredConfig = z.output<typeof storedConfigSchema>;
type StoredDefaults = z.output<typeof storedConfigDefaultsSchema>;

export const draftFromStored = (config: StoredConfig, defaults: StoredDefaults): SettingsDraft => {
  const raw = {
    whisper_binary_path: config.whisper_binary_path ?? defaults.whisper_binary_path,
    whisper_model: config.whisper_model ?? defaults.whisper_model,
    whisper_mode: config.whisper_mode ?? defaults.whisper_mode,
    frames: config.frames ?? defaults.frames,
    timeout: config.timeout ?? defaults.timeout,
    skip_rename: config.skip_rename ?? defaults.skip_rename,
    analyzer_backend: config.analyzer_backend ?? defaults.analyzer_backend,
    local_model: config.local_model ?? defaults.local_model,
    faces_enabled: config.faces_enabled ?? defaults.faces_enabled,
    ...(config.analyzer_provider === null ? {} : { analyzer_provider: config.analyzer_provider }),
  };
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : CONFIG_DEFAULTS;
};

export const draftFromEffective = (effective: StoredDefaults): SettingsDraft => {
  const parsed = configSchema.safeParse(effective);
  return parsed.success ? parsed.data : CONFIG_DEFAULTS;
};

export const changedKeys = (draft: SettingsDraft, original: SettingsDraft): ConfigKey[] =>
  CONFIG_KEYS.filter((key) => draft[key] !== original[key]);

export const serializeValue = (draft: SettingsDraft, key: ConfigKey): string => {
  const value = draft[key];
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export interface WhisperModeOption {
  value: AppConfig['whisper_mode'];
  label: string;
  description: string;
}

export const WHISPER_MODE_OPTIONS: WhisperModeOption[] = [
  { value: 'local', label: 'Local (Whisper.cpp)', description: 'Uses local whisper.cpp binary' },
  { value: 'api', label: 'API (OpenAI)', description: 'Uses OpenAI Whisper API' },
  { value: 'skip', label: 'Skip Transcription', description: 'Do not transcribe audio' },
];

export interface WhisperModelOption {
  value: AppConfig['whisper_model'];
  label: string;
  description: string;
}

const WHISPER_MODEL_DETAILS: Record<AppConfig['whisper_model'], Omit<WhisperModelOption, 'value'>> = {
  tiny: { label: 'Tiny', description: 'Fastest, lowest accuracy' },
  base: { label: 'Base', description: 'Good balance of speed and accuracy' },
  small: { label: 'Small', description: 'Better accuracy, slower' },
  medium: { label: 'Medium', description: 'High accuracy, slow' },
  'large-v3': { label: 'Large v3', description: 'Best accuracy, slowest' },
  'large-v3-turbo': { label: 'Large v3 turbo', description: 'Large v3 accuracy, faster and smaller' },
};

export const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = WHISPER_MODEL_NAMES.map((value) => ({
  value,
  ...WHISPER_MODEL_DETAILS[value],
}));
