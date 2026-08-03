import { describe, expect, it } from 'vitest';

import { cachedScanFolder, scanFolder } from './scan.js';
import {
  InMemoryCatalogs,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryMedia,
  videoFixture,
} from '../../../test/server/usecases/test-fakes.js';

class CountingGlobalCatalogStore extends InMemoryGlobalCatalogStore {
  readonly locationInputs: string[][] = [];

  override listAnalyzedFileLocations(fingerprints: readonly string[]) {
    this.locationInputs.push([...fingerprints]);
    return super.listAnalyzedFileLocations(fingerprints);
  }
}

class CountingDirectoryFileSystem extends InMemoryFileSystem {
  directoryReads = 0;

  override listDirectory(value: string) {
    this.directoryReads += 1;
    return super.listDirectory(value);
  }
}

describe('scanFolder', () => {
  it('returns indexed folder rows without waiting for a filesystem directory scan', async () => {
    const folderId = '11111111-1111-4111-8111-111111111111';
    const fs = new CountingDirectoryFileSystem('/videos');
    fs.addFile('/videos/.ai-video-cataloger/folder-id', {
      content: JSON.stringify({ folderId, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    });
    const globalCatalog = new InMemoryGlobalCatalogStore();
    await globalCatalog.upsertFolder({
      folderId,
      currentPath: '/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await globalCatalog.upsertFile({
      fingerprint: 'cached-hash',
      folderId,
      fileName: 'cached.mp4',
      size: 2048,
      durationS: 65,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'local',
      model: 'gemma3:12b',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await globalCatalog.upsertAnalysis({
      fingerprint: 'cached-hash',
      finalName: 'cached.mp4',
      description: 'Cached description',
      transcript: 'Cached transcript',
      language: 'en',
      tags: ['cached'],
    });

    const result = await cachedScanFolder({
      catalogs: new InMemoryCatalogs(),
      fs,
      media: new InMemoryMedia(),
      globalCatalog,
    }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        databasePath: '/home/.ai-video-cataloger/catalog.db',
        videos: [{
          path: '/videos/cached.mp4',
          filename: 'cached.mp4',
          sizeFormatted: '2.0 KB',
          durationFormatted: '1:05',
          status: 'completed',
          contentHash: 'cached-hash',
          artifacts: {
            transcriptContent: 'Cached transcript',
            summary: { description: 'Cached description', tags: ['cached'] },
          },
        }],
      },
    });
    expect(fs.directoryReads).toBe(0);
  });

  it('scans supported videos, matches catalog rows, and loads completed artifacts', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    fs.addFile('/videos/notes.txt', { size: 10 });
    fs.addDirectory('/videos/frames/renamed');
    fs.addFile('/videos/frames/renamed/frame-001.jpg', { size: 100 });
    fs.addFile('/videos/transcripts/renamed.txt', { content: 'transcript' });
    fs.addFile('/videos/summaries/renamed.txt', { content: 'human summary' });
    fs.addFile('/videos/summaries/renamed.json', {
      content: JSON.stringify({
        schemaVersion: 1,
        description: 'desc',
        suggestedFilename: 'renamed.mp4',
        fullAnalysis: 'full',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    fs.addFile('/videos/.ai-video-cataloger/thumbnails/renamed.jpg', { mtimeMs: 42 });
    const media = new InMemoryMedia();
    media.durations.set('/videos/clip.mp4', 65);
    const catalogs = new InMemoryCatalogs([
      {
        folder: '/videos',
        videos: [
          videoFixture({
            originalPath: '/videos/clip.mp4',
            originalName: 'clip.mp4',
            newName: 'renamed.mp4',
            fileHash: 'hash-1',
            status: 'completed',
          }),
        ],
      },
    ]);

    const result = await scanFolder({ catalogs, fs, media }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        folder: '/videos',
        databasePath: '/videos/.ai-video-cataloger/catalog.db',
        videos: [
          {
            filename: 'clip.mp4',
            sizeFormatted: '2.0 KB',
            durationFormatted: '1:05',
            status: 'completed',
            contentHash: 'hash-1',
            artifacts: {
              framePaths: ['/videos/frames/renamed/frame-001.jpg'],
              transcriptContent: 'transcript',
              transcriptPath: '/videos/transcripts/renamed.txt',
              summary: { suggestedFilename: 'renamed.mp4' },
              summaryPath: '/videos/summaries/renamed.txt',
              thumbnailPath: '/videos/.ai-video-cataloger/thumbnails/renamed.jpg',
              thumbnailMtime: 42,
              newFilename: 'renamed.mp4',
            },
          },
        ],
        summary: { total: 1, tracked: 1, completed: 1, notTracked: 0 },
      },
    });
  });

  it('excludes zero-byte and non-canonical entries from the frames directory listing', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    fs.addDirectory('/videos/frames/clip');
    fs.addFile('/videos/frames/clip/frame-001.jpg', { size: 100 });
    fs.addFile('/videos/frames/clip/frame-002.jpg', { size: 100 });
    fs.addFile('/videos/frames/clip/frame-003.jpg', { size: 100 });
    fs.addFile('/videos/frames/clip/frame-004.jpg', { size: 0 });
    fs.addFile('/videos/frames/clip/leftover.jpg', { size: 100 });
    const media = new InMemoryMedia();
    media.durations.set('/videos/clip.mp4', 65);
    const catalogs = new InMemoryCatalogs([
      {
        folder: '/videos',
        videos: [
          videoFixture({
            originalPath: '/videos/clip.mp4',
            originalName: 'clip.mp4',
            fileHash: 'hash-1',
            status: 'completed',
          }),
        ],
      },
    ]);

    const result = await scanFolder({ catalogs, fs, media }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        videos: [
          {
            artifacts: {
              framePaths: [
                '/videos/frames/clip/frame-001.jpg',
                '/videos/frames/clip/frame-002.jpg',
                '/videos/frames/clip/frame-003.jpg',
              ],
            },
          },
        ],
      },
    });
  });

  it('reports untracked supported videos without artifact reads beyond thumbnails', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/fresh.mov', { size: 512, hash: 'fresh-hash' });

    const result = await scanFolder(
      { catalogs: new InMemoryCatalogs(), fs, media: new InMemoryMedia() },
      { folder: '/videos' },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        videos: [{ filename: 'fresh.mov', status: 'not_tracked', contentHash: 'fresh-hash' }],
        summary: { total: 1, tracked: 0, notTracked: 1 },
      },
    });
  });

  it('never opens a catalog for a folder it merely reads and has no catalog yet', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/fresh.mov', { size: 512, hash: 'fresh-hash' });
    const catalogs = new InMemoryCatalogs([], fs);

    const result = await scanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result).toMatchObject({ ok: true, value: { databasePath: null } });
    expect(catalogs.openInputs).toEqual([]);
  });

  it('never opens a catalog when the cached scan path finds no cache and no prior catalog', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/fresh.mov', { size: 512, hash: 'fresh-hash' });
    const catalogs = new InMemoryCatalogs([], fs);

    const result = await cachedScanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result).toMatchObject({ ok: true, value: { databasePath: null, videos: [] } });
    expect(catalogs.openInputs).toEqual([]);
  });

  it('writes the folder identity marker when scanning a writable folder', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    const catalogs = new InMemoryCatalogs([], fs);

    const result = await scanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result.ok).toBe(true);
    const marker = await fs.readTextFile('/videos/.ai-video-cataloger/folder-id');
    expect(marker).toMatchObject({ ok: true, value: expect.stringContaining('folderId') });
  });

  it('leaves no folder identity marker when scanning a read-only folder', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    fs.markReadOnly('/videos');
    const catalogs = new InMemoryCatalogs([], fs);

    const result = await scanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result.ok).toBe(true);
    const marker = await fs.readTextFile('/videos/.ai-video-cataloger/folder-id');
    expect(marker).toEqual({ ok: true, value: null });
  });

  it('marks same-folder and cross-folder copies through one batched global-index lookup', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/original.mp4', { size: 1024, hash: 'same-folder-hash' });
    fs.addFile('/videos/local-copy.mp4', { size: 1024, hash: 'same-folder-hash' });
    fs.addFile('/videos/remote-copy.mp4', { size: 1024, hash: 'cross-folder-hash' });
    fs.addFile('/archive/named-source.mp4', { size: 1024, hash: 'cross-folder-hash' });
    const catalogs = new InMemoryCatalogs([{
      folder: '/videos',
      videos: [videoFixture({
        originalPath: '/videos/original.mp4',
        originalName: 'original.mp4',
        fileHash: 'same-folder-hash',
        status: 'completed',
      })],
    }]);
    const globalCatalog = new CountingGlobalCatalogStore();
    await globalCatalog.upsertFolder({
      folderId: 'current-folder',
      currentPath: '/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await globalCatalog.upsertFolder({
      folderId: 'canonical-folder',
      currentPath: '/archive',
      displayName: 'archive',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await globalCatalog.upsertFile({
      fingerprint: 'same-folder-hash',
      folderId: 'current-folder',
      fileName: 'original.mp4',
      size: 1024,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await globalCatalog.upsertAnalysis({
      fingerprint: 'same-folder-hash',
      finalName: null,
      description: 'local canonical',
      transcript: null,
      language: null,
      tags: [],
    });
    await globalCatalog.upsertFile({
      fingerprint: 'cross-folder-hash',
      folderId: 'canonical-folder',
      fileName: 'source.mp4',
      size: 1024,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await globalCatalog.upsertAnalysis({
      fingerprint: 'cross-folder-hash',
      finalName: 'named-source.mp4',
      description: 'remote canonical',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await scanFolder({
      catalogs,
      fs,
      media: new InMemoryMedia(),
      globalCatalog,
    }, { folder: '/videos' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byName = new Map(result.value.videos.map((video) => [video.filename, video]));
    expect(globalCatalog.locationInputs).toEqual([['cross-folder-hash', 'same-folder-hash']]);
    expect(byName.get('original.mp4')?.duplicate).toBeUndefined();
    expect(byName.get('local-copy.mp4')).toMatchObject({
      status: 'completed',
      duplicate: { canonicalPath: '/videos/original.mp4' },
    });
    expect(byName.get('remote-copy.mp4')).toMatchObject({
      status: 'not_tracked',
      duplicate: { canonicalPath: '/archive/named-source.mp4' },
    });
  });

  it('keeps a canonical reachable through readable variant artifacts when its source is absent', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/copy.mp4', { size: 1024, hash: 'artifact-hash' });
    fs.addFile('/archive/.ai-video-cataloger/variants/artifact-hash/legacy/summary.json', { content: '{}' });
    const globalCatalog = new InMemoryGlobalCatalogStore();
    await globalCatalog.upsertFolder({
      folderId: 'canonical-folder',
      currentPath: '/archive',
      displayName: 'archive',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await globalCatalog.upsertFile({
      fingerprint: 'artifact-hash',
      folderId: 'canonical-folder',
      fileName: 'missing.mp4',
      size: 1024,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'openai',
      model: 'gpt-4.1-mini',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await globalCatalog.upsertAnalysis({
      fingerprint: 'artifact-hash',
      finalName: null,
      description: 'artifact-backed canonical',
      transcript: null,
      language: null,
      tags: [],
    });

    const result = await scanFolder({
      catalogs: new InMemoryCatalogs(),
      fs,
      media: new InMemoryMedia(),
      globalCatalog,
    }, { folder: '/videos' });
    const variants = await globalCatalog.listVariants('artifact-hash');

    expect(result).toMatchObject({
      ok: true,
      value: { videos: [{ duplicate: { canonicalPath: '/archive/missing.mp4' } }] },
    });
    expect(variants.ok && variants.value).toHaveLength(1);
  });

  it('keeps summary null when only the human txt summary exists', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    fs.addFile('/videos/summaries/clip.txt', { content: 'human summary' });
    const catalogs = new InMemoryCatalogs([
      {
        folder: '/videos',
        videos: [
          videoFixture({
            originalPath: '/videos/clip.mp4',
            originalName: 'clip.mp4',
            fileHash: 'hash-1',
            status: 'analyzed',
          }),
        ],
      },
    ]);

    const result = await scanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        videos: [
          {
            artifacts: {
              summary: null,
              summaryPath: '/videos/summaries/clip.txt',
            },
          },
        ],
      },
    });
  });

  it('loads resumable artifacts from errored legacy rows', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/legacy.mp4', { size: 2048, hash: 'hash-1' });
    fs.addDirectory('/videos/frames/legacy');
    fs.addFile('/videos/frames/legacy/frame-001.jpg', { size: 100 });
    fs.addFile('/videos/transcripts/legacy.txt', { content: 'legacy transcript' });
    const catalogs = new InMemoryCatalogs([
      {
        folder: '/videos',
        videos: [
          videoFixture({
            originalPath: '/videos/legacy.mp4',
            originalName: 'legacy.mp4',
            fileHash: 'hash-1',
            status: 'error',
            errorMessage: 'Legacy interrupted run',
          }),
        ],
      },
    ]);

    const result = await scanFolder({ catalogs, fs, media: new InMemoryMedia() }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        videos: [
          {
            status: 'error',
            artifacts: {
              framePaths: ['/videos/frames/legacy/frame-001.jpg'],
              transcriptContent: 'legacy transcript',
              transcriptPath: '/videos/transcripts/legacy.txt',
            },
          },
        ],
      },
    });
  });
});
