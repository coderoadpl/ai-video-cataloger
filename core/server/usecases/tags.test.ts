import { describe, expect, it } from 'vitest';

import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { CatalogTagAlias, CatalogTagAliasResult } from '../ports.js';
import { InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';
import { suggestTagAliases } from './tags.js';

class RecordingGlobalCatalogStore extends InMemoryGlobalCatalogStore {
  writeCalls: string[] = [];

  override flush(): Promise<Result<void, AppError>> {
    this.writeCalls.push('flush');
    return super.flush();
  }

  override rebuildSearchIndex(): Promise<Result<{ indexed: number }, AppError>> {
    this.writeCalls.push('rebuildSearchIndex');
    return super.rebuildSearchIndex();
  }

  override aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>> {
    this.writeCalls.push('aliasTag');
    return super.aliasTag(input);
  }

  override listTagAliases(): Promise<Result<CatalogTagAlias[], AppError>> {
    return Promise.resolve(ok([{ alias: 'dogs', canonical: 'psy' }]));
  }
}

describe('suggestTagAliases', () => {
  it('never writes to the catalog store', async () => {
    const store = new RecordingGlobalCatalogStore();
    await store.upsertFolder({
      folderId: '11111111-1111-4111-8111-111111111111',
      currentPath: '/media',
      displayName: 'media',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await store.upsertFile({
      fingerprint: 'fp-1',
      folderId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      size: 10,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: null,
      model: null,
      missingAt: null,
    });
    await store.upsertAnalysis({
      fingerprint: 'fp-1',
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['pies'],
    });

    const result = await suggestTagAliases({ globalCatalog: store });

    expect(result.ok).toBe(true);
    expect(store.writeCalls).toEqual([]);
  });

  it('respects an existing alias direction in its proposals', async () => {
    const store = new RecordingGlobalCatalogStore();
    await store.upsertFile({
      fingerprint: 'fp-2',
      folderId: 'unused',
      fileName: 'clip.mp4',
      size: 10,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: null,
      model: null,
      missingAt: null,
    });
    await store.upsertAnalysis({
      fingerprint: 'fp-2',
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['psy'],
    });

    const result = await suggestTagAliases({ globalCatalog: store });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposals.every((proposal) => proposal.from !== 'psy')).toBe(true);
  });
});
