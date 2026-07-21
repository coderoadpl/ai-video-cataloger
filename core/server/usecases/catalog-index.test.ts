import { describe, expect, it } from 'vitest';

import { ensureFolderMarker, folderMarkerPath, readFolderMarker } from './folder-identity.js';
import {
  hasProcessedAnalysis,
  indexRebuild,
  indexStatus,
  resolveFolderIntoIndex,
  upsertProcessedVideo,
} from './catalog-index.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';

const processedInput = (folderPath: string) => ({
  folderPath,
  fingerprint: 'fp-1',
  fileName: 'clip.mp4',
  size: 4096,
  durationS: null,
  processedAt: '2026-02-01T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
  finalName: '2026-02-01_a-clip.mp4',
  description: 'A clip',
  transcript: 'spoken words',
  language: null,
});

describe('folder identity marker', () => {
  it('creates a persistent marker and returns the same id on re-read', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const created = await ensureFolderMarker(fs, '/work');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const reread = await readFolderMarker(fs, '/work');
    expect(reread.ok && reread.value?.folderId).toBe(created.value.folderId);
    expect(folderMarkerPath(fs, '/work')).toBe('/work/.ai-video-cataloger/folder-id');
  });
});

describe('folder rediscovery by marker after a rename', () => {
  it('resolves a moved folder to the same folderId and updates current_path', async () => {
    const fs = new InMemoryFileSystem('/media');
    fs.addDirectory('/media/original');
    const store = new InMemoryGlobalCatalogStore();

    const first = await resolveFolderIntoIndex({ globalCatalog: store, fs }, '/media/original');
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const marker = await fs.readTextFile(folderMarkerPath(fs, '/media/original'));
    expect(marker.ok && marker.value !== null).toBe(true);
    if (!marker.ok || marker.value === null) return;
    fs.addDirectory('/media/renamed');
    await fs.writeTextFile(folderMarkerPath(fs, '/media/renamed'), marker.value);

    const second = await resolveFolderIntoIndex({ globalCatalog: store, fs }, '/media/renamed');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.folderId).toBe(first.value.folderId);

    const folder = await store.getFolder(first.value.folderId);
    expect(folder.ok && folder.value?.currentPath).toBe('/media/renamed');
    const folders = await store.listFolders();
    expect(folders.ok && folders.value.length).toBe(1);
  });
});

describe('idempotent skip', () => {
  it('reports a fingerprint as already indexed after it is recorded', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    const before = await hasProcessedAnalysis({ globalCatalog: store, fs }, 'fp-1');
    expect(before.ok && before.value).toBe(false);

    const recorded = await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));
    expect(recorded.ok).toBe(true);

    const after = await hasProcessedAnalysis({ globalCatalog: store, fs }, 'fp-1');
    expect(after.ok && after.value).toBe(true);
  });
});

describe('index status and rebuild', () => {
  it('reports counts and rebuilds from folder snapshots', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));

    const status = await indexStatus({ globalCatalog: store, fs });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.counts).toEqual({ folders: 1, files: 1, analyses: 1 });
    expect(status.value.folders[0]?.currentPath).toBe('/work');

    const recoveredStore = new InMemoryGlobalCatalogStore();
    const seed = await resolveFolderIntoIndex({ globalCatalog: recoveredStore, fs }, '/work');
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    expect(seed.value.imported).toBe(1);
    const rebuilt = await indexRebuild({ globalCatalog: recoveredStore, fs });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.value.reconciledFolders).toBe(1);
    const importedFile = await recoveredStore.getFile('fp-1');
    expect(importedFile.ok && importedFile.value?.fileName).toBe('clip.mp4');
  });
});
