import { describe, expect, it } from 'vitest';

import { generateGridThumbnail, generateThumbnail } from './thumbnail.js';
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
    const media = new InMemoryMedia();

    const result = await generateGridThumbnail(
      { fs: new InMemoryFileSystem('/work'), media },
      {
        framePath: '/work/frames/clip/frame-001.jpg',
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
    const media = new InMemoryMedia();
    media.failFromFrame = true;

    const result = await generateGridThumbnail(
      { fs: new InMemoryFileSystem('/work'), media },
      {
        framePath: '/work/frames/clip/frame-001.jpg',
        gridThumbnailPath: '/work/.ai-video-cataloger/thumbnails/clip.grid.jpg',
        force: false,
      },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'thumbnail_error' } });
  });
});
