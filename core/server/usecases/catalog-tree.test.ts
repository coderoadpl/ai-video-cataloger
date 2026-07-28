import { describe, expect, it } from 'vitest';

import { derivedFolderId, GLOBAL_CATALOG_SCHEMA_VERSION, ok, type AppError, type Result } from '@core/domain/index.js';

import type { MediaProbe } from '../ports.js';
import { catalogTreeAbsentFiles, scanTree, scanTreeFolderDetails } from './catalog-tree.js';
import {
  InMemoryCatalogs,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
} from '../../../test/server/usecases/test-fakes.js';

const makeDeps = (fs = new InMemoryFileSystem('/drive')) => ({
  catalogs: new InMemoryCatalogs(),
  fs,
  media: new InMemoryMedia(),
});

const addVideo = (fs: InMemoryFileSystem, videoPath: string, hash: string): void => {
  fs.addFile(videoPath, { size: 1024, mtimeMs: new Date('2026-01-01T00:00:00.000Z').getTime(), hash });
};

class CountingFileSystem extends InMemoryFileSystem {
  readonly hashInputs: string[] = [];

  override async partialContentHash(videoPath: string): Promise<Result<string | null, AppError>> {
    this.hashInputs.push(videoPath);
    return super.partialContentHash(videoPath);
  }
}

class CountingMedia extends InMemoryMedia {
  readonly probeInputs: string[] = [];

  override probe(input: { videoPath: string }): Promise<Result<MediaProbe, AppError>> {
    this.probeInputs.push(input.videoPath);
    return Promise.resolve(ok({
      duration: 60,
      width: 1920,
      height: 1080,
      rotation: 0,
      gpsLat: null,
      gpsLon: null,
    }));
  }
}

const markerJson = (folderId: string): string =>
  JSON.stringify({
    folderId,
    schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

describe('scanTree', () => {
  it('returns only video-bearing folders with relative paths and unknown pending counts when unmarked', async () => {
    const fs = new InMemoryFileSystem('/drive');
    addVideo(fs, '/drive/root.mp4', 'hash-root');
    addVideo(fs, '/drive/a/clip.mp4', 'hash-a');
    addVideo(fs, '/drive/b/nested/deep.webm', 'hash-deep');
    const deps = makeDeps(fs);

    const result = await scanTree(deps, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBe('/drive');
    expect(
      result.value.folders.map((folder) => ({
        path: folder.path,
        relativePath: folder.relativePath,
        depth: folder.depth,
        pending: folder.pendingCount,
      })),
    ).toEqual([
      { path: '/drive', relativePath: '', depth: 0, pending: null },
      { path: '/drive/a', relativePath: 'a', depth: 1, pending: null },
      { path: '/drive/b/nested', relativePath: 'b/nested', depth: 2, pending: null },
    ]);
    expect(result.value.pendingTotal).toBe(0);
    expect(result.value.processedTotal).toBe(0);
    expect(result.value.hasUnknownPending).toBe(true);
  });

  it('returns a fast tree shape without hashing or probing files', async () => {
    const fs = new CountingFileSystem('/drive');
    const media = new CountingMedia();
    addVideo(fs, '/drive/root.mp4', 'hash-root');
    addVideo(fs, '/drive/sub/clip.mp4', 'hash-sub');
    fs.addFile('/drive/sub/readme.txt', { content: 'ignore' });
    const deps = { fs, media };

    const result = await scanTree(deps, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.videoTotal).toBe(2);
    expect(result.value.folders.map((folder) => folder.relativePath)).toEqual(['', 'sub']);
    expect(fs.hashInputs).toEqual([]);
    expect(media.probeInputs).toEqual([]);
  });

  it('derives exact processed counts from folder markers and catalog names', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const store = new InMemoryGlobalCatalogStore();
    const folderId = '11111111-1111-4111-8111-111111111111';
    addVideo(fs, '/drive/a/raw.mp4', 'hash-a');
    addVideo(fs, '/drive/a/final.mp4', 'hash-b');
    await fs.writeTextFile('/drive/a/.ai-video-cataloger/folder-id', markerJson(folderId));
    await store.upsertFolder({
      folderId,
      currentPath: '/drive/a',
      displayName: 'a',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await store.upsertFile({
      fingerprint: 'fp-1',
      folderId,
      fileName: 'raw.mp4',
      size: 1024,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
    });
    await store.upsertFile({
      fingerprint: 'fp-2',
      folderId,
      fileName: 'renamed-before.mp4',
      size: 1024,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
    });
    await store.upsertAnalysis({
      fingerprint: 'fp-1',
      finalName: null,
      description: 'done',
      transcript: null,
      language: null,
      tags: [],
    });
    await store.upsertAnalysis({
      fingerprint: 'fp-2',
      finalName: 'final.mp4',
      description: 'done',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await scanTree({ fs, globalCatalog: store }, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const folder = result.value.folders.find((entry) => entry.relativePath === 'a');
    expect(folder).toMatchObject({
      videoCount: 2,
      pendingCount: 0,
      processedCount: 2,
    });
    expect(result.value.pendingTotal).toBe(0);
    expect(result.value.processedTotal).toBe(2);
    expect(result.value.hasUnknownPending).toBe(false);
  });

  it('counts a read-only folder through its path-derived id instead of reporting unknown', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const store = new InMemoryGlobalCatalogStore();
    const folderId = derivedFolderId('/drive/ro');
    addVideo(fs, '/drive/ro/done.mp4', 'hash-done');
    addVideo(fs, '/drive/ro/todo.mp4', 'hash-todo');
    await store.upsertFolder({
      folderId,
      currentPath: '/drive/ro',
      displayName: 'ro',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await store.upsertFile({
      fingerprint: 'hash-done',
      folderId,
      fileName: 'done.mp4',
      size: 1024,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'gemini',
      model: 'gemini-2.5-flash',
      missingAt: null,
    });
    await store.upsertAnalysis({
      fingerprint: 'hash-done',
      finalName: null,
      description: 'done',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await scanTree({ fs, globalCatalog: store }, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.folders.find((entry) => entry.relativePath === 'ro')).toMatchObject({
      videoCount: 2,
      pendingCount: 1,
      processedCount: 1,
    });
    expect(result.value.hasUnknownPending).toBe(false);
  });

  it('keeps counts unknown for an unmarked folder the global index never saw', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const store = new InMemoryGlobalCatalogStore();
    addVideo(fs, '/drive/fresh/clip.mp4', 'hash-fresh');

    const result = await scanTree({ fs, globalCatalog: store }, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.folders.find((entry) => entry.relativePath === 'fresh')).toMatchObject({
      pendingCount: null,
      processedCount: null,
    });
    expect(result.value.hasUnknownPending).toBe(true);
  });

  it('loads expanded folder details through the detail scanner', async () => {
    const fs = new CountingFileSystem('/drive');
    const media = new CountingMedia();
    const deps = makeDeps(fs);
    addVideo(fs, '/drive/root.mp4', 'hash-root');
    addVideo(fs, '/drive/sub/clip.mp4', 'hash-sub');

    const result = await scanTreeFolderDetails({ ...deps, media }, { folder: '/drive/sub' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.videos.map((video) => video.path)).toEqual(['/drive/sub/clip.mp4']);
    expect(fs.hashInputs).toEqual(['/drive/sub/clip.mp4']);
    expect(media.probeInputs).toEqual(['/drive/sub/clip.mp4']);
    expect(deps.catalogs.openInputs).toEqual(['/drive/sub']);
  });

  it('marks a folder video as a duplicate of a global analysis recorded under another folder', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const media = new InMemoryMedia();
    const store = new InMemoryGlobalCatalogStore();
    const dupesFolderId = '22222222-2222-4222-8222-222222222222';
    const canonicalFolderId = '33333333-3333-4333-8333-333333333333';
    addVideo(fs, '/drive/dupes/clone.mp4', 'shared-fp');
    addVideo(fs, '/drive/originals/2026_holiday.mp4', 'shared-fp');
    await fs.writeTextFile('/drive/dupes/.ai-video-cataloger/folder-id', markerJson(dupesFolderId));
    await store.upsertFolder({
      folderId: canonicalFolderId,
      currentPath: '/drive/originals',
      displayName: 'originals',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await store.upsertFile({
      fingerprint: 'shared-fp',
      folderId: canonicalFolderId,
      fileName: 'source.mp4',
      size: 1024,
      durationS: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
    });
    await store.upsertAnalysis({
      fingerprint: 'shared-fp',
      finalName: '2026_holiday.mp4',
      description: 'done',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await scanTreeFolderDetails(
      { catalogs: new InMemoryCatalogs(), fs, media, globalCatalog: store },
      { folder: '/drive/dupes' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.videos[0]?.duplicate).toEqual({ canonicalPath: '/drive/originals/2026_holiday.mp4' });
  });
});

describe('catalogTreeAbsentFiles', () => {
  const upsertFolderWithMissing = async (
    store: InMemoryGlobalCatalogStore,
    folderId: string,
    currentPath: string,
    files: readonly { fingerprint: string; fileName: string; finalName: string | null; missingAt: number | null }[],
  ): Promise<void> => {
    await store.upsertFolder({
      folderId,
      currentPath,
      displayName: currentPath,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    for (const file of files) {
      await store.upsertFile({
        fingerprint: file.fingerprint,
        folderId,
        fileName: file.fileName,
        size: 1024,
        durationS: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: '2026-01-01T00:00:00.000Z',
        analyzer: 'openai',
        model: 'gpt-4.1-mini',
        missingAt: file.missingAt,
      });
      await store.upsertAnalysis({
        fingerprint: file.fingerprint,
        finalName: file.finalName,
        description: 'done',
        transcript: null,
        language: null,
        tags: [],
      });
    }
  };

  it('groups missing files by folder under the root and skips folders outside it', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const store = new InMemoryGlobalCatalogStore();
    await upsertFolderWithMissing(store, '22222222-2222-4222-8222-222222222222', '/drive/b', [
      { fingerprint: 'fp-b1', fileName: 'b1.mp4', finalName: 'kept-b1.mp4', missingAt: 1738368000000 },
      { fingerprint: 'fp-b2', fileName: 'b2.mp4', finalName: null, missingAt: null },
    ]);
    await upsertFolderWithMissing(store, '11111111-1111-4111-8111-111111111111', '/drive/a', [
      { fingerprint: 'fp-a1', fileName: 'a1.mp4', finalName: null, missingAt: 1738368000000 },
    ]);
    await upsertFolderWithMissing(store, '33333333-3333-4333-8333-333333333333', '/other/c', [
      { fingerprint: 'fp-c1', fileName: 'c1.mp4', finalName: null, missingAt: 1738368000000 },
    ]);

    const result = await catalogTreeAbsentFiles({ fs, globalCatalog: store }, { folder: '/drive' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.map((group) => group.folderPath)).toEqual(['/drive/a', '/drive/b']);
    expect(result.value.groups[1]?.entries).toEqual([
      { fingerprint: 'fp-b1', fileName: 'b1.mp4', finalName: 'kept-b1.mp4', missing: true, missingAt: 1738368000000 },
    ]);
  });

  it('returns no groups when the store is absent', async () => {
    const fs = new InMemoryFileSystem('/drive');
    const result = await catalogTreeAbsentFiles({ fs }, { folder: '/drive' });
    expect(result.ok && result.value.groups).toEqual([]);
  });
});
