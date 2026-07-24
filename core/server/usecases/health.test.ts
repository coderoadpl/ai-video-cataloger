import { describe, expect, it } from 'vitest';

import { ok, type AppError, type ConfigKey, type Result } from '@core/domain/index.js';

import type { CatalogLockSnapshot, ConfigScope, ConfigStore, GlobalCatalogCounts } from '../ports.js';
import { checkHealth, checkReady, type ReadyDeps } from './health.js';

class FakeConfigStore implements ConfigStore {
  constructor(private readonly home: Partial<Record<ConfigKey, string>> = {}) {}

  get(_scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.home[key] ?? null));
  }

  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    return Promise.resolve(ok(scope.kind === 'home' ? this.home : {}));
  }

  set(): Promise<Result<{ previousValue: string | null }, AppError>> {
    return Promise.resolve(ok({ previousValue: null }));
  }
}

const readyDeps = (overrides: {
  counts?: Result<GlobalCatalogCounts, AppError>;
  lock?: Result<CatalogLockSnapshot, AppError>;
  config?: ConfigStore;
} = {}): ReadyDeps => ({
  version: '1.2.3',
  globalCatalog: {
    counts: () => Promise.resolve(overrides.counts ?? ok({ folders: 0, files: 0, analyses: 0 })),
    lockStatus: () =>
      Promise.resolve(overrides.lock ?? ok({ writable: true, owner: null, blockedBy: null, warnings: [] })),
  },
  config: overrides.config ?? new FakeConfigStore(),
});

describe('checkHealth', () => {
  it('reports ok with the composed version', () => {
    const result = checkHealth({ version: '1.2.3' });
    expect(result).toEqual({ ok: true, value: { status: 'ok', version: '1.2.3' } });
  });
});

describe('checkReady', () => {
  it('reports ready when the catalog opens, the lock is acquirable, and config is valid', async () => {
    const result = await checkReady(readyDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ status: 'ok', version: '1.2.3' });
    expect(result.value.checks.every((check) => check.ok)).toBe(true);
    expect(result.value.checks.map((check) => check.name)).toEqual(['catalog', 'lock', 'provider_config']);
  });

  it('is ready when the write lock is owned by this process', async () => {
    const result = await checkReady(readyDeps({
      lock: ok({
        writable: false,
        owner: { pid: 42, processName: 'cli', startedAt: 'now', hostname: 'host' },
        blockedBy: null,
        warnings: [],
      }),
    }));
    expect(result.ok).toBe(true);
  });

  it('returns unavailable when the catalog cannot open', async () => {
    const result = await checkReady(readyDeps({
      counts: { ok: false, error: { code: 'read_error', message: 'wasm failed to load' } },
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('returns unavailable when another process holds the write lock', async () => {
    const result = await checkReady(readyDeps({
      lock: ok({
        writable: false,
        owner: null,
        blockedBy: { pid: 99, processName: 'gui', startedAt: 'now', hostname: 'host' },
        warnings: [],
      }),
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('returns unavailable when the provider config is invalid', async () => {
    const result = await checkReady(readyDeps({
      config: new FakeConfigStore({ analyzer_provider: '{not valid json' }),
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
