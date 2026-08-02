import { describe, expect, it } from 'vitest';

import { type AppError, type Result, ok } from '@core/domain/index.js';

import type { JobProgress } from '../ports.js';
import { runThumbnailsPass } from './thumbnails.js';
import { InMemoryFileSystem, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

const recordingProgress = (events: JobProgress[]) => ({
  signal: new AbortController().signal,
  reportProgress: (progress: JobProgress): Promise<Result<void, AppError>> => {
    events.push(progress);
    return Promise.resolve(ok(undefined));
  },
});

const seedCompletedFile = (fs: InMemoryFileSystem, videoPath: string, base: string): void => {
  fs.addFile(videoPath, { size: 100 });
  fs.addFile(`/root/summaries/${base}.json`, {
    content: JSON.stringify({
      schemaVersion: 1,
      description: 'd',
      suggestedFilename: base,
      fullAnalysis: 'DESCRIPTION: d\nFILENAME: x',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    }),
  });
  fs.addFile(`/root/frames/${base}/frame-001.jpg`);
};

describe('runThumbnailsPass', () => {
  it('generates thumbnails for completed files and reports fromFrame', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    fs.addDirectory('/root');
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    seedCompletedFile(fs, '/root/b.mp4', 'b');
    fs.addFile('/root/c.mp4', { size: 100 });

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toBe(2);
    expect(result.value.generated).toBe(2);
    expect(result.value.fromFrame).toBe(2);
    expect(result.value.fromSource).toBe(0);
    expect(result.value.failed).toBe(0);
    expect(result.value.gridGenerated).toBe(2);
    expect(result.value.gridSkipped).toBe(0);
    expect(result.value.gridFailed).toBe(0);
    expect(media.thumbnailFromFrameInputs).toContainEqual(expect.objectContaining({
      thumbnailPath: '/root/.ai-video-cataloger/thumbnails/a.grid.jpg',
      width: 512,
      height: 512,
      fit: 'cover',
    }));
  });

  it('skips generating the .grid.jpg on a second pass without force, and regenerates with force', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');

    const first = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });
    expect(first.ok && first.value.gridGenerated).toBe(1);

    const second = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });
    expect(second.ok && second.value.gridSkipped).toBe(1);
    expect(second.ok && second.value.gridGenerated).toBe(0);

    const forced = await runThumbnailsPass({ fs, media }, { root: '/root', force: true });
    expect(forced.ok && forced.value.gridGenerated).toBe(1);
  });

  it('does not generate a .grid.jpg when the candidate has no stored analysis frame', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    fs.addFile('/root/a.mp4', { size: 100 });
    fs.addFile('/root/summaries/a.json', {
      content: JSON.stringify({
        schemaVersion: 1,
        description: 'd',
        suggestedFilename: 'a',
        fullAnalysis: 'DESCRIPTION: d\nFILENAME: x',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      }),
    });

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(0);
    expect(result.value.gridSkipped).toBe(0);
    expect(result.value.gridFailed).toBe(0);
  });

  it('emits scanning, one file event per candidate, and a done event', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    seedCompletedFile(fs, '/root/b.mp4', 'b');
    const events: JobProgress[] = [];

    await runThumbnailsPass({ fs, media }, { root: '/root', force: false }, recordingProgress(events));

    expect(events.map((event) => event.step)).toEqual(['thumbnails_scanning', 'thumbnails_file', 'thumbnails_file', 'thumbnails_done']);
  });

  it('is a no-op on a second pass without --force, and regenerates with --force', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    seedCompletedFile(fs, '/root/b.mp4', 'b');

    const first = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });
    expect(first.ok && first.value.generated).toBe(2);

    const second = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });
    expect(second.ok && second.value).toMatchObject({ generated: 0, skipped: 2 });

    const forced = await runThumbnailsPass({ fs, media }, { root: '/root', force: true });
    expect(forced.ok && forced.value.generated).toBe(2);
  });

  it('records a per-file failure and continues, without failing the whole pass', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    media.failFromFrame = true;
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    seedCompletedFile(fs, '/root/b.mp4', 'b');

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failed).toBe(2);
    expect(result.value.generated).toBe(0);
    expect(result.value.failures).toHaveLength(2);
  });

  it('reports all-zero counts on an empty tree instead of an error', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result).toMatchObject({
      ok: true,
      value: { candidates: 0, generated: 0, skipped: 0, failed: 0 },
    });
  });

  it('stops with a cancellation error when the signal is aborted mid-walk', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    seedCompletedFile(fs, '/root/b.mp4', 'b');
    const controller = new AbortController();
    controller.abort();

    const result = await runThumbnailsPass(
      { fs, media },
      { root: '/root', force: false },
      { signal: controller.signal, reportProgress: () => Promise.resolve(ok(undefined)) },
    );

    expect(result).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
  });

  it('falls back to seeking the source video for the grid thumb when the stored frame is a degraded sub-512 source', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    media.dimensions.set('/root/frames/a/frame-001.jpg', { width: 128, height: 70 });

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(1);
    expect(media.thumbnailInputs).toContainEqual(expect.objectContaining({
      videoPath: '/root/a.mp4',
      thumbnailPath: '/root/.ai-video-cataloger/thumbnails/a.grid.jpg',
      width: 512,
      height: 512,
      fit: 'cover',
    }));
  });

  it('generates a thumbnail for a file under a diacritic subfolder written NFD on disk', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    const nfdSubfolder = '/root/Å-ring'.normalize('NFD');
    fs.addFile(`${nfdSubfolder}/a.mp4`, { size: 100 });
    fs.addFile(`${nfdSubfolder}/summaries/a.json`, {
      content: JSON.stringify({
        schemaVersion: 1,
        description: 'd',
        suggestedFilename: 'a',
        fullAnalysis: 'DESCRIPTION: d\nFILENAME: x',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    fs.addFile(`${nfdSubfolder}/frames/a/frame-001.jpg`);

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toBe(1);
    expect(result.value.generated).toBe(1);
    expect(result.value.failed).toBe(0);
  });
});
