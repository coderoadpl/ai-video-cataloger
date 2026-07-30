import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { SearchResults } from './SearchResults.js';
import {
  readRecentSearches,
  RECENT_SEARCHES_KEY,
  storeRecentSearch,
  writeRecentSearches,
  type GlobalSearchState,
} from './use-global-search.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const searchState: GlobalSearchState = {
  query: 'drone',
  setQuery: () => undefined,
  submitSearch: () => undefined,
  clearSearch: () => undefined,
  debouncedQuery: 'drone',
  active: true,
  recentSearches: [],
  removeRecentSearch: () => undefined,
  topTags: [],
  onSearchFocus: () => undefined,
  isLoading: false,
  isError: false,
  error: null,
  count: 2,
  groups: [
    {
      folder: {
        folderId: '11111111-1111-4111-8111-111111111111',
        currentPath: '/online',
        displayName: 'online',
        online: true,
      },
      results: [{
        fingerprint: 'fp-1',
        variantCount: 2,
        fileName: 'clip.mp4',
        finalName: 'drone-clip.mp4',
        description: 'A drone clip',
        snippet: '<mark>drone</mark> clip',
        thumbnailPath: '/online/.ai-video-cataloger/thumbnails/drone-clip.jpg',
        tags: ['aerial'],
        folder: {
          folderId: '11111111-1111-4111-8111-111111111111',
          currentPath: '/online',
          displayName: 'online',
          online: true,
        },
        gps: null,
        missing: false,
        capturedAt: null,
        place: null,
      }],
    },
    {
      folder: {
        folderId: '22222222-2222-4222-8222-222222222222',
        currentPath: '/offline',
        displayName: 'offline',
        online: false,
      },
      results: [{
        fingerprint: 'fp-2',
        variantCount: 1,
        fileName: 'field.mp4',
        finalName: null,
        description: null,
        snippet: 'field drone',
        thumbnailPath: null,
        tags: [],
        folder: {
          folderId: '22222222-2222-4222-8222-222222222222',
          currentPath: '/offline',
          displayName: 'offline',
          online: false,
        },
        gps: null,
        missing: false,
        capturedAt: null,
        place: null,
      }],
    },
  ],
};

describe('SearchResults', () => {
  it('opens the detail of a clicked online result and reveals through the context menu', () => {
    const reveal = vi.spyOn(bridge, 'revealInFinder').mockResolvedValue(true);
    const onOpenResult = vi.fn();

    renderThemed(
      <SearchResults search={searchState} onBack={() => undefined} onOpenFolder={() => undefined} onOpenResult={onOpenResult} />,
    );

    expect(screen.getByText('drive not connected')).toBeDefined();
    expect(screen.getByText('aerial')).toBeDefined();
    expect(screen.getByTestId('search-variant-count').textContent).toBe('2 variants');

    fireEvent.click(screen.getByText('drone-clip.mp4'));
    expect(onOpenResult).toHaveBeenCalledWith('/online', '/online/clip.mp4');
    expect(reveal).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('drone-clip.mp4'));
    fireEvent.click(screen.getByTestId('reveal-in-finder-item'));
    expect(reveal).toHaveBeenCalledWith('/online/clip.mp4');
    reveal.mockRestore();
  });

  it('clears the query and returns to the prior view when the back affordance is used', () => {
    const onBack = vi.fn();
    renderThemed(
      <SearchResults search={searchState} onBack={onBack} onOpenFolder={() => undefined} onOpenResult={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('search-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders a 56px thumbnail bounding box for each result row', () => {
    renderThemed(
      <SearchResults search={searchState} onBack={() => undefined} onOpenFolder={() => undefined} onOpenResult={() => undefined} />,
    );
    const thumbs = screen.getAllByTestId('media-thumbnail');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]?.getAttribute('data-thumbnail-width')).toBe('56');
    expect(thumbs[0]?.getAttribute('data-thumbnail-height')).toBe('56');
    expect(thumbs[0]?.getAttribute('data-thumbnail-state')).toBe('image');
    expect(thumbs[1]?.getAttribute('data-thumbnail-state')).toBe('placeholder');
  });
});

describe('recent searches', () => {
  it('stores newest first, dedupes, persists, and caps at 10', () => {
    const stored = Array.from({ length: 12 }, (_, index) => `q-${index}`)
      .reduce<readonly string[]>((current, value) => storeRecentSearch(current, value), []);

    expect(stored).toHaveLength(10);
    expect(stored[0]).toBe('q-11');
    expect(stored.at(-1)).toBe('q-2');

    const deduped = storeRecentSearch(stored, 'q-5');
    expect(deduped[0]).toBe('q-5');
    expect(deduped.filter((entry) => entry === 'q-5')).toHaveLength(1);

    writeRecentSearches(deduped);
    expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toHaveLength(10);
    expect(readRecentSearches()).toEqual(deduped);
  });
});
