/**
 * Precedence tests for analyzer settings: CLI flag > per-folder config > defaults,
 * plus the local-backend default-timeout bump.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCAL_MODEL, DEFAULT_LOCAL_TIMEOUT_SECONDS, resolveAnalyzerSettings,
} from '../src/services/analyzer-config.js';

const noConfig = (): string | null => null;
const configOf = (values: Record<string, string>) =>
  (key: string): string | null => values[key] ?? null;

describe('resolveAnalyzerSettings', () => {
  it('defaults to claude with the default local model and untouched timeout', () => {
    const resolved = resolveAnalyzerSettings(
      { flagTimeout: 120, timeoutExplicit: false },
      noConfig
    );
    expect(resolved).toEqual({
      backend: 'claude',
      localModel: DEFAULT_LOCAL_MODEL,
      timeoutSeconds: 120,
    });
  });

  it('reads backend and model from per-folder config', () => {
    const resolved = resolveAnalyzerSettings(
      { flagTimeout: 120, timeoutExplicit: false },
      configOf({ analyzer_backend: 'local', local_model: 'qwen2.5vl:7b' })
    );
    expect(resolved.backend).toBe('local');
    expect(resolved.localModel).toBe('qwen2.5vl:7b');
  });

  it('CLI flags override config', () => {
    const resolved = resolveAnalyzerSettings(
      { flagBackend: 'claude', flagModel: 'gemma3:4b', flagTimeout: 120, timeoutExplicit: false },
      configOf({ analyzer_backend: 'local', local_model: 'qwen2.5vl:7b' })
    );
    expect(resolved.backend).toBe('claude');
    expect(resolved.localModel).toBe('gemma3:4b');
  });

  it('bumps the default timeout for the local backend', () => {
    const resolved = resolveAnalyzerSettings(
      { flagBackend: 'local', flagTimeout: 120, timeoutExplicit: false },
      noConfig
    );
    expect(resolved.timeoutSeconds).toBe(DEFAULT_LOCAL_TIMEOUT_SECONDS);
  });

  it('respects an explicit timeout even for the local backend', () => {
    const resolved = resolveAnalyzerSettings(
      { flagBackend: 'local', flagTimeout: 90, timeoutExplicit: true },
      noConfig
    );
    expect(resolved.timeoutSeconds).toBe(90);
  });

  it('ignores invalid config values and falls back to defaults', () => {
    const resolved = resolveAnalyzerSettings(
      { flagTimeout: 120, timeoutExplicit: false },
      configOf({ analyzer_backend: 'banana', local_model: '   ' })
    );
    expect(resolved.backend).toBe('claude');
    expect(resolved.localModel).toBe(DEFAULT_LOCAL_MODEL);
  });
});
