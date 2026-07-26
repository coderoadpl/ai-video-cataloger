import type { z } from 'zod';

import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  WHISPER_MODEL_NAMES,
  configSchema,
  type AppConfig,
  type ConfigKey,
  type CredentialDeletion,
} from '@core/domain/index.js';
import type {
  localAiTierSchema,
  machineSchema,
  storedConfigDefaultsSchema,
  storedConfigSchema,
} from '@core/contract/index.js';

import { type Dictionary } from '../../i18n/dictionary.js';

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
    output_language: config.output_language ?? defaults.output_language,
    ui_language: config.ui_language ?? defaults.ui_language,
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

export const analyzerCredentialRef = (draft: SettingsDraft): string | null => {
  const provider = draft.analyzer_provider;
  return provider.family === 'api' || provider.family === 'gemini-native' ? provider.apiKeyRef : null;
};

export const credentialDeletionMessage = (
  dictionary: Dictionary,
  deletion: CredentialDeletion,
): string => {
  const cleared = deletion.cleared.includes('keychain')
    ? deletion.cleared.includes('file')
      ? dictionary.credentials.clearedBoth
      : dictionary.credentials.clearedKeychain
    : deletion.cleared.includes('file')
      ? dictionary.credentials.clearedFile
      : dictionary.credentials.notStored;
  return deletion.retained.includes('keychain')
    ? `${cleared} ${dictionary.credentials.keychainRetained}`
    : cleared;
};

export const serializeValue = (draft: SettingsDraft, key: ConfigKey): string => {
  const value = draft[key];
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export interface OutputLanguageOption {
  value: string;
}

export const OUTPUT_LANGUAGE_OPTIONS: OutputLanguageOption[] = [
  { value: 'auto' },
  { value: 'en' },
  { value: 'pl' },
];

export const UI_LANGUAGE_OPTIONS: Array<{ value: AppConfig['ui_language'] }> = [
  { value: 'en' },
  { value: 'pl' },
];

export interface WhisperModeOption {
  value: AppConfig['whisper_mode'];
  label: string;
  description: string;
}

export const whisperModeOptions = (dictionary: Dictionary): WhisperModeOption[] => [
  { value: 'local', ...dictionary.settingsModal.whisperModes.local },
  { value: 'api', ...dictionary.settingsModal.whisperModes.api },
  { value: 'skip', ...dictionary.settingsModal.whisperModes.skip },
];

export interface WhisperModelOption {
  value: AppConfig['whisper_model'];
  label: string;
  description: string;
}

export const whisperModelOptions = (dictionary: Dictionary): WhisperModelOption[] =>
  WHISPER_MODEL_NAMES.map((value) => ({ value, ...dictionary.settingsModal.whisperModels[value] }));
