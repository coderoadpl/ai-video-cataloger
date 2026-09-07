import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configResponse } from '../../test/config-response.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { LibraryGrid, type LibraryGridSection } from './LibraryGrid.js';
import type { LibraryVideoItem } from './core/index.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const gridItem = (fingerprint: string): LibraryVideoItem => ({
  media: 'video',
  fingerprint,
  variantCount: 1,
  fileName: `${fingerprint}.mp4`,
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: null,
  tags: [],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: null,
  place: null,
  width: null,
  height: null,
});

const sectionOf = (items: LibraryVideoItem[]): LibraryGridSection[] => [
  { key: 'day', label: 'day', offline: false, offlineReason: null, items },
];

const gridOf = (): HTMLElement => screen.getByTestId('library-grid');

const scrollTo = (grid: HTMLElement, scrollTop: number): void => {
  Object.defineProperty(grid, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  fireEvent.scroll(grid);
};

describe('LibraryGrid', () => {
  beforeEach(() => {
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('en'))));
  });

  it('NEW-01 keeps the mounted tile count bounded after the active tile scrolls out of view', () => {
    const items = Array.from({ length: 2000 }, (_, index) => gridItem(`fp-${String(index)}`));
    renderThemed(
      <LibraryGrid sections={sectionOf(items)} onOpen={vi.fn()} onOpenInAnalysis={vi.fn()} selectable={false} />,
    );

    const grid = gridOf();
    fireEvent.keyDown(grid, { key: 'Home' });
    const activeId = grid.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId ?? '')?.getAttribute('data-fingerprint')).toBe('fp-0');

    scrollTo(grid, 200_000);

    expect(screen.getAllByTestId('library-tile').length).toBeLessThan(60);
    expect(document.getElementById(activeId ?? '')).not.toBeNull();
    expect(document.querySelector('[data-fingerprint="fp-1999"]')).not.toBeNull();
  });

  it('NEW-02 toggles the focused checkbox on Space without opening the active tile', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    renderThemed(
      <LibraryGrid
        sections={sectionOf([gridItem('fp-1'), gridItem('fp-2')])}
        onOpen={onOpen}
        onSelect={onSelect}
        onOpenInAnalysis={vi.fn()}
      />,
    );

    const grid = gridOf();
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(grid.getAttribute('aria-activedescendant')).not.toBeNull();

    const tiles = screen.getAllByTestId('library-tile');
    const second = tiles[1];
    if (second === undefined) throw new Error('grid rendered fewer than two tiles');
    within(second).getByRole('checkbox').focus();
    await user.keyboard(' ');

    expect(onOpen).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'fp-2' }), { shiftKey: false });
  });
});
