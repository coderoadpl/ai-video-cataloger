import { describe, expect, it } from 'vitest';

import { folderMarkerPath, readFolderMarker, resolveFolderIdentity } from './folder-identity.js';
import {
  folderCatalogRecords,
  forgetCatalogEntry,
  hasProcessedAnalysis,
  indexRebuild,
  indexStatus,
  reconcileFolderPresence,
  resolveFolderIntoIndex,
  upsertProcessedVideo,
} from './catalog-index.js';
import { folderSnapshotPath } from './catalog-snapshot.js';
import { aliasTag, listTags } from './tags.js';
import type { CatalogSearchFilters } from '../ports.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';

const EMPTY_SEARCH_FILTERS: CatalogSearchFilters = {
  tagTermSets: [],
  personIds: [],
  place: null,
  capturedFrom: null,
  capturedTo: null,
  hasGps: null,
  folderId: null,
};

const processedInput = (folderPath: string) => ({
  folderPath,
  fingerprint: 'fp-1',
  fileName: 'clip.mp4',
  size: 4096,
  durationS: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-02-01T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
  finalName: '2026-02-01_a-clip.mp4',
  description: 'A clip',
  transcript: 'spoken words',
  language: null,
  tags: ['useful-clip'],
});

describe('folder identity marker', () => {
  it('creates a persistent marker and returns the same id on re-read', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const created = await resolveFolderIdentity(fs, '/work');
    expect(created.ok && created.value.persistent).toBe(true);
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
    const importedSearch = await recoveredStore.search({
      match: 'clip*',
      rankingTerms: ['clip'],
      filters: EMPTY_SEARCH_FILTERS,
      sort: 'relevance',
      limit: 10,
      offset: 0,
    });
    expect(importedSearch.ok && importedSearch.value.rows[0]?.fingerprint).toBe('fp-1');
  });
});

describe('missing-file reconciliation', () => {
  it('marks catalog files missing when absent from the disk listing and clears them on return', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));

    const marked = await reconcileFolderPresence({ globalCatalog: store, fs }, {
      folderPath: '/work',
      presentFingerprints: [],
      now: 111,
    });
    expect(marked.ok && marked.value.marked).toBe(1);
    const missing = await store.getFile('fp-1');
    expect(missing.ok && missing.value?.missingAt).toBe(111);

    const cleared = await reconcileFolderPresence({ globalCatalog: store, fs }, {
      folderPath: '/work',
      presentFingerprints: ['fp-1'],
      now: 222,
    });
    expect(cleared.ok && cleared.value.cleared).toBe(1);
    const healed = await store.getFile('fp-1');
    expect(healed.ok && healed.value?.missingAt).toBe(null);
  });

  it('forgets a catalog entry everywhere and refreshes the folder snapshot', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));

    const seededSnapshot = await fs.readTextFile(folderSnapshotPath(fs, '/work'));
    expect(seededSnapshot.ok && seededSnapshot.value).toContain('fp-1');

    const forgotten = await forgetCatalogEntry({ globalCatalog: store, fs }, { fingerprint: 'fp-1' });
    expect(forgotten.ok && forgotten.value.deleted).toBe(true);

    const gone = await store.getFile('fp-1');
    expect(gone.ok && gone.value).toBe(null);
    const analysisGone = await store.getAnalysis('fp-1');
    expect(analysisGone.ok && analysisGone.value).toBe(null);
    const refreshedSnapshot = await fs.readTextFile(folderSnapshotPath(fs, '/work'));
    expect(refreshedSnapshot.ok && refreshedSnapshot.value?.includes('fp-1')).toBe(false);
  });

  it('deletes orphaned face crop files when forgetting a catalog entry', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const cropPath = '/home/faces/person-1/exemplar-001.jpg';
    fs.addFile(cropPath, { content: 'jpeg' });
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));
    await store.upsertFaceObservation({
      obsId: 'obs-1',
      fingerprint: 'fp-1',
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.2),
      quality: 0.9,
      personId: 'person-1',
      cropPath,
    });

    const forgotten = await forgetCatalogEntry({ globalCatalog: store, fs }, { fingerprint: 'fp-1' });
    expect(forgotten.ok && forgotten.value.deleted).toBe(true);
    const cropExists = await fs.exists(cropPath);
    expect(cropExists.ok && cropExists.value).toBe(false);
  });

  it('lists a folder catalog records with the missing flag and last-seen timestamp', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, processedInput('/work'));
    await reconcileFolderPresence({ globalCatalog: store, fs }, {
      folderPath: '/work',
      presentFingerprints: [],
      now: 333,
    });

    const listed = await folderCatalogRecords({ globalCatalog: store, fs }, { folder: '/work' });
    expect(listed.ok && listed.value.records).toEqual([
      {
        fingerprint: 'fp-1',
        fileName: 'clip.mp4',
        finalName: '2026-02-01_a-clip.mp4',
        missing: true,
        missingAt: 333,
      },
    ]);
  });

  it('returns no records for a folder that was never cataloged', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();

    const listed = await folderCatalogRecords({ globalCatalog: store, fs }, { folder: '/work' });
    expect(listed.ok && listed.value.records).toEqual([]);
  });
});

describe('tag aliases', () => {
  it('remaps existing file tags and applies the alias on later ingest', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const store = new InMemoryGlobalCatalogStore();
    await upsertProcessedVideo({ globalCatalog: store, fs }, {
      ...processedInput('/work'),
      tags: ['automobile', 'wide-shot'],
    });

    const aliased = await aliasTag({ globalCatalog: store }, { from: 'automobile', to: 'car' });
    const tagsAfterAlias = await listTags({ globalCatalog: store });
    await upsertProcessedVideo({ globalCatalog: store, fs }, {
      ...processedInput('/work'),
      fingerprint: 'fp-2',
      tags: ['automobile'],
    });
    const ingested = await store.getAnalysis('fp-2');

    expect(aliased).toEqual({ ok: true, value: { alias: 'automobile', canonical: 'car', remappedFiles: 1 } });
    expect(tagsAfterAlias.ok && tagsAfterAlias.value.tags).toEqual([
      { name: 'car', count: 1 },
      { name: 'wide-shot', count: 1 },
    ]);
    expect(ingested.ok && ingested.value?.tags).toEqual(['car']);
  });
});
