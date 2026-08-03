import {
  configDescriptions,
  appError,
  isAppGlobalConfigKey,
  ok,
  type AppError,
  type ConfigKey,
  type Result,
} from '@core/domain/index.js';

import type { ConfigStore, FileSystemPort } from '../ports.js';
import { resolveConfigValues, type ConfigValueSource } from './config-resolution.js';
import {
  configKeys,
  configValueForKey,
  emptyStoredConfig,
  storedDefaults,
  stringifyConfigValue,
} from './shared.js';

export interface ConfigDeps {
  config: ConfigStore;
  fs: FileSystemPort;
}

export type ConfigGetOutput =
  | {
      config: Record<ConfigKey, string | null>;
      defaults: Record<ConfigKey, string>;
      effective: Record<ConfigKey, string>;
      sources: Record<ConfigKey, ConfigValueSource>;
    }
  | {
      key: ConfigKey;
      value: string | null;
      defaultValue: string;
      description: string;
      effectiveValue: string;
      source: ConfigValueSource;
      ignoredFolderValue: string | null;
    };

export interface ConfigSetOutput {
  key: ConfigKey;
  value: string;
  previousValue: string | null;
  scope: 'home' | 'folder';
  ignoredFolderValue: string | null;
}

export interface ConfigUnsetOutput {
  key: ConfigKey;
  previousValue: string | null;
  scope: 'folder';
}

export const getConfig = async (
  deps: ConfigDeps,
  input: { folder?: string | undefined; key: ConfigKey | null },
): Promise<Result<ConfigGetOutput, AppError>> => {
  const folder = input.folder === undefined ? undefined : deps.fs.resolve(input.folder);
  const scope = folder === undefined ? { kind: 'home' } as const : { kind: 'folder', folder } as const;
  const resolved = await resolveConfigValues(deps.config, folder);
  if (!resolved.ok) return resolved;
  if (input.key !== null) {
    const readScope = isAppGlobalConfigKey(input.key) ? { kind: 'home' } as const : scope;
    const value = await deps.config.get(readScope, input.key);
    if (!value.ok) return value;
    return ok({
      key: input.key,
      value: value.value,
      defaultValue: storedDefaults()[input.key],
      description: configDescriptions[input.key],
      effectiveValue: resolved.value.effective[input.key],
      source: resolved.value.sources[input.key],
      ignoredFolderValue: ignoredFolderValue(resolved.value.folder, input.key),
    });
  }

  const config = emptyStoredConfig();
  for (const key of configKeys()) {
    config[key] = (folder === undefined ? resolved.value.home[key] : resolved.value.folder[key]) ?? null;
  }
  return ok({
    config,
    defaults: storedDefaults(),
    effective: resolved.value.effective,
    sources: resolved.value.sources,
  });
};

export const setConfig = async (
  deps: ConfigDeps,
  input: { folder?: string | undefined; key: ConfigKey; value: string },
): Promise<Result<ConfigSetOutput, AppError>> => {
  let normalized: string;
  try {
    normalized = stringifyConfigValue(configValueForKey(input.key, input.value));
  } catch (cause) {
    return {
      ok: false,
      error: appError('invalid_config_value', `Invalid value for ${input.key}: ${String(cause)}`, {
        key: input.key,
        value: input.value,
      }),
    };
  }

  const appGlobal = isAppGlobalConfigKey(input.key);
  const scope = input.folder === undefined || appGlobal
    ? { kind: 'home' } as const
    : { kind: 'folder', folder: deps.fs.resolve(input.folder) } as const;
  const stored = await deps.config.set(scope, input.key, normalized);
  if (!stored.ok) return stored;
  const folderValues = input.folder === undefined || !appGlobal
    ? ok<Partial<Record<ConfigKey, string>>>({})
    : await deps.config.getAll({ kind: 'folder', folder: deps.fs.resolve(input.folder) });
  if (!folderValues.ok) return folderValues;
  return ok({
    key: input.key,
    value: normalized,
    previousValue: stored.value.previousValue,
    scope: scope.kind,
    ignoredFolderValue: ignoredFolderValue(folderValues.value, input.key),
  });
};

export const unsetConfig = async (
  deps: ConfigDeps,
  input: { folder: string; key: ConfigKey },
): Promise<Result<ConfigUnsetOutput, AppError>> => {
  const scope = { kind: 'folder', folder: deps.fs.resolve(input.folder) } as const;
  const deleted = await deps.config.delete(scope, input.key);
  if (!deleted.ok) return deleted;
  return ok({ key: input.key, previousValue: deleted.value.previousValue, scope: 'folder' });
};

const ignoredFolderValue = (
  folderValues: Partial<Record<ConfigKey, string>>,
  key: ConfigKey,
): string | null => (isAppGlobalConfigKey(key) ? folderValues[key] ?? null : null);
