import { describe, expect, it } from 'vitest';

import { generateThumbnail } from './thumbnail.js';
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
      },
    ]);
  });

  it('rejects unsupported file extensions', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addFile('/work/readme.txt');

    const result = await generateThumbnail({ fs, media: new InMemoryMedia() }, { videoPath: 'readme.txt', force: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_file_type' } });
  });
});
