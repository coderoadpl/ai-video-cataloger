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
        fileName: 'clip.mp4',
        finalName: 'drone-clip.mp4',
        description: 'A drone clip',
        snippet: '<mark>drone</mark> clip',
        tags: ['aerial'],
        folder: {
          folderId: '11111111-1111-4111-8111-111111111111',
          currentPath: '/online',
          displayName: 'online',
          online: true,
        },
        gps: null,
        missing: false,
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
        fileName: 'field.mp4',
        finalName: null,
        description: null,
        snippet: 'field drone',
        tags: [],
        folder: {
          folderId: '22222222-2222-4222-8222-222222222222',
          currentPath: '/offline',
          displayName: 'offline',
          online: false,
        },
        gps: null,
        missing: false,
      }],
    },
  ],
};

describe('SearchResults', () => {
  it('renders grouped results and reveals online files through the bridge', () => {
    const reveal = vi.spyOn(bridge, 'revealInFinder').mockResolvedValue(undefined);

    renderThemed(<SearchResults search={searchState} onOpenFolder={() => undefined} />);

    expect(screen.getByText('2 result(s)')).toBeDefined();
    expect(screen.getByText('drive not connected')).toBeDefined();
    expect(screen.getByText('aerial')).toBeDefined();

    fireEvent.click(screen.getByText('drone-clip.mp4'));

    expect(reveal).toHaveBeenCalledWith('/online/clip.mp4');
    reveal.mockRestore();
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
