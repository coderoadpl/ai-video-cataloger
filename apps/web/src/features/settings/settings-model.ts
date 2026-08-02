import type { z } from 'zod';

import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  WHISPER_MODEL_NAMES,
  configSchema,
  type AppConfig,
  type ConfigKey,
  type CredentialDeletion,
  type CredentialsBackendStatus,
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

export const KEYS_WITHOUT_EDITOR = [
  'whisper_language',
  'whisper_api_base_url',
  'whisper_api_model',
  'timeout',
] as const satisfies readonly ConfigKey[];

export type OtherSettingsKey = (typeof KEYS_WITHOUT_EDITOR)[number];

export interface EffectiveSetting {
  key: OtherSettingsKey;
  label: string;
  value: string;
}

type StoredConfig = z.output<typeof storedConfigSchema>;
type StoredDefaults = z.output<typeof storedConfigDefaultsSchema>;

export const draftFromStored = (config: StoredConfig, defaults: StoredDefaults): SettingsDraft => {
  const raw = {
    whisper_binary_path: config.whisper_binary_path ?? defaults.whisper_binary_path,
    whisper_model: config.whisper_model ?? defaults.whisper_model,
    whisper_language: config.whisper_language ?? defaults.whisper_language,
    whisper_mode: config.whisper_mode ?? defaults.whisper_mode,
    frames: config.frames ?? defaults.frames,
    timeout: config.timeout ?? defaults.timeout,
    skip_rename: config.skip_rename ?? defaults.skip_rename,
    analyzer_backend: config.analyzer_backend ?? defaults.analyzer_backend,
    local_model: config.local_model ?? defaults.local_model,
    faces_enabled: config.faces_enabled ?? defaults.faces_enabled,
    gemini_batch_mode: config.gemini_batch_mode ?? defaults.gemini_batch_mode,
    gemini_monthly_budget_usd: config.gemini_monthly_budget_usd ?? defaults.gemini_monthly_budget_usd,
    output_language: config.output_language ?? defaults.output_language,
    ui_language: config.ui_language ?? defaults.ui_language,
    ...(config.analyzer_provider === null ? {} : { analyzer_provider: config.analyzer_provider }),
    ...(config.tag_language === null ? {} : { tag_language: config.tag_language }),
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

export type CredentialNoticeSeverity = 'success' | 'warning' | 'info' | 'error';

export interface CredentialNotice {
  message: string;
  severity: CredentialNoticeSeverity;
}

export const credentialDeletionNotice = (
  dictionary: Dictionary,
  deletion: CredentialDeletion,
): CredentialNotice => ({
  message: credentialDeletionMessage(dictionary, deletion),
  severity: deletion.unreadableEntry !== undefined || deletion.retained.length > 0
    ? 'warning'
    : deletion.cleared.length > 0 ? 'success' : 'info',
});

export const credentialDeletionMessage = (
  dictionary: Dictionary,
  deletion: CredentialDeletion,
): string => {
  if (deletion.unreadableEntry !== undefined && deletion.cleared.length === 0) {
    return deletion.retained.includes('keychain')
      ? `${dictionary.credentials.entryUnreadable} ${dictionary.credentials.keychainRetained}`
      : dictionary.credentials.entryUnreadable;
  }
  if (deletion.cleared.length === 0) {
    return deletion.retained.includes('keychain')
      ? dictionary.credentials.keychainRetained
      : dictionary.credentials.notStored;
  }
  const cleared = deletion.cleared.includes('keychain')
    ? deletion.cleared.includes('file')
      ? dictionary.credentials.clearedBoth
      : dictionary.credentials.clearedKeychain
    : dictionary.credentials.clearedFile;
  const withKeychain = deletion.retained.includes('keychain')
    ? `${cleared} ${dictionary.credentials.keychainRetained}`
    : cleared;
  return deletion.unreadableEntry === undefined
    ? withKeychain
    : `${withKeychain} ${dictionary.credentials.entryUnreadableRetained}`;
};

export const credentialSavedMessage = (
  dictionary: Dictionary,
  backend: CredentialsBackendStatus,
): string => backend.backend === 'keychain'
  ? dictionary.credentials.savedKeychain
  : dictionary.credentials.savedFile;

const languageValue = (dictionary: Dictionary, value: string): string => {
  if (value === 'auto') return dictionary.language.optionAuto;
  if (value === 'pl') return dictionary.language.optionPolish;
  if (value === 'en') return dictionary.language.optionEnglish;
  return value;
};

const analyzerProviderValue = (provider: AppConfig['analyzer_provider']): string => {
  switch (provider.family) {
    case 'api':
      return `${provider.model} · ${provider.providerId}`;
    case 'harness':
      return provider.model === undefined ? provider.providerId : `${provider.model} · ${provider.providerId}`;
    case 'local':
      return provider.modelTag;
    case 'gemini-native':
      return provider.model;
  }
};

const booleanValue = (dictionary: Dictionary, value: boolean): string =>
  value ? dictionary.settingsModal.valueEnabled : dictionary.settingsModal.valueDisabled;

const resolvedSettingValue = (
  dictionary: Dictionary,
  config: AppConfig,
  key: ConfigKey,
): string => {
  switch (key) {
    case 'whisper_binary_path':
      return config.whisper_binary_path.length === 0
        ? dictionary.settingsModal.valueNotSet
        : config.whisper_binary_path;
    case 'whisper_model':
      return dictionary.settingsModal.whisperModels[config.whisper_model].label;
    case 'whisper_language':
      return languageValue(dictionary, config.whisper_language);
    case 'whisper_mode':
      return dictionary.settingsModal.whisperModes[config.whisper_mode].label;
    case 'whisper_api_base_url':
      return config.whisper_api_base_url;
    case 'whisper_api_model':
      return config.whisper_api_model;
    case 'frames':
      return dictionary.settingsModal.frameCountValue(config.frames);
    case 'timeout':
      return dictionary.settingsModal.secondsValue(config.timeout);
    case 'skip_rename':
      return booleanValue(dictionary, config.skip_rename);
    case 'analyzer_backend':
      return config.analyzer_backend === 'local'
        ? dictionary.settingsAnalyzer.localOllama
        : dictionary.settingsAnalyzer.claudeCli;
    case 'local_model':
      return config.local_model;
    case 'analyzer_provider':
      return analyzerProviderValue(config.analyzer_provider);
    case 'faces_enabled':
      return booleanValue(dictionary, config.faces_enabled);
    case 'gemini_batch_mode':
      return booleanValue(dictionary, config.gemini_batch_mode);
    case 'gemini_monthly_budget_usd':
      return config.gemini_monthly_budget_usd === null
        ? dictionary.settingsModal.valueNoLimit
        : `${String(config.gemini_monthly_budget_usd)} USD`;
    case 'output_language':
      return languageValue(dictionary, config.output_language);
    case 'tag_language':
      return languageValue(dictionary, config.tag_language);
    case 'ui_language':
      return languageValue(dictionary, config.ui_language);
  }
};

export const otherSettings = (
  dictionary: Dictionary,
  config: AppConfig,
): EffectiveSetting[] => KEYS_WITHOUT_EDITOR.map((key) => ({
  key,
  label: dictionary.settingsModal.otherSettingsKeys[key],
  value: resolvedSettingValue(dictionary, config, key),
}));

export type BudgetInput =
  | { kind: 'empty' }
  | { kind: 'valid'; amountUsd: number }
  | { kind: 'invalid' };

export const parseBudgetInput = (raw: string): BudgetInput => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return { kind: 'invalid' };
  const amountUsd = Number(trimmed.replace(',', '.'));
  return amountUsd > 0 ? { kind: 'valid', amountUsd } : { kind: 'invalid' };
};

export const formatBudgetInput = (amountUsd: number | null): string =>
  amountUsd === null ? '' : String(amountUsd);

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
