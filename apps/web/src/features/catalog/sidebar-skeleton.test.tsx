import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { CatalogSidebar } from './CatalogSidebar.js';
import { type CatalogState } from './use-catalog.js';
import { type CatalogTreeState } from './use-catalog-tree.js';

const theme = createAppTheme('light');

const baseCatalog = (overrides: Partial<CatalogState> = {}): CatalogState => ({
  videos: [],
  selectedVideo: null,
  selectedKey: null,
  select: vi.fn(),
  isLoading: false,
  isError: false,
  error: null,
  isGeneratingThumbnails: false,
  ...overrides,
});

const baseTree = (overrides: Partial<CatalogTreeState> = {}): CatalogTreeState => ({
  root: null,
  pendingTotal: 0,
  processedTotal: 0,
  videoTotal: 0,
  hasUnknownPending: false,
  isLoading: false,
  isError: false,
  error: null,
  ...overrides,
});

const render = (catalog: CatalogState, tree: CatalogTreeState) =>
  renderWithProviders(
    <ThemeProvider theme={theme}>
      <CatalogSidebar folder="/drive" catalog={catalog} tree={tree} registerVideos={vi.fn()} />
    </ThemeProvider>,
  );

describe('CatalogSidebar loading skeleton', () => {
  it('shows the skeleton while the tree is loading with no data yet', () => {
    render(baseCatalog({ isLoading: true }), baseTree({ isLoading: true }));
    expect(screen.getByTestId('sidebar-skeleton')).toBeDefined();
  });

  it('does not show the skeleton once the tree has data', () => {
    render(
      baseCatalog(),
      baseTree({
        root: {
          path: '/drive',
          name: 'drive',
          relativePath: '',
          depth: 0,
          videos: [],
          pendingCount: 0,
          processedCount: 0,
          directPendingCount: 0,
          directProcessedCount: 0,
          children: [],
        },
      }),
    );
    expect(screen.queryByTestId('sidebar-skeleton')).toBeNull();
  });
});
