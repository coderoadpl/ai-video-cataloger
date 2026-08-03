import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { FolderBar } from './FolderBar.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('FolderBar', () => {
  it('offers a "Wyczyść ostatnie" action at the bottom of the recents menu and wires it to the clear handler', () => {
    const onClearRecentFolders = vi.fn();
    renderThemed(
      <FolderBar
        recentFolders={['/movies/a', '/movies/b']}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onClearRecentFolders={onClearRecentFolders}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.recentFolders }));

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.at(-1)?.textContent).toBe(en.folderBar.clearRecent);

    fireEvent.click(screen.getByRole('menuitem', { name: en.folderBar.clearRecent }));
    expect(onClearRecentFolders).toHaveBeenCalled();
  });

  it('does not offer the clear action when there are no recent folders', () => {
    renderThemed(
      <FolderBar
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onClearRecentFolders={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: en.folderBar.recentFolders }).hasAttribute('disabled')).toBe(true);
  });

  it('deduplicates recent folder entries by path before rendering', () => {
    renderThemed(
      <FolderBar
        recentFolders={['/movies/a', '/movies/a', '/movies/b']}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onClearRecentFolders={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.recentFolders }));

    expect(screen.getAllByText('/movies/a')).toHaveLength(1);
  });

  it('gives the main open-folder segment flex-grow and the dropdown segment a fixed narrow width when fullWidth', () => {
    renderThemed(
      <FolderBar
        recentFolders={['/movies/a']}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onClearRecentFolders={vi.fn()}
        fullWidth
      />,
    );

    const openButton = screen.getByRole('button', { name: en.folderBar.openFolder });
    const dropdownButton = screen.getByRole('button', { name: en.folderBar.recentFolders });

    expect(getComputedStyle(openButton).flexGrow).toBe('1');
    expect(getComputedStyle(openButton).width).toBe('auto');
    expect(getComputedStyle(dropdownButton).flexGrow).toBe('0');
    expect(getComputedStyle(dropdownButton).flexShrink).toBe('0');
    expect(getComputedStyle(dropdownButton).width).toBe('auto');
  });
});
