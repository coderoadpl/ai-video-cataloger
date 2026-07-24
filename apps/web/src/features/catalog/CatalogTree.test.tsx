import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { CatalogTree } from './CatalogTree.js';
import { type CatalogTreeNode } from './catalog-tree-model.js';

type ScanVideo = z.output<typeof scanVideoSchema>;

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

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

const root: CatalogTreeNode = {
  path: '/drive',
  name: 'drive',
  relativePath: '',
  depth: 0,
  videos: [makeVideo('/drive/top.mp4')],
  pendingCount: 2,
  processedCount: 0,
  children: [
    {
      path: '/drive/sub',
      name: 'sub',
      relativePath: 'sub',
      depth: 1,
      videos: [makeVideo('/drive/sub/inner.mp4')],
      pendingCount: 1,
      processedCount: 0,
      children: [],
    },
  ],
};

describe('CatalogTree', () => {
  it('renders root videos and a collapsed child folder with counts, expanding on click', async () => {
    renderThemed(
      <CatalogTree root={root} selectedKey={null} analyzingPath={null} skippedPaths={new Set()} onSelect={vi.fn()} />,
    );

    expect(screen.getByText('top.mp4')).toBeDefined();
    const folderRow = screen.getByTestId('folder-row');
    expect(folderRow.getAttribute('data-folder-name')).toBe('sub');
    expect(folderRow.getAttribute('data-folder-pending')).toBe('1');
    expect(folderRow.textContent).toContain('1 pending');
    expect(screen.queryByText('inner.mp4')).toBeNull();

    await userEvent.click(folderRow);
    expect(await screen.findByText('inner.mp4')).toBeDefined();
  });

  it('renders a Skipped badge for videos in the skipped set', () => {
    renderThemed(
      <CatalogTree
        root={root}
        selectedKey={null}
        analyzingPath={null}
        skippedPaths={new Set(['/drive/top.mp4'])}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId('skipped-badge')).toBeDefined();
  });

  it('loads folder details only after expanding a folder with lazy video counts', async () => {
    let detailCalls = 0;
    server.use(
      http.get('/api/catalog-tree/folder', ({ request }) => {
        detailCalls += 1;
        expect(new URL(request.url).searchParams.get('folder')).toBe('/drive/lazy');
        return HttpResponse.json({
          ok: true,
          data: { videos: [makeVideo('/drive/lazy/lazy.mp4')] },
        });
      }),
    );
    const lazyRoot: CatalogTreeNode = {
      path: '/drive',
      name: 'drive',
      relativePath: '',
      depth: 0,
      videos: [],
      videoCount: 1,
      pendingCount: null,
      processedCount: null,
      children: [
        {
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
        },
      ],
    };

    renderThemed(
      <CatalogTree root={lazyRoot} selectedKey={null} analyzingPath={null} skippedPaths={new Set()} onSelect={vi.fn()} />,
    );

    expect(screen.queryByText('lazy.mp4')).toBeNull();
    expect(detailCalls).toBe(0);

    await userEvent.click(screen.getByTestId('folder-row'));

    expect(await screen.findByText('lazy.mp4')).toBeDefined();
    expect(detailCalls).toBe(1);
  });

  it('renders large tree guidance with a copyable process-drive command', () => {
    server.use(
      http.get('/api/catalog-tree/folder', () =>
        HttpResponse.json({
          ok: true,
          data: { videos: [] },
        }),
      ),
    );
    const largeRoot: CatalogTreeNode = {
      path: '/drive/large set',
      name: 'large set',
      relativePath: '',
      depth: 0,
      videos: [],
      videoCount: 2_001,
      pendingCount: null,
      processedCount: null,
      children: [],
    };

    renderThemed(
      <CatalogTree root={largeRoot} selectedKey={null} analyzingPath={null} skippedPaths={new Set()} onSelect={vi.fn()} />,
    );

    expect(screen.getByTestId('large-tree-warning')).toBeDefined();
    expect(screen.getByText('Large folder tree')).toBeDefined();
    expect(screen.getByText("ai-video-cataloger process-drive '/drive/large set'")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy CLI command' })).toBeDefined();
  });
});
