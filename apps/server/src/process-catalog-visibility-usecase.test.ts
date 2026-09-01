import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import {
  libraryCollection,
  processVideoPipeline,
  search,
  type ProcessDeps,
  type SearchFiltersInput,
} from '@core/server/index.js';

import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryMedia,
  InMemoryPhotosStore,
  InMemorySpendLedger,
  InMemoryTranscriber,
  videoFixture,
} from '../../../test/server/usecases/test-fakes.js';

const videoPath = '/work/Clip One.mp4';
const baseInput = {
  videoPath,
  frames: 3,
  skipRename: false,
  verbose: false,
  timeout: 120,
  whisper: 'local',
  whisperModel: 'base',
} as const;

const EMPTY_FILTERS: SearchFiltersInput = {
  tags: [],
  people: [],
  place: null,
  from: null,
  to: null,
  hasGps: null,
  folderId: null,
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-process-catalog-visibility-'));
  tempRoots.push(root);
  return root;
};

const makeDeps = async (): Promise<ProcessDeps & { fs: InMemoryFileSystem; globalCatalog: SqlJsGlobalCatalogStore }> => {
  const fs = new InMemoryFileSystem('/work');
  fs.addFile(videoPath, {
    size: 1000,
    mtimeMs: new Date('2024-05-06T12:00:00.000Z').getTime(),
    hash: 'hash-clip',
  });
  const catalogs = new InMemoryCatalogs([
    {
      folder: '/work',
      videos: [videoFixture({ originalPath: videoPath, originalName: 'Clip One.mp4', fileHash: 'hash-clip', status: 'pending' })],
    },
  ]);
  const home = await tempHome();
  return {
    catalogs,
    config: new InMemoryConfig(),
    fs,
    media: new InMemoryMedia(fs),
    transcriber: new InMemoryTranscriber(fs),
    analyzer: new InMemoryAnalyzer(),
    spendLedger: new InMemorySpendLedger(),
    globalCatalog: new SqlJsGlobalCatalogStore({ homeDirectory: home }),
  };
};

describe('a single-file analysis lands in the same-process global catalog', () => {
  it('is findable by a browse-mode library search right after processVideoPipeline resolves, with no restart', async () => {
    const deps = await makeDeps();

    const result = await processVideoPipeline(deps, baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('completed');

    const found = await search(
      { globalCatalog: deps.globalCatalog, fs: deps.fs, media: deps.media },
      { query: null, filters: EMPTY_FILTERS, sort: 'captured_desc', thumbnails: 'existing', limit: 10, offset: 0 },
    );

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.results.map((row) => row.fingerprint)).toContain('hash-clip');
  });

  it('is findable via the library collection feed right after processVideoPipeline resolves, with no restart', async () => {
    const deps = await makeDeps();

    const result = await processVideoPipeline(deps, baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = await libraryCollection(
      { globalCatalog: deps.globalCatalog, photos: new InMemoryPhotosStore(), fs: deps.fs, media: deps.media },
      { query: null, filters: { ...EMPTY_FILTERS, hideUnavailable: false }, sort: undefined, media: 'video', limit: 10, cursor: null },
    );

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.items.map((item) => item.fingerprint)).toContain('hash-clip');
  });

  it('is findable by a text-query search right after processVideoPipeline resolves, with no restart', async () => {
    const deps = await makeDeps();

    const result = await processVideoPipeline(deps, baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = await search(
      { globalCatalog: deps.globalCatalog, fs: deps.fs, media: deps.media },
      { query: 'useful', filters: EMPTY_FILTERS, sort: undefined, thumbnails: 'existing', limit: 10, offset: 0 },
    );

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.results.map((row) => row.fingerprint)).toContain('hash-clip');
  });
});
