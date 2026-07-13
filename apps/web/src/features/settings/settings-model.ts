import type { z } from 'zod';

import { CONFIG_DEFAULTS, CONFIG_KEYS, configSchema, type AppConfig, type ConfigKey } from '@core/domain/index.js';
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
  const raw: Record<ConfigKey, string> = {
    whisper_model: config.whisper_model ?? defaults.whisper_model,
    whisper_mode: config.whisper_mode ?? defaults.whisper_mode,
    frames: config.frames ?? defaults.frames,
    timeout: config.timeout ?? defaults.timeout,
    skip_rename: config.skip_rename ?? defaults.skip_rename,
    analyzer_backend: config.analyzer_backend ?? defaults.analyzer_backend,
    local_model: config.local_model ?? defaults.local_model,
  };
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : CONFIG_DEFAULTS;
};

export const changedKeys = (draft: SettingsDraft, original: SettingsDraft): ConfigKey[] =>
  CONFIG_KEYS.filter((key) => draft[key] !== original[key]);

export const serializeValue = (draft: SettingsDraft, key: ConfigKey): string => String(draft[key]);

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

export const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = [
  { value: 'tiny', label: 'Tiny', description: 'Fastest, lowest accuracy' },
  { value: 'base', label: 'Base', description: 'Good balance of speed and accuracy' },
  { value: 'small', label: 'Small', description: 'Better accuracy, slower' },
  { value: 'medium', label: 'Medium', description: 'High accuracy, slow' },
  { value: 'large-v3', label: 'Large v3', description: 'Best accuracy, slowest' },
];
