import { describe, expect, it } from 'vitest';

import { scanTree } from './catalog-tree.js';
import {
  InMemoryCatalogs,
  InMemoryFileSystem,
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

describe('scanTree', () => {
  it('returns only video-bearing folders with relative paths, depth, and pending counts', async () => {
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
      { path: '/drive', relativePath: '', depth: 0, pending: 1 },
      { path: '/drive/a', relativePath: 'a', depth: 1, pending: 1 },
      { path: '/drive/b/nested', relativePath: 'b/nested', depth: 2, pending: 1 },
    ]);
    expect(result.value.pendingTotal).toBe(3);
    expect(result.value.processedTotal).toBe(0);
  });
});
