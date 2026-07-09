/**
 * Configuration service for AI Video Cataloger
 * Manages per-folder configuration via .ai-video-cataloger/config.json
 */

import chalk from 'chalk';
import { getConfig, setConfig } from '../db/index.js';
import { isJsonMode, emitStarted, emitCompleted, emitError, outputJson, logHuman } from './json-output.js';
import type { WhisperMode } from '../types/index.js';
import type { WhisperModel } from './menu.js';

/**
 * Known configuration keys with their types and validation rules
 */
export interface ConfigSchema {
  whisper_model: WhisperModel;
  whisper_mode: WhisperMode;
  frames: number;
  timeout: number;
  skip_rename: boolean;
  analyzer_backend: 'claude' | 'local';
  local_model: string;
}

/**
 * Configuration key definitions with validation
 */
interface ConfigKeyDef {
  type: 'string' | 'number' | 'boolean';
  description: string;
  allowedValues?: string[];
  min?: number;
  max?: number;
  defaultValue: string;
}

export const CONFIG_KEYS: Record<keyof ConfigSchema, ConfigKeyDef> = {
  whisper_model: {
    type: 'string',
    description: 'Whisper model to use for transcription',
    allowedValues: ['tiny', 'base', 'small', 'medium', 'large-v3'],
    defaultValue: 'base',
  },
  whisper_mode: {
    type: 'string',
    description: 'Transcription mode: local, api, or skip',
    allowedValues: ['local', 'api', 'skip'],
    defaultValue: 'local',
  },
  frames: {
    type: 'number',
    description: 'Number of frames to extract from videos',
    min: 1,
    max: 10,
    defaultValue: '3',
  },
  timeout: {
    type: 'number',
    description: 'Timeout for Claude analysis in seconds',
    min: 30,
    max: 600,
    defaultValue: '120',
  },
  skip_rename: {
    type: 'boolean',
    description: 'Skip renaming files after analysis',
    defaultValue: 'false',
  },
  analyzer_backend: {
    type: 'string',
    description: 'AI analysis backend: claude (Claude Code CLI) or local (Ollama)',
    allowedValues: ['claude', 'local'],
    defaultValue: 'claude',
  },
  local_model: {
    type: 'string',
    description: 'Local AI model tag used when analyzer_backend is local',
    defaultValue: 'gemma3:12b',
  },
};

export type ConfigKey = keyof ConfigSchema;

/**
 * Check if a key is a known configuration key
 */
export function isValidConfigKey(key: string): key is ConfigKey {
  return key in CONFIG_KEYS;
}

/**
 * Get list of all valid configuration keys
 */
export function getValidConfigKeys(): ConfigKey[] {
  return Object.keys(CONFIG_KEYS) as ConfigKey[];
}

/**
 * Validate a configuration value for a given key
 */
export function validateConfigValue(key: ConfigKey, value: string): { valid: boolean; error?: string; normalizedValue?: string } {
  const keyDef = CONFIG_KEYS[key];

  switch (keyDef.type) {
    case 'string':
      if (keyDef.allowedValues && !keyDef.allowedValues.includes(value)) {
        return {
          valid: false,
          error: `Invalid value "${value}". Allowed values: ${keyDef.allowedValues.join(', ')}`,
        };
      }
      return { valid: true, normalizedValue: value };

    case 'number': {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        return { valid: false, error: `Value must be a number` };
      }
      if (keyDef.min !== undefined && num < keyDef.min) {
        return { valid: false, error: `Value must be at least ${keyDef.min}` };
      }
      if (keyDef.max !== undefined && num > keyDef.max) {
        return { valid: false, error: `Value must be at most ${keyDef.max}` };
      }
      return { valid: true, normalizedValue: String(num) };
    }

    case 'boolean': {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        return { valid: true, normalizedValue: 'true' };
      }
      if (lower === 'false' || lower === '0' || lower === 'no') {
        return { valid: true, normalizedValue: 'false' };
      }
      return { valid: false, error: `Value must be a boolean (true/false, yes/no, 1/0)` };
    }
  }
}

/**
 * Get all configuration values
 */
export interface ConfigGetAllResult {
  config: Record<string, string | null>;
  defaults: Record<string, string>;
}

export function getAllConfig(): ConfigGetAllResult {
  const config: Record<string, string | null> = {};
  const defaults: Record<string, string> = {};

  for (const key of getValidConfigKeys()) {
    config[key] = getConfig(key);
    defaults[key] = CONFIG_KEYS[key].defaultValue;
  }

  return { config, defaults };
}

/**
 * Get a single configuration value
 */
export interface ConfigGetResult {
  key: string;
  value: string | null;
  defaultValue: string;
  description: string;
}

export function getConfigValue(key: ConfigKey): ConfigGetResult {
  const keyDef = CONFIG_KEYS[key];
  return {
    key,
    value: getConfig(key),
    defaultValue: keyDef.defaultValue,
    description: keyDef.description,
  };
}

/**
 * Set a configuration value
 */
export interface ConfigSetResult {
  key: string;
  value: string;
  previousValue: string | null;
}

export function setConfigValue(key: ConfigKey, value: string): ConfigSetResult {
  const previousValue = getConfig(key);
  setConfig(key, value);
  return { key, value, previousValue };
}

/**
 * Display all configuration (CLI command handler)
 */
export function displayAllConfig(): void {
  const { config, defaults } = getAllConfig();

  if (isJsonMode()) {
    emitStarted('config_get', { key: null });
    outputJson({ config, defaults });
    emitCompleted({ config, defaults });
    return;
  }

  logHuman('\n' + chalk.bold('Configuration:'));
  logHuman('');

  for (const key of getValidConfigKeys()) {
    const keyDef = CONFIG_KEYS[key];
    const value = config[key];
    const displayValue = value ?? chalk.gray(`(default: ${keyDef.defaultValue})`);

    logHuman(`  ${chalk.cyan(key)}: ${value ? chalk.green(value) : displayValue}`);
    logHuman(chalk.gray(`    ${keyDef.description}`));

    if (keyDef.allowedValues) {
      logHuman(chalk.gray(`    Allowed: ${keyDef.allowedValues.join(', ')}`));
    }
    if (keyDef.min !== undefined || keyDef.max !== undefined) {
      const range = [];
      if (keyDef.min !== undefined) range.push(`min: ${keyDef.min}`);
      if (keyDef.max !== undefined) range.push(`max: ${keyDef.max}`);
      logHuman(chalk.gray(`    Range: ${range.join(', ')}`));
    }
    logHuman('');
  }
}

/**
 * Display a single configuration key (CLI command handler)
 */
export function displayConfigKey(key: string): boolean {
  if (!isValidConfigKey(key)) {
    if (isJsonMode()) {
      emitError(`Unknown configuration key: ${key}`, {
        code: 'UNKNOWN_CONFIG_KEY',
        data: { key, validKeys: getValidConfigKeys() },
      });
    } else {
      logHuman(chalk.red(`\n✗ Unknown configuration key: ${key}`));
      logHuman(chalk.gray(`  Valid keys: ${getValidConfigKeys().join(', ')}`));
    }
    return false;
  }

  const result = getConfigValue(key);

  if (isJsonMode()) {
    emitStarted('config_get', { key });
    outputJson(result);
    emitCompleted({ ...result });
    return true;
  }

  logHuman('');
  const keyDef = CONFIG_KEYS[key];
  const displayValue = result.value ?? chalk.gray(`(not set, default: ${result.defaultValue})`);

  logHuman(`${chalk.cyan(key)}: ${result.value ? chalk.green(result.value) : displayValue}`);
  logHuman(chalk.gray(`  ${keyDef.description}`));

  if (keyDef.allowedValues) {
    logHuman(chalk.gray(`  Allowed: ${keyDef.allowedValues.join(', ')}`));
  }
  if (keyDef.min !== undefined || keyDef.max !== undefined) {
    const range = [];
    if (keyDef.min !== undefined) range.push(`min: ${keyDef.min}`);
    if (keyDef.max !== undefined) range.push(`max: ${keyDef.max}`);
    logHuman(chalk.gray(`  Range: ${range.join(', ')}`));
  }
  logHuman('');

  return true;
}

/**
 * Set a configuration value (CLI command handler)
 */
export function setConfigCommand(key: string, value: string): boolean {
  // Validate key
  if (!isValidConfigKey(key)) {
    if (isJsonMode()) {
      emitError(`Unknown configuration key: ${key}`, {
        code: 'UNKNOWN_CONFIG_KEY',
        data: { key, validKeys: getValidConfigKeys() },
      });
    } else {
      logHuman(chalk.red(`\n✗ Unknown configuration key: ${key}`));
      logHuman(chalk.gray(`  Valid keys: ${getValidConfigKeys().join(', ')}`));
    }
    return false;
  }

  // Validate value
  const validation = validateConfigValue(key, value);
  if (!validation.valid) {
    if (isJsonMode()) {
      emitError(`Invalid value for ${key}: ${validation.error}`, {
        code: 'INVALID_CONFIG_VALUE',
        data: { key, value, error: validation.error },
      });
    } else {
      logHuman(chalk.red(`\n✗ Invalid value for ${key}: ${validation.error}`));
    }
    return false;
  }

  // Set the value (use normalized value)
  const normalizedValue = validation.normalizedValue!;
  const result = setConfigValue(key, normalizedValue);

  if (isJsonMode()) {
    emitStarted('config_set', { key, value: normalizedValue });
    emitCompleted({ ...result });
    return true;
  }

  logHuman('');
  if (result.previousValue === null) {
    logHuman(chalk.green(`✓ Set ${chalk.cyan(key)} to ${chalk.bold(normalizedValue)}`));
  } else if (result.previousValue === normalizedValue) {
    logHuman(chalk.yellow(`${chalk.cyan(key)} is already set to ${chalk.bold(normalizedValue)}`));
  } else {
    logHuman(chalk.green(`✓ Changed ${chalk.cyan(key)} from ${chalk.gray(result.previousValue)} to ${chalk.bold(normalizedValue)}`));
  }
  logHuman('');

  return true;
}
