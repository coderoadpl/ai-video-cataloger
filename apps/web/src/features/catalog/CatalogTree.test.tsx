import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
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
});
