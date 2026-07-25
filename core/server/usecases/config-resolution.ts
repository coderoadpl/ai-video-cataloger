import {
  CONFIG_KEYS,
  analyzerBackendSchema,
  analyzerProviderConfigSchema,
  isAppGlobalConfigKey,
  legacyAnalyzerProvider,
  type AppError,
  type ConfigKey,
  type Result,
  ok,
} from '@core/domain/index.js';

import type { ConfigStore } from '../ports.js';
import { storedDefaults } from './shared.js';

export type ConfigValueSource = 'folder' | 'home' | 'default';

export interface ResolvedConfigValues {
  folder: Partial<Record<ConfigKey, string>>;
  home: Partial<Record<ConfigKey, string>>;
  effective: Record<ConfigKey, string>;
  sources: Record<ConfigKey, ConfigValueSource>;
}

export const resolveConfigValues = async (
  config: ConfigStore,
  folder?: string | undefined,
): Promise<Result<ResolvedConfigValues, AppError>> => {
  const home = await config.getAll({ kind: 'home' });
  if (!home.ok) return home;
  const folderValues = folder === undefined
    ? ok<Partial<Record<ConfigKey, string>>>({})
    : await config.getAll({ kind: 'folder', folder });
  if (!folderValues.ok) return folderValues;
  const defaults = storedDefaults();
  const effective = { ...defaults };
  const sources = defaultSources();
  for (const key of CONFIG_KEYS) {
    const folderValue = isAppGlobalConfigKey(key) ? undefined : folderValues.value[key];
    const homeValue = home.value[key];
    if (folderValue !== undefined) {
      effective[key] = folderValue;
      sources[key] = 'folder';
    } else if (homeValue !== undefined) {
      effective[key] = homeValue;
      sources[key] = 'home';
    }
  }
  const analyzerScope = folderValues.value.analyzer_provider !== undefined
    || folderValues.value.analyzer_backend !== undefined
    ? { values: folderValues.value, source: 'folder' } as const
    : home.value.analyzer_provider !== undefined || home.value.analyzer_backend !== undefined
      ? { values: home.value, source: 'home' } as const
      : null;
  if (analyzerScope !== null) {
    const provider = analyzerScope.values.analyzer_provider;
    if (provider !== undefined) {
      effective.analyzer_provider = provider;
      sources.analyzer_provider = analyzerScope.source;
    } else {
      const backend = analyzerBackendSchema.safeParse(analyzerScope.values.analyzer_backend);
      if (backend.success) {
        effective.analyzer_provider = JSON.stringify(legacyAnalyzerProvider(backend.data, effective.local_model));
        sources.analyzer_provider = analyzerScope.source;
      }
    }
  }
  const provider = parseAnalyzerProvider(effective.analyzer_provider);
  if (
    // equal rank favors local_model: the legacy key stays canonical over a same-scope analyzer_provider modelTag
    provider?.family === 'local'
    && sourceRank(sources.local_model) >= sourceRank(sources.analyzer_provider)
  ) {
    effective.analyzer_provider = JSON.stringify({ ...provider, modelTag: effective.local_model });
  }
  return ok({ folder: folderValues.value, home: home.value, effective, sources });
};

const parseAnalyzerProvider = (value: string) => {
  try {
    const parsed = analyzerProviderConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const sourceRank = (source: ConfigValueSource): number => {
  if (source === 'folder') return 2;
  if (source === 'home') return 1;
  return 0;
};

const defaultSources = (): Record<ConfigKey, ConfigValueSource> => ({
  whisper_binary_path: 'default',
  whisper_model: 'default',
  whisper_mode: 'default',
  whisper_api_base_url: 'default',
  whisper_api_model: 'default',
  frames: 'default',
  timeout: 'default',
  skip_rename: 'default',
  analyzer_backend: 'default',
  local_model: 'default',
  analyzer_provider: 'default',
  faces_enabled: 'default',
  output_language: 'default',
  ui_language: 'default',
});
