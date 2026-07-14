import {
  configDescriptions,
  appError,
  ok,
  type AppError,
  type ConfigKey,
  type Result,
} from '@core/domain/index.js';

import type { ConfigStore, FileSystemPort } from '../ports.js';
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
    }
  | {
      key: ConfigKey;
      value: string | null;
      defaultValue: string;
      description: string;
    };

export interface ConfigSetOutput {
  key: ConfigKey;
  value: string;
  previousValue: string | null;
}

export const getConfig = async (
  deps: ConfigDeps,
  input: { folder?: string | undefined; key: ConfigKey | null },
): Promise<Result<ConfigGetOutput, AppError>> => {
  const scope = { kind: 'folder', folder: deps.fs.resolve(input.folder ?? deps.fs.cwd()) } as const;
  if (input.key !== null) {
    const value = await deps.config.get(scope, input.key);
    if (!value.ok) return value;
    return ok({
      key: input.key,
      value: value.value,
      defaultValue: storedDefaults()[input.key],
      description: configDescriptions[input.key],
    });
  }

  const values = await deps.config.getAll(scope);
  if (!values.ok) return values;
  const config = emptyStoredConfig();
  for (const key of configKeys()) {
    config[key] = values.value[key] ?? null;
  }
  return ok({ config, defaults: storedDefaults() });
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

  const scope = { kind: 'folder', folder: deps.fs.resolve(input.folder ?? deps.fs.cwd()) } as const;
  const stored = await deps.config.set(scope, input.key, normalized);
  if (!stored.ok) return stored;
  return ok({ key: input.key, value: normalized, previousValue: stored.value.previousValue });
};
