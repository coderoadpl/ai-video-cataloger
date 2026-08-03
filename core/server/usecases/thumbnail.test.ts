import { describe, expect, it } from 'vitest';

import { ensureGridThumbnail, generateGridThumbnail, generateThumbnail, stagedFrameCandidates } from './thumbnail.js';
import { InMemoryFileSystem, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

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

  it('never treats a sub-512 source as usable, and falls through to the next candidate', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/proxy.jpg');
    fs.addFile('/work/original.jpg');
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
      expect.objectContaining({ framePath: '/work/original.jpg' }),
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

  it('skips and removes a stale grid thumb when no candidate meets the 512 floor', async () => {
    const fs = new InMemoryFileSystem('/work');
    const media = new InMemoryMedia();
    fs.addFile('/work/proxy.jpg');
    fs.addFile('/work/.ai-video-cataloger/thumbnails/ph.grid.jpg');
    media.dimensions.set('/work/proxy.jpg', { width: 128, height: 70 });

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
