import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { CatalogTree } from './CatalogTree.js';
import { type CatalogTreeNode } from './core/index.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

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
  source: { width: 1920, height: 1080, rotation: 0 },
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

const makeNode = (node: Omit<CatalogTreeNode, 'directPendingCount' | 'directProcessedCount'> & {
  directPendingCount?: number | null;
  directProcessedCount?: number | null;
}): CatalogTreeNode => ({
  directPendingCount: node.pendingCount,
  directProcessedCount: node.processedCount,
  ...node,
});

const root: CatalogTreeNode = makeNode({
  path: '/drive',
  name: 'drive',
  relativePath: '',
  depth: 0,
  videos: [makeVideo('/drive/top.mp4')],
  pendingCount: 2,
  processedCount: 0,
  children: [
    makeNode({
      path: '/drive/sub',
      name: 'sub',
      relativePath: 'sub',
      depth: 1,
      videos: [makeVideo('/drive/sub/inner.mp4')],
      pendingCount: 1,
      processedCount: 0,
      children: [],
    }),
  ],
});

const renderTree = (props: Partial<React.ComponentProps<typeof CatalogTree>> = {}) =>
  renderThemed(
    <CatalogTree
      root={root}
      rootVideos={root.videos}
      selectedKey={null}
      analyzingPath={null}
      skippedPaths={new Set()}
      onSelect={vi.fn()}
      registerVideos={vi.fn()}
      {...props}
    />,
  );

describe('CatalogTree', () => {
  it('renders root videos and a collapsed child folder with exact counts, expanding on click', async () => {
    renderTree();

    expect(screen.getByText('top.mp4')).toBeDefined();
    const folderRow = screen.getByTestId('folder-row');
    expect(folderRow.getAttribute('data-folder-name')).toBe('sub');
    expect(folderRow.getAttribute('data-folder-pending')).toBe('1');
    expect(folderRow.textContent).toContain('1 pending');
    expect(folderRow.textContent).not.toContain('about');
    expect(screen.queryByText('inner.mp4')).toBeNull();

    await userEvent.click(folderRow);
    expect(await screen.findByText('inner.mp4')).toBeDefined();
  });

  it('uses a single scroll container for the whole tree', () => {
    renderTree();
    expect(screen.getAllByTestId('catalog-tree-scroll')).toHaveLength(1);
  });

  it('collapses the root row, hiding root videos and child folders', async () => {
    renderTree();
    expect(screen.getByText('top.mp4')).toBeDefined();
    await userEvent.click(screen.getByTestId('folder-root-row'));
    expect(screen.queryByText('top.mp4')).toBeNull();
    expect(screen.queryByTestId('folder-row')).toBeNull();
  });

  it('selects only the row matching the selected key even for byte-identical duplicates', () => {
    const shared = 'hash:shared';
    const clonedRoot = makeNode({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [
        makeVideo('/drive/original.mp4', { contentHash: shared }),
        makeVideo('/drive/copy.mp4', { contentHash: shared }),
      ],
      pendingCount: 2,
      processedCount: 0,
      children: [],
    });
    renderTree({ root: clonedRoot, rootVideos: clonedRoot.videos, selectedKey: '/drive/copy.mp4' });
    const rows = screen.getAllByTestId('video-item');
    const selected = rows.filter((row) => row.className.includes('Mui-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-video-filename')).toBe('copy.mp4');
  });

  it('shows a Duplicate badge with the canonical path and counts duplicates in the header', () => {
    const dupRoot = makeNode({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [
        makeVideo('/drive/dupe.mp4', { duplicate: { canonicalPath: '/drive/canon/final.mp4' } }),
        makeVideo('/drive/plain.mp4'),
      ],
      pendingCount: 2,
      processedCount: 0,
      children: [],
    });
    renderTree({ root: dupRoot, rootVideos: dupRoot.videos });
    const badge = screen.getByTestId('duplicate-badge');
    expect(badge.textContent).toBe('Duplicate');
    expect(badge.closest('[title]')?.getAttribute('title')).toContain('/drive/canon/final.mp4');
    const rootRow = screen.getByTestId('folder-root-row');
    expect(rootRow.getAttribute('data-folder-duplicates')).toBe('1');
    expect(rootRow.textContent).toContain('1 duplicate');
  });

  it('loads folder details only after expanding a lazy folder and registers its videos', async () => {
    let detailCalls = 0;
    server.use(
      http.get('/api/catalog-tree/folder', ({ request }) => {
        detailCalls += 1;
        expect(new URL(request.url).searchParams.get('folder')).toBe('/drive/lazy');
        return HttpResponse.json({ ok: true, data: { videos: [makeVideo('/drive/lazy/lazy.mp4')] } });
      }),
    );
    const registerVideos = vi.fn();
    const lazyRoot = makeNode({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [],
      videoCount: 1,
      pendingCount: null,
      processedCount: null,
      children: [
        makeNode({
          path: '/drive/lazy',
          name: 'lazy',
          relativePath: 'lazy',
          depth: 1,
          videos: [],
          directVideoCount: 1,
          videoCount: 1,
          pendingCount: null,
          processedCount: null,
          children: [],
        }),
      ],
    });

    renderTree({ root: lazyRoot, rootVideos: [], registerVideos });

    expect(screen.queryByText('lazy.mp4')).toBeNull();
    expect(detailCalls).toBe(0);

    await userEvent.click(screen.getByTestId('folder-row'));

    expect(await screen.findByText('lazy.mp4')).toBeDefined();
    expect(detailCalls).toBe(1);
    expect(registerVideos).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ path: '/drive/lazy/lazy.mp4' })]),
    );
  });

  it('reuses the eager scan for the root row instead of a second folder fetch', async () => {
    let rootFolderCalls = 0;
    server.use(
      http.get('/api/catalog-tree/folder', ({ request }) => {
        if (new URL(request.url).searchParams.get('folder') === '/drive') rootFolderCalls += 1;
        return HttpResponse.json({ ok: true, data: { videos: [] } });
      }),
    );
    const flatRoot = makeNode({
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [],
      directVideoCount: 1,
      videoCount: 1,
      pendingCount: null,
      processedCount: null,
      children: [],
    });

    renderTree({ root: flatRoot, rootVideos: [makeVideo('/drive/flat.mp4')] });

    expect(await screen.findByText('flat.mp4')).toBeDefined();
    expect(rootFolderCalls).toBe(0);
  });

  it('renders a square thumbnail bounding box for video rows', () => {
    renderTree();
    const thumb = screen.getAllByTestId('media-thumbnail')[0];
    expect(thumb?.getAttribute('data-thumbnail-width')).toBe('56');
    expect(thumb?.getAttribute('data-thumbnail-height')).toBe('56');
  });

  it('renders a Skipped badge for videos in the skipped set', () => {
    renderTree({ skippedPaths: new Set(['/drive/top.mp4']) });
    const topRow = screen
      .getAllByTestId('video-item')
      .find((row) => row.getAttribute('data-video-filename') === 'top.mp4');
    if (topRow === undefined) throw new Error('top.mp4 row not found');
    expect(within(topRow).getByTestId('skipped-badge')).toBeDefined();
  });

  it('renders large tree guidance with a copyable process-drive command', () => {
    server.use(
      http.get('/api/catalog-tree/folder', () => HttpResponse.json({ ok: true, data: { videos: [] } })),
    );
    const largeRoot = makeNode({
      path: '/drive/large set',
      name: 'large set',
      relativePath: '',
      depth: 0,
      videos: [],
      videoCount: 2_001,
      pendingCount: null,
      processedCount: null,
      children: [],
    });

    renderTree({ root: largeRoot, rootVideos: [] });

    expect(screen.getByTestId('large-tree-warning')).toBeDefined();
    expect(screen.getByText('Large folder tree')).toBeDefined();
    expect(screen.getByText("ai-video-cataloger process-drive '/drive/large set'")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy CLI command' })).toBeDefined();
  });
});
