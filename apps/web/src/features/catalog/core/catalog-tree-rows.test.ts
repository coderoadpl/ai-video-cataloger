import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { type CatalogTreeNode } from './catalog-tree-model.js';
import { buildTreeRows, countsFromVideos } from './catalog-tree-rows.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const makeVideo = (path: string, overrides: Partial<ScanVideo> = {}): ScanVideo => ({
  path,
  filename: path.split('/').pop() ?? '',
  size: 1024,
  sizeFormatted: '1.0 KB',
  duration: 60,
  durationFormatted: '1:00',
  status: 'pending',
  errorMessage: null,
  contentHash: `hash:${path}`,
  duplicate: null,
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
  ...overrides,
});

const node = (partial: Partial<CatalogTreeNode> & Pick<CatalogTreeNode, 'path' | 'name' | 'relativePath' | 'depth'>): CatalogTreeNode => ({
  videos: [],
  pendingCount: null,
  processedCount: null,
  directPendingCount: null,
  directProcessedCount: null,
  children: [],
  ...partial,
});

const alwaysExpanded = () => true;
const noLoaded = () => undefined;

describe('countsFromVideos', () => {
  it('splits duplicates and completed out of pending', () => {
    const counts = countsFromVideos([
      makeVideo('/a.mp4'),
      makeVideo('/b.mp4', { status: 'completed' }),
      makeVideo('/c.mp4', { duplicate: { canonicalPath: '/root/c.mp4' } }),
    ]);
    expect(counts).toEqual({ known: true, pending: 1, done: 1, duplicates: 1, videoCount: 3 });
  });
});

describe('buildTreeRows', () => {
  it('flattens folders and videos into a single ordered list', () => {
    const root = node({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [makeVideo('/drive/top.mp4')],
      children: [
        node({
          path: '/drive/sub',
          name: 'sub',
          relativePath: 'sub',
          depth: 1,
          videos: [makeVideo('/drive/sub/inner.mp4')],
        }),
      ],
    });

    const rows = buildTreeRows({ root, rootVideos: root.videos, isExpanded: alwaysExpanded, loadedFolder: noLoaded });

    expect(rows.map((row) => row.kind)).toEqual(['folder', 'video', 'folder', 'video']);
    expect(rows[1]).toMatchObject({ kind: 'video', depth: 1 });
    expect(rows[3]).toMatchObject({ kind: 'video', depth: 2 });
  });

  it('omits collapsed folder contents', () => {
    const root = node({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [makeVideo('/drive/top.mp4')],
      children: [node({ path: '/drive/sub', name: 'sub', relativePath: 'sub', depth: 1, directVideoCount: 3 })],
    });

    const rows = buildTreeRows({
      root,
      rootVideos: root.videos,
      isExpanded: (relativePath) => relativePath === '',
      loadedFolder: noLoaded,
    });

    expect(rows.map((row) => row.kind)).toEqual(['folder', 'video', 'folder']);
  });

  it('emits a loading status row for an expanded lazy folder awaiting data', () => {
    const root = node({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      children: [node({ path: '/drive/lazy', name: 'lazy', relativePath: 'lazy', depth: 1, directVideoCount: 2 })],
    });

    const rows = buildTreeRows({ root, rootVideos: [], isExpanded: alwaysExpanded, loadedFolder: noLoaded });

    expect(rows.map((row) => row.kind)).toEqual(['folder', 'folder', 'status']);
    expect(rows[2]).toMatchObject({ kind: 'status', variant: 'loading' });
  });

  it('shows exact folder header counts derived from loaded videos', () => {
    const root = node({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [
        makeVideo('/drive/a.mp4'),
        makeVideo('/drive/b.mp4', { duplicate: { canonicalPath: '/x/b.mp4' } }),
      ],
    });

    const rows = buildTreeRows({ root, rootVideos: root.videos, isExpanded: alwaysExpanded, loadedFolder: noLoaded });
    const rootRow = rows[0];
    expect(rootRow?.kind).toBe('folder');
    if (rootRow === undefined || rootRow.kind !== 'folder') return;
    expect(rootRow.counts).toEqual({ known: true, pending: 1, done: 0, duplicates: 1, videoCount: 2 });
  });
});
