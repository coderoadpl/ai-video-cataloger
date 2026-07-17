import {
  appError,
  configSchema,
  ok,
  type AnalyzerProviderConfig,
  type AppError,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';

import type { AnalyzerPort, ConfigStore, DependencyStatus, FileSystemPort, TranscriberPort } from '../ports.js';
import { resolveConfigValues } from './config-resolution.js';

export type ReadinessComponent = {
  kind: 'analyzer' | 'transcriber';
  name: string;
  available: boolean;
  message: string;
  suggestedAction: string | null;
};

export interface ReadinessOutput {
  ready: boolean;
  analyzer: ReadinessComponent & { family: AnalyzerProviderConfig['family']; providerId: string };
  transcriber: ReadinessComponent & { mode: 'local' | 'api' | 'skip'; model: WhisperModelName | null };
  missingPieces: ReadinessComponent[];
  suggestedAction: string | null;
}

export interface ReadinessDeps {
  config: ConfigStore;
  fs: FileSystemPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
  readiness: ReadinessCache;
}

export class ReadinessCache {
  private readonly entries = new Map<string, Promise<Result<ReadinessOutput, AppError>>>();

  read(
    key: string,
    refresh: boolean,
    load: () => Promise<Result<ReadinessOutput, AppError>>,
  ): Promise<Result<ReadinessOutput, AppError>> {
    if (!refresh) {
      const existing = this.entries.get(key);
      if (existing !== undefined) return existing;
    }
    const pending = load();
    this.entries.set(key, pending);
    void pending.then((result) => {
      if (!result.ok && this.entries.get(key) === pending) this.entries.delete(key);
    }, () => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
    return pending;
  }

  invalidate(): void {
    this.entries.clear();
  }
}

export const getReadiness = (
  deps: ReadinessDeps,
  input: { folder?: string | undefined; refresh?: boolean | undefined } = {},
): Promise<Result<ReadinessOutput, AppError>> => {
  const folder = deps.fs.resolve(input.folder ?? deps.fs.cwd());
  return deps.readiness.read(folder, input.refresh === true, () => evaluateConfiguredReadiness(deps, folder));
};

const evaluateConfiguredReadiness = async (
  deps: Pick<ReadinessDeps, 'config' | 'transcriber' | 'analyzer'>,
  folder: string,
): Promise<Result<ReadinessOutput, AppError>> => {
  const stored = await resolveConfigValues(deps.config, folder);
  if (!stored.ok) return stored;
  const configured = configSchema.safeParse(stored.value.effective);
  if (!configured.success) {
    return {
      ok: false,
      error: appError('invalid_config_value', 'Configured analyzer or transcriber is invalid', configured.error.flatten()),
    };
  }

  const provider = configured.data.analyzer_provider;
  const analyzerDependency = await deps.analyzer.dependency({
    backend: provider.family === 'local' ? 'local' : 'claude',
    provider,
  });
  if (!analyzerDependency.ok) return analyzerDependency;
  const transcriberDependency = await deps.transcriber.dependency({
    mode: configured.data.whisper_mode,
    model: configured.data.whisper_model,
    binaryPath: configured.data.whisper_binary_path,
  });
  if (!transcriberDependency.ok) return transcriberDependency;

  const analyzer = {
    ...component('analyzer', provider.providerId, analyzerDependency.value),
    family: provider.family,
    providerId: provider.providerId,
  };
  const transcriber = {
    ...component('transcriber', transcriberName(configured.data.whisper_mode, configured.data.whisper_model), transcriberDependency.value),
    mode: configured.data.whisper_mode,
    model: configured.data.whisper_mode === 'local' ? configured.data.whisper_model : null,
  };
  const missingPieces = [analyzer, transcriber].filter((entry) => !entry.available);
  return ok({
    ready: missingPieces.length === 0,
    analyzer,
    transcriber,
    missingPieces,
    suggestedAction: missingPieces[0]?.suggestedAction ?? null,
  });
};

const component = (
  kind: ReadinessComponent['kind'],
  name: string,
  dependency: DependencyStatus,
): ReadinessComponent => ({
  kind,
  name,
  available: dependency.available,
  message: dependency.available ? `${name} is available` : `${name} is unavailable`,
  suggestedAction: dependency.available ? null : setupGuidance(dependency.installHint),
});

const setupGuidance = (hint: string): string => {
  const setup = 'Run: ai-video-cataloger setup';
  if (hint.trim().length === 0) return setup;
  return `${hint.replace(/[.\s]+$/, '')}. ${setup}`;
};

const transcriberName = (mode: 'local' | 'api' | 'skip', model: WhisperModelName): string => {
  if (mode === 'local') return `whisper-${model}`;
  if (mode === 'api') return 'openai-whisper-api';
  return 'transcription-skip';
};
