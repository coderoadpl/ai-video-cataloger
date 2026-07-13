import { describe, expect, it } from 'vitest';

import { scanFolder } from './scan.js';
import { InMemoryCatalogs, InMemoryFileSystem, InMemoryMedia, videoFixture } from '../../../test/server/usecases/test-fakes.js';

describe('scanFolder', () => {
  it('scans supported videos, matches catalog rows, and loads completed artifacts', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/clip.mp4', { size: 2048, hash: 'hash-1' });
    fs.addFile('/videos/notes.txt', { size: 10 });
    fs.addDirectory('/videos/frames/renamed');
    fs.addFile('/videos/frames/renamed/1.jpg');
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
              framePaths: ['/videos/frames/renamed/1.jpg'],
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
    fs.addFile('/videos/frames/legacy/frame-001.jpg');
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
