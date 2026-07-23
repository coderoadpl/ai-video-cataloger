import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { buildCatalogTree, flattenTreeVideos, type CatalogTreeData } from './catalog-tree-model.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const makeVideo = (path: string): ScanVideo => ({
  path,
  filename: path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: `hash:${path}`,
  artifacts: {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    summary: null,
    summaryPath: null,
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: null,
  },
});

const data: CatalogTreeData = {
  root: '/drive',
  folders: [
    { path: '/drive', name: 'drive', relativePath: '', depth: 0, videos: [], pendingCount: 1, processedCount: 2 },
    { path: '/drive/a/b', name: 'b', relativePath: 'a/b', depth: 2, videos: [], pendingCount: 3, processedCount: 0 },
  ],
  pendingTotal: 4,
  processedTotal: 2,
};

describe('buildCatalogTree', () => {
  it('synthesizes intermediate parents and aggregates subtree counts', () => {
    const root = buildCatalogTree(data);

    expect(root.relativePath).toBe('');
    expect(root.name).toBe('drive');
    expect(root.pendingCount).toBe(4);
    expect(root.processedCount).toBe(2);
    expect(root.children).toHaveLength(1);

    const a = root.children[0];
    expect(a?.name).toBe('a');
    expect(a?.relativePath).toBe('a');
    expect(a?.depth).toBe(1);
    expect(a?.videos).toHaveLength(0);
    expect(a?.pendingCount).toBe(3);

    const b = a?.children[0];
    expect(b?.name).toBe('b');
    expect(b?.relativePath).toBe('a/b');
    expect(b?.pendingCount).toBe(3);
    expect(b?.children).toHaveLength(0);
  });

  it('flattens videos across the whole subtree', () => {
    const root = buildCatalogTree({
      root: '/drive',
      folders: [
        { path: '/drive', name: 'drive', relativePath: '', depth: 0, videos: [makeVideo('/drive/top.mp4')], pendingCount: 1, processedCount: 0 },
        { path: '/drive/sub', name: 'sub', relativePath: 'sub', depth: 1, videos: [makeVideo('/drive/sub/inner.mp4')], pendingCount: 1, processedCount: 0 },
      ],
      pendingTotal: 2,
      processedTotal: 0,
    });

    expect(flattenTreeVideos(root).map((video) => video.path)).toEqual([
      '/drive/top.mp4',
      '/drive/sub/inner.mp4',
    ]);
  });
});
