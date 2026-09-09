import { describe, expect, it } from 'vitest';

import { InMemoryFileSystem, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

const input = { videoPath: '/clip.mp4', thumbnailPath: '/cover.jpg', force: false, width: 128, height: 72, seekPercent: 0.1, priority: 'foreground' as const };

describe('InMemoryMedia thumbnail cache', () => {
  it.each([false, true])('generates missing files, skips cached files and regenerates with force (filesystem: %s)', async (withFs) => {
    const media = new InMemoryMedia(withFs ? new InMemoryFileSystem('/') : undefined);
    const first = await media.thumbnail(input);
    expect(first).toEqual({ ok: true, value: { path: input.thumbnailPath, generated: true, skipped: false } });
    const cached = await media.thumbnail(input);
    expect(cached).toEqual({ ok: true, value: { path: input.thumbnailPath, generated: false, skipped: true } });
    const forced = await media.thumbnail({ ...input, force: true });
    expect(forced).toEqual(first);
  });
});
