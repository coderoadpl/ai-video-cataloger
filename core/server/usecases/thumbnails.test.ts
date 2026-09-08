import { describe, expect, it, vi } from 'vitest';

import { catalogFileSchema, type AppError, type Result, ok } from '@core/domain/index.js';

import type { JobProgress } from '../ports.js';
import { runThumbnailsPass } from './thumbnails.js';
import { InMemoryFileSystem, InMemoryMedia, InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';

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
  it.each([true, false])('CAT-03 ignores colliding suggestions for staged frames with recorded mapping: %s', async (recorded) => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    const globalCatalog = new InMemoryGlobalCatalogStore();
    await globalCatalog.upsertFolder({ folderId: 'path-aaaaaaaa', currentPath: '/root', displayName: 'root', firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' });
    for (const name of recorded ? ['a', 'b'] : ['b']) {
      await globalCatalog.upsertFile(catalogFileSchema.parse({ fingerprint: `fp-${name}`, folderId: 'path-aaaaaaaa', fileName: `${name}.mp4`, size: 100, durationS: null, processedAt: '2026-01-01T00:00:00.000Z', analyzer: null, model: null }));
      await globalCatalog.upsertAnalysis({ fingerprint: `fp-${name}`, finalName: 'a.mp4', description: 'd', transcript: null, language: null, tags: [] });
    }
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    await fs.deletePath('/root/frames/a');
    fs.addFile('/root/a.mp4', { hash: 'fp-a' });
    fs.addFile('/root/.ai-video-cataloger/artifacts/frames/fp-a/frm_a/frame-001.jpg');
    fs.addFile('/root/.ai-video-cataloger/artifacts/frames/fp-b/frm_b/frame-001.jpg');
    expect(await runThumbnailsPass({ fs, media, globalCatalog }, { root: '/root', force: false })).toMatchObject({ ok: true });
    expect(media.thumbnailFromFrameInputs).toContainEqual(expect.objectContaining({
      framePath: '/root/.ai-video-cataloger/artifacts/frames/fp-a/frm_a/frame-001.jpg',
      thumbnailPath: '/root/.ai-video-cataloger/thumbnails/a.grid.jpg',
    }));
  });

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

  it('falls back to seeking the source video for the grid thumb when there is no projected or staged frame (native-style variant)', async () => {
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

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(1);
    expect(result.value.gridSkipped).toBe(0);
    expect(result.value.gridFailed).toBe(0);
    expect(media.thumbnailInputs).toContainEqual(expect.objectContaining({
      videoPath: '/root/a.mp4',
      thumbnailPath: '/root/.ai-video-cataloger/thumbnails/a.grid.jpg',
      width: 512,
      height: 512,
      fit: 'cover',
    }));
  });

  it('uses a staged-but-unprojected frame for the grid thumb, cheaper than seeking the source video', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    fs.addFile('/root/a.mp4', { size: 100, hash: 'fp-a' });
    fs.addFile('/root/summaries/a.json', {
      content: JSON.stringify({
        schemaVersion: 1,
        description: 'd',
        suggestedFilename: 'a',
        fullAnalysis: 'DESCRIPTION: d\nFILENAME: x',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    fs.addFile('/root/.ai-video-cataloger/artifacts/frames/fp-a/frm_a/frame-001.jpg');

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(1);
    expect(media.thumbnailFromFrameInputs).toContainEqual(expect.objectContaining({
      framePath: '/root/.ai-video-cataloger/artifacts/frames/fp-a/frm_a/frame-001.jpg',
      thumbnailPath: '/root/.ai-video-cataloger/thumbnails/a.grid.jpg',
    }));
    expect(media.thumbnailInputs.some((input) => input.thumbnailPath === '/root/.ai-video-cataloger/thumbnails/a.grid.jpg')).toBe(false);
  });

  it('regenerates an existing grid thumbnail without --force when the stored frame is below the grid floor', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    media.dimensions.set('/root/frames/a/frame-001.jpg', { width: 128, height: 72 });
    fs.addFile('/root/.ai-video-cataloger/thumbnails/a.grid.jpg', { content: 'stale-blurry' });

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(1);
    expect(result.value.gridSkipped).toBe(0);
  });

  it('leaves an existing grid thumbnail alone without --force when the stored frame already meets the grid floor', async () => {
    const fs = new InMemoryFileSystem('/root');
    const media = new InMemoryMedia(fs);
    seedCompletedFile(fs, '/root/a.mp4', 'a');
    media.dimensions.set('/root/frames/a/frame-001.jpg', { width: 1024, height: 1024 });
    fs.addFile('/root/.ai-video-cataloger/thumbnails/a.grid.jpg', { content: 'already-sharp' });

    const result = await runThumbnailsPass({ fs, media }, { root: '/root', force: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gridGenerated).toBe(0);
    expect(result.value.gridSkipped).toBe(1);
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

it('CP-07 skips hash and probe work for cached video thumbnails', async () => {
  const fs = new InMemoryFileSystem('/root');
  const media = new InMemoryMedia(fs);
  const globalCatalog = new InMemoryGlobalCatalogStore();
  fs.addDirectory('/root');
  seedCompletedFile(fs, '/root/a.mp4', 'a');
  await runThumbnailsPass({ fs, media, globalCatalog }, { root: '/root', force: false });
  const hash = vi.spyOn(fs, 'partialContentHash');
  const probe = vi.spyOn(media, 'probe');
  expect((await runThumbnailsPass({ fs, media, globalCatalog }, { root: '/root', force: false })).ok).toBe(true);
  expect(hash).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
});
