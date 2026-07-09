/**
 * Resolution of the analyzer backend/model/timeout: CLI flag > per-folder
 * config.json > defaults. Pure function so precedence is unit-testable.
 */

import type { AnalyzerBackend } from './analyzer-providers/types.js';

export const DEFAULT_LOCAL_MODEL = 'gemma3:12b';
export const DEFAULT_ANALYZER: AnalyzerBackend = 'claude';
/** Local inference is slower than the API - bump the default timeout. */
export const DEFAULT_LOCAL_TIMEOUT_SECONDS = 300;

export interface AnalyzerFlagInputs {
  /** --analyzer value, if the user passed one. */
  flagBackend?: string;
  /** --local-model value, if the user passed one. */
  flagModel?: string;
  /** -t/--timeout value as parsed by commander (default or explicit). */
  flagTimeout: number;
  /** True only when the user explicitly passed -t/--timeout. */
  timeoutExplicit: boolean;
}

export interface ResolvedAnalyzerSettings {
  backend: AnalyzerBackend;
  localModel: string;
  timeoutSeconds: number;
}

function asBackend(value: string | null | undefined): AnalyzerBackend | null {
  return value === 'claude' || value === 'local' ? value : null;
}

/**
 * @param lookup reads a per-folder config value (null when unset) - pass a
 *               getConfig-backed function AFTER initDatabase for the folder.
 */
export function resolveAnalyzerSettings(
  flags: AnalyzerFlagInputs,
  lookup: (key: 'analyzer_backend' | 'local_model') => string | null
): ResolvedAnalyzerSettings {
  const backend =
    asBackend(flags.flagBackend) ??
    asBackend(lookup('analyzer_backend')) ??
    DEFAULT_ANALYZER;

  const configModel = lookup('local_model');
  const localModel =
    (flags.flagModel && flags.flagModel.trim()) ||
    (configModel && configModel.trim()) ||
    DEFAULT_LOCAL_MODEL;

  const timeoutSeconds =
    !flags.timeoutExplicit && backend === 'local'
      ? DEFAULT_LOCAL_TIMEOUT_SECONDS
      : flags.flagTimeout;

  return { backend, localModel, timeoutSeconds };
}
