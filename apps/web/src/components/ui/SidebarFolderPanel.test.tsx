import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { SidebarFolderPanel } from './SidebarFolderPanel.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('SidebarFolderPanel', () => {
  it('shows the folder name, path and an optional show-in-library action when a folder is open', () => {
    const onShowInLibrary = vi.fn();
    renderThemed(
      <SidebarFolderPanel
        folder="/movies/clips"
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        onShowInLibrary={onShowInLibrary}
        showInLibraryLabel="Show in Library"
        showInLibraryTestId="show-in-library"
      />,
    );

    expect(screen.getAllByText('clips').length).toBeGreaterThan(0);
    expect(screen.getByText('/movies/clips')).toBeDefined();
    fireEvent.click(screen.getByTestId('show-in-library'));
    expect(onShowInLibrary).toHaveBeenCalled();
  });

  it('renders the empty hint and hides the show-in-library action when no folder is open', () => {
    renderThemed(
      <SidebarFolderPanel
        folder={null}
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
        emptyHint={<span>Open a folder to get started</span>}
      />,
    );

    expect(screen.getByText('Open a folder to get started')).toBeDefined();
    expect(screen.queryByTestId('show-in-library')).toBeNull();
  });

  it("always renders the FolderBar's primary control, regardless of folder state", () => {
    const onOpenFolder = vi.fn();
    renderThemed(
      <SidebarFolderPanel
        folder={null}
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={onOpenFolder}
        onSelectRecentFolder={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));
    expect(onOpenFolder).toHaveBeenCalled();
  });
});
