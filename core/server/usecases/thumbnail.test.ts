import { describe, expect, it, vi } from 'vitest';

import { appError } from '@core/domain/index.js';
import { GRID_THUMBNAIL_GENERATION_VERSION, ensureGridThumbnail, generateGridThumbnail, generateThumbnail, stagedFrameCandidates } from './thumbnail.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

describe('generateThumbnail', () => {
  it('validates the video and delegates thumbnail generation to media', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4', { size: 100 });

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: true });

    expect(result).toEqual({
      ok: true,
      value: {
        video: 'clip.mp4',
        path: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        generated: true,
        skipped: false,
      },
    });
    expect(media.thumbnailInputs).toEqual([
      {
        videoPath: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        seekPercent: 0.25,
        width: 128,
        height: 72,
        force: true,
        priority: 'foreground',
      },
    ]);
  });

  it('reports the artifact path of a skipped generation that found the thumbnail on disk', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4', { size: 100 });
    fs.addFile('/work/.ai-video-cataloger/thumbnails/clip.jpg');

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: false });

    expect(result).toEqual({
      ok: true,
      value: {
        video: 'clip.mp4',
        path: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        generated: false,
        skipped: true,
      },
    });
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('rejects unsupported file extensions', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/work/readme.txt');

    const result = await generateThumbnail({ fs, media: new InMemoryMedia() }, { videoPath: 'readme.txt', force: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_file_type' } });
  });

  it('prefers the stored analysis frame over seeking the source video', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4', { size: 100 });
    fs.addFile('/work/frames/clip/frame-001.jpg');
    fs.addFile('/work/frames/clip/frame-002.jpg');

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: true });

    expect(result).toEqual({
      ok: true,
      value: {
        video: 'clip.mp4',
        path: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        generated: true,
        skipped: false,
      },
    });
    expect(media.thumbnailFromFrameInputs).toEqual([
      {
        framePath: '/work/frames/clip/frame-001.jpg',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        width: 128,
        height: 72,
        force: true,
        priority: 'foreground',
      },
    ]);
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('succeeds from the stored frame when the source video is gone', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/frames/clip/frame-001.jpg');

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: true });

    expect(result.ok).toBe(true);
    expect(media.thumbnailFromFrameInputs).toHaveLength(1);
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('reports skipped without calling media when a thumbnail already exists and force is false', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4', { size: 100 });
    fs.addFile('/work/frames/clip/frame-001.jpg');
    fs.addFile('/work/.ai-video-cataloger/thumbnails/clip.jpg');

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: false });

    expect(result).toEqual({
      ok: true,
      value: {
        video: 'clip.mp4',
        path: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        generated: false,
        skipped: true,
      },
    });
    expect(media.thumbnailFromFrameInputs).toEqual([]);
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('falls back to the source seek when no frame is stored', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4', { size: 100 });

    const result = await generateThumbnail({ fs, media }, { videoPath: 'clip.mp4', force: true });

    expect(result).toEqual({
      ok: true,
      value: {
        video: 'clip.mp4',
        path: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        generated: true,
        skipped: false,
      },
    });
    expect(media.thumbnailInputs).toEqual([
      {
        videoPath: '/work/clip.mp4',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.jpg',
        seekPercent: 0.25,
        width: 128,
        height: 72,
        force: true,
        priority: 'foreground',
      },
    ]);
    expect(media.thumbnailFromFrameInputs).toEqual([]);
  });
});

describe('generateGridThumbnail', () => {
  it('delegates a 512 cover-fit crop from the given frame to media', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/frames/clip/frame-001.jpg');

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [{ kind: 'frame', path: '/work/frames/clip/frame-001.jpg' }],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        force: false,
        priority: 'background',
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        path: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        generated: true,
        skipped: false,
        source: 'frame',
      },
    });
    expect(media.thumbnailFromFrameInputs).toEqual([
      {
        framePath: '/work/frames/clip/frame-001.jpg',
        thumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        width: 512,
        height: 512,
        force: false,
        fit: 'cover',
        priority: 'background',
      },
    ]);
  });

  it('maps media errors to thumbnail_error', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    media.failFromFrame = true;
    fs.addFile('/work/frames/clip/frame-001.jpg');

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [{ kind: 'frame', path: '/work/frames/clip/frame-001.jpg' }],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        force: false,
      },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'thumbnail_error' } });
  });

  it('prefers the first floor-meeting source over a sub-512 source and later larger sources', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/proxy.jpg');
    fs.addFile('/work/original.jpg');
    fs.addFile('/work/larger.jpg');
    media.dimensions.set('/work/proxy.jpg', { width: 128, height: 70 });
    media.dimensions.set('/work/original.jpg', { width: 4000, height: 3000 });
    media.dimensions.set('/work/larger.jpg', { width: 6000, height: 4000 });

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [
          { kind: 'proxy', path: '/work/proxy.jpg' },
          { kind: 'original', path: '/work/original.jpg' },
          { kind: 'original', path: '/work/larger.jpg' },
        ],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/ph.grid.jpg',
        force: false,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        path: '/work/.ai-video-cataloger/thumbnails/ph.grid.jpg',
        generated: true,
        skipped: false,
        source: 'original',
      },
    });
    expect(media.thumbnailFromFrameInputs).toEqual([
      expect.objectContaining({ framePath: '/work/original.jpg', width: 512, height: 512, fit: 'cover' }),
    ]);
  });

  it('regenerates an existing grid thumb once a proper source becomes available, bypassing the exists-skip', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/proxy.jpg');
    fs.addFile('/work/original.jpg');
    fs.addFile('/work/.ai-video-cataloger/thumbnails/ph.grid.jpg');
    media.dimensions.set('/work/proxy.jpg', { width: 128, height: 70 });
    media.dimensions.set('/work/original.jpg', { width: 4000, height: 3000 });

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [
          { kind: 'proxy', path: '/work/proxy.jpg' },
          { kind: 'original', path: '/work/original.jpg' },
        ],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/ph.grid.jpg',
        force: false,
      },
    );

    expect(result.ok && result.value.generated).toBe(true);
    expect(media.thumbnailFromFrameInputs).toEqual([
      expect.objectContaining({ framePath: '/work/original.jpg', force: true }),
    ]);
  });

  it.each(['missing', 'unprobeable'])('skips and removes a stale grid thumb when the source is %s', async (source) => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    if (source === 'unprobeable') fs.addFile('/work/proxy.jpg');
    fs.addFile('/work/.ai-video-cataloger/thumbnails/ph.grid.jpg');
    vi.spyOn(media, 'probe').mockResolvedValue({ ok: false, error: appError('processing_error', 'Probe failed') });

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [{ kind: 'proxy', path: '/work/proxy.jpg' }],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/ph.grid.jpg',
        force: false,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        path: '/work/.ai-video-cataloger/thumbnails/ph.grid.jpg',
        generated: false,
        skipped: true,
        source: null,
      },
    });
    expect(media.thumbnailFromFrameInputs).toEqual([]);
    await expect(fs.exists('/work/.ai-video-cataloger/thumbnails/ph.grid.jpg')).resolves.toEqual({
      ok: true,
      value: false,
    });
  });

  it.each([
    { width: 856, height: 480, edge: 480 },
    { width: 480, height: 856, edge: 480 },
    { width: 128, height: 72, edge: 72 },
    { width: 512, height: 512, edge: 512 },
    { width: 1920, height: 1080, edge: 512 },
  ])('generates and caches a $edge square cover from a $width by $height video without upscaling', async ({ width, height, edge }) => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia(fs);
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const videoPath = '/work/clip.mp4';
    const gridThumbnailPath = '/work/clip.grid.jpg';
    fs.addFile(videoPath);
    media.dimensions.set(videoPath, { width, height });
    const input = {
      videoPath, gridThumbnailPath, projectedFramePath: null,
      catalogDirectory: '/work/.ai-video-cataloger', fingerprint: null, force: false,
    };

    const result = await ensureGridThumbnail({ fs, media, globalCatalog }, input);

    expect(result).toMatchObject({ ok: true, value: { generated: true, skipped: false, source: 'video' } });
    expect(media.thumbnailInputs).toEqual([
      expect.objectContaining({ videoPath, width: edge, height: edge, fit: 'cover', seekPercent: 0.25 }),
    ]);
    await expect(fs.isFile(gridThumbnailPath)).resolves.toEqual({ ok: true, value: true });
    await expect(globalCatalog.getGridThumbnail(gridThumbnailPath)).resolves.toEqual({
      ok: true,
      value: {
        outputPath: gridThumbnailPath, generationVersion: GRID_THUMBNAIL_GENERATION_VERSION,
        sourcePath: videoPath, sourceKind: 'video', primary: true,
      },
    });
    const probe = vi.spyOn(media, 'probe');
    await expect(ensureGridThumbnail({ fs, media, globalCatalog }, input)).resolves.toMatchObject({
      ok: true, value: { generated: false, skipped: true },
    });
    expect(probe).not.toHaveBeenCalled();
    expect(media.thumbnailInputs).toHaveLength(1);
  });

  it.each([
    { frameEdge: 300, videoEdge: 480, source: 'video', primary: false, edge: 480 },
    { frameEdge: 480, videoEdge: 300, source: 'frame', primary: true, edge: 480 },
    { frameEdge: 480, videoEdge: 480, source: 'frame', primary: true, edge: 480 },
  ])('selects $source for subfloor edges $frameEdge and $videoEdge, preserving primary=$primary', async ({ frameEdge, videoEdge, source, primary, edge }) => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia(fs);
    const globalCatalog = new InMemoryGlobalCatalogStore();
    fs.addFile('/work/frame.jpg');
    fs.addFile('/work/clip.mp4');
    media.dimensions.set('/work/frame.jpg', { width: 856, height: frameEdge });
    media.dimensions.set('/work/clip.mp4', { width: videoEdge, height: 856 });

    const result = await generateGridThumbnail({ fs, media, globalCatalog }, {
      candidates: [{ kind: 'frame', path: '/work/frame.jpg' }, { kind: 'video', path: '/work/clip.mp4' }],
      gridThumbnailPath: '/work/clip.grid.jpg', force: false,
    });

    expect(result).toMatchObject({ ok: true, value: { generated: true, skipped: false, source } });
    expect([...media.thumbnailInputs, ...media.thumbnailFromFrameInputs]).toEqual([
      expect.objectContaining({ width: edge, height: edge, fit: 'cover' }),
    ]);
    await expect(globalCatalog.getGridThumbnail('/work/clip.grid.jpg')).resolves.toMatchObject({
      ok: true, value: { sourceKind: source, sourcePath: primary ? '/work/frame.jpg' : '/work/clip.mp4', primary },
    });
  });

  it.each([{ width: null, height: 70 }, { width: 128, height: null }])('keeps unknown dimensions eligible in candidate order: %o', async (dimensions) => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/frame.jpg');
    fs.addFile('/work/clip.mp4');
    media.dimensions.set('/work/frame.jpg', dimensions);
    media.dimensions.set('/work/clip.mp4', { width: 1920, height: 1080 });

    const result = await generateGridThumbnail({ fs, media }, {
      candidates: [{ kind: 'frame', path: '/work/frame.jpg' }, { kind: 'video', path: '/work/clip.mp4' }],
      gridThumbnailPath: '/work/clip.grid.jpg', force: false,
    });

    expect(result).toMatchObject({ ok: true, value: { source: 'frame' } });
    expect(media.thumbnailFromFrameInputs).toEqual([expect.objectContaining({ width: 512, height: 512 })]);
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('never generates from a source without probing it first, and falls back to the source-video seek when the stored frame is degraded', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/frames/clip/frame-001.jpg');
    fs.addFile('/work/clip.mp4');
    media.dimensions.set('/work/frames/clip/frame-001.jpg', { width: 400, height: 300 });

    const result = await generateGridThumbnail(
      { fs, media },
      {
        candidates: [
          { kind: 'frame', path: '/work/frames/clip/frame-001.jpg' },
          { kind: 'video', path: '/work/clip.mp4', seekPercent: 0.25 },
        ],
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        force: false,
      },
    );

    expect(result.ok && result.value.source).toBe('video');
    expect(media.thumbnailInputs).toEqual([
      expect.objectContaining({
        videoPath: '/work/clip.mp4',
        seekPercent: 0.25,
        width: 512,
        height: 512,
        fit: 'cover',
      }),
    ]);
    expect(media.thumbnailFromFrameInputs).toEqual([]);
  });
});

describe('stagedFrameCandidates', () => {
  it('returns an empty list when the fingerprint has no staged frames directory', async () => {
    const fs = new InMemoryFileSystem('/work');

    const result = await stagedFrameCandidates(fs, '/work/.ai-video-cataloger', 'fp-absent');

    expect(result).toEqual({ ok: true, value: [] });
  });

  it('returns the first frame file of the only staged frames key', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-001.jpg');
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-002.jpg');

    const result = await stagedFrameCandidates(fs, '/work/.ai-video-cataloger', 'fp-1');

    expect(result).toEqual({
      ok: true,
      value: [{ kind: 'frame', path: '/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-001.jpg' }],
    });
  });

  it('picks the newest staged frames key by mtime when several are staged for the same fingerprint', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_old/frame-001.jpg', { mtimeMs: 1000 });
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_new/frame-001.jpg', { mtimeMs: 2000 });

    const result = await stagedFrameCandidates(fs, '/work/.ai-video-cataloger', 'fp-1');

    expect(result).toEqual({
      ok: true,
      value: [{ kind: 'frame', path: '/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_new/frame-001.jpg' }],
    });
  });

  it('ignores a staged key directory left with no frame files', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_empty');

    const result = await stagedFrameCandidates(fs, '/work/.ai-video-cataloger', 'fp-1');

    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe('ensureGridThumbnail', () => {
  it('prefers the projected frame over a staged frame and the source video', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/frames/clip/frame-001.jpg');
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-001.jpg');
    fs.addFile('/work/clip.mp4');

    const result = await ensureGridThumbnail(
      { fs, media },
      {
        videoPath: '/work/clip.mp4',
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        projectedFramePath: '/work/frames/clip/frame-001.jpg',
        catalogDirectory: '/work/.ai-video-cataloger',
        fingerprint: 'fp-1',
        force: false,
      },
    );

    expect(result.ok && result.value.source).toBe('frame');
    expect(media.thumbnailFromFrameInputs).toEqual([
      expect.objectContaining({ framePath: '/work/frames/clip/frame-001.jpg' }),
    ]);
  });

  it('falls back to the staged frame when there is no projected frame, without seeking the video', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-001.jpg');
    fs.addFile('/work/clip.mp4');

    const result = await ensureGridThumbnail(
      { fs, media },
      {
        videoPath: '/work/clip.mp4',
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        projectedFramePath: null,
        catalogDirectory: '/work/.ai-video-cataloger',
        fingerprint: 'fp-1',
        force: false,
      },
    );

    expect(result.ok && result.value.source).toBe('frame');
    expect(media.thumbnailFromFrameInputs).toEqual([
      expect.objectContaining({ framePath: '/work/.ai-video-cataloger/artifacts/frames/fp-1/frm_a/frame-001.jpg' }),
    ]);
    expect(media.thumbnailInputs).toEqual([]);
  });

  it('falls back to seeking the source video when there is neither a projected nor a staged frame', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4');

    const result = await ensureGridThumbnail(
      { fs, media },
      {
        videoPath: '/work/clip.mp4',
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        projectedFramePath: null,
        catalogDirectory: '/work/.ai-video-cataloger',
        fingerprint: 'fp-1',
        force: false,
      },
    );

    expect(result.ok && result.value.source).toBe('video');
    expect(media.thumbnailInputs).toEqual([
      expect.objectContaining({ videoPath: '/work/clip.mp4', seekPercent: 0.25 }),
    ]);
  });

  it('falls back to seeking the source video when the fingerprint is unavailable (native-style variant)', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/clip.mp4');

    const result = await ensureGridThumbnail(
      { fs, media },
      {
        videoPath: '/work/clip.mp4',
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        projectedFramePath: null,
        catalogDirectory: '/work/.ai-video-cataloger',
        fingerprint: null,
        force: false,
      },
    );

    expect(result.ok && result.value.source).toBe('video');
  });
});
