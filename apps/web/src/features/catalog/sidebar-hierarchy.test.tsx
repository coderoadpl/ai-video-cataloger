import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { CatalogSidebar } from './CatalogSidebar.js';
import { type CatalogState } from './use-catalog.js';

const theme = createAppTheme('light');

const catalogState = (): CatalogState => ({
  videos: [],
  selectedVideo: null,
  selectedKey: null,
  select: vi.fn(),
  selectKey: vi.fn(),
  isLoading: false,
  isError: false,
  error: null,
  isGeneratingThumbnails: false,
  thumbnailFailedPaths: new Set(),
});

const renderSidebar = (
  folder: string | null,
  handlers: { onOpenFolder?: () => void; onAnalysisMediaChange?: (media: 'videos' | 'photos') => void } = {},
) =>
  renderWithProviders(
    <ThemeProvider theme={theme}>
      <CatalogSidebar
        folder={folder}
        catalog={catalogState()}
        registerVideos={vi.fn()}
        toolbar={<div data-testid="scope-toolbar" />}
        onOpenFolder={handlers.onOpenFolder ?? vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onAnalysisMediaChange={handlers.onAnalysisMediaChange ?? vi.fn()}
      />
    </ThemeProvider>,
  );

const testIdOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[data-testid]')).map((element) => element.getAttribute('data-testid') ?? '');

describe('CatalogSidebar hierarchy', () => {
  it('stacks the folder block above the medium toggle above the scope toolbar', () => {
    const { container } = renderSidebar('/videos');

    const order = testIdOrder(container);
    expect(order.indexOf('sidebar-folder-panel')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('sidebar-folder-panel')).toBeLessThan(order.indexOf('analysis-media-videos'));
    expect(order.indexOf('analysis-media-videos')).toBeLessThan(order.indexOf('scope-toolbar'));
  });

  it('opens a folder from the sidebar and switches medium from it, with no folder open yet', () => {
    const onOpenFolder = vi.fn();
    const onAnalysisMediaChange = vi.fn();
    const { container } = renderSidebar(null, { onOpenFolder, onAnalysisMediaChange });

    const order = testIdOrder(container);
    expect(order.indexOf('sidebar-folder-panel')).toBeLessThan(order.indexOf('analysis-media-videos'));

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));
    expect(onOpenFolder).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('analysis-media-photos'));
    expect(onAnalysisMediaChange).toHaveBeenCalledWith('photos');
  });
});
