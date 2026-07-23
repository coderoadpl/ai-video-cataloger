import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAppTheme } from '../../theme.js';
import { AppHeader } from './AppHeader.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const renderHeader = (overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) => {
  const props: Parameters<typeof AppHeader>[0] = {
    appVersion: 'dev',
    recentFolders: [],
    isCheckingFolder: false,
    onOpenFolder: () => undefined,
    onSelectRecentFolder: () => undefined,
    onShowSettings: () => undefined,
    onShowModelManager: () => undefined,
    onShowPrerequisites: () => undefined,
    searchQuery: '',
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    recentSearches: [],
    onRemoveRecentSearch: () => undefined,
    topTags: [],
    onSearchFocus: () => undefined,
    ...overrides,
  };
  renderThemed(<AppHeader {...props} />);
};

describe('AppHeader search dropdown', () => {
  it('renders top tags and recent searches on empty focus, removes recents, and submits selections', async () => {
    const submit = vi.fn();
    const removeRecent = vi.fn();
    const searchFocus = vi.fn();

    renderHeader({
      recentSearches: ['drone'],
      topTags: [{ name: 'cooking', count: 3 }, { name: 'travel', count: 2 }],
      onSearchSubmit: submit,
      onRemoveRecentSearch: removeRecent,
      onSearchFocus: searchFocus,
    });

    fireEvent.focus(screen.getByPlaceholderText('Search catalog'));
    expect(searchFocus).toHaveBeenCalled();

    expect(await screen.findByText('Top tags')).toBeDefined();
    expect(screen.getByText('drone')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Remove drone'));
    expect(removeRecent).toHaveBeenCalledWith('drone');

    fireEvent.click(screen.getByText('cooking'));
    expect(submit).toHaveBeenCalledWith('cooking');
  });

  it('submits typed searches with Enter', async () => {
    const submit = vi.fn();
    const change = vi.fn();
    renderHeader({ searchQuery: 'drone', onSearchSubmit: submit, onSearchQueryChange: change });

    const input = screen.getByPlaceholderText('Search catalog');
    fireEvent.change(input, { target: { value: 'drone' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(submit).toHaveBeenCalledWith('drone'));
  });
});
