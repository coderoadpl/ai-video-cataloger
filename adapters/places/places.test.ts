import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import { GeoNamesPlacesAdapter } from './index.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'places-fixture.tsv');

const fsStub = (content: string | null) => ({
  readTextFile: async (): Promise<Result<string | null, AppError>> => ok(content),
  exists: async (): Promise<Result<boolean, AppError>> => ok(content !== null),
});

describe('GeoNamesPlacesAdapter', () => {
  it('P8: resolves the nearer of two synthetic towns with the right distance', async () => {
    const content = await readFile(fixturePath, 'utf8');
    const adapter = new GeoNamesPlacesAdapter({ fs: fsStub(content), datasetPath: fixturePath });
    const result = await adapter.resolve({ lat: 60.101, lon: 24.902 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.name).toBe('Nearville');
    expect(result.value?.dataset).toBe('places-fixture-2026');
    expect(result.value?.distanceM).toBeGreaterThan(0);
    expect(result.value?.distanceM).toBeLessThan(500);
  });

  it('widens the search ring to find a town 3 degrees away', async () => {
    const content = await readFile(fixturePath, 'utf8');
    const adapter = new GeoNamesPlacesAdapter({ fs: fsStub(content), datasetPath: fixturePath });
    const result = await adapter.resolve({ lat: 63.1, lon: 24.9 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.name).toBe('Farville');
  });

  it('returns null when nothing lies within 5 degrees', async () => {
    const content = await readFile(fixturePath, 'utf8');
    const adapter = new GeoNamesPlacesAdapter({ fs: fsStub(content), datasetPath: fixturePath });
    const result = await adapter.resolve({ lat: -10, lon: -10 });
    expect(result).toEqual(ok(null));
  });

  it('reports the dependency unavailable and resolve as model_not_installed when the artifact is missing', async () => {
    const adapter = new GeoNamesPlacesAdapter({ fs: fsStub(null), datasetPath: null });
    const dependency = await adapter.dependency();
    expect(dependency.ok && dependency.value.available).toBe(false);
    const ready = await adapter.isReady();
    expect(ready).toEqual(ok(false));
    const resolved = await adapter.resolve({ lat: 60.1, lon: 24.9 });
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.error.code).toBe('model_not_installed');
  });

  it('rejects a dataset whose header does not match the expected format', async () => {
    const adapter = new GeoNamesPlacesAdapter({ fs: fsStub('not-a-header\n'), datasetPath: '/fake/path.tsv' });
    const resolved = await adapter.resolve({ lat: 60.1, lon: 24.9 });
    expect(resolved).toEqual({ ok: false, error: appError('validation', 'Places dataset header is malformed') });
  });
});
