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
  it('shows the folder name and path when a folder is open, with no show-in-library action', () => {
    renderThemed(
      <SidebarFolderPanel
        folder="/movies/clips"
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
      />,
    );

    expect(screen.getAllByText('clips').length).toBeGreaterThan(0);
    expect(screen.getByText('/movies/clips')).toBeDefined();
    expect(screen.queryByTestId('show-in-library')).toBeNull();
    expect(screen.queryByText('Show in Library')).toBeNull();
  });

  it('renders the empty hint when no folder is open', () => {
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

  it("renders the FolderBar's primary control above the folder identity block (owner W41 condensed layout)", () => {
    renderThemed(
      <SidebarFolderPanel
        folder="/movies/clips"
        recentFolders={[]}
        isCheckingFolder={false}
        onOpenFolder={vi.fn()}
        onSelectRecentFolder={vi.fn()}
      />,
    );

    const panel = screen.getByTestId('sidebar-folder-panel');
    const openFolderButton = screen.getByRole('button', { name: en.folderBar.openFolder });
    const identityBlock = screen.getByTestId('sidebar-folder-identity');
    const position = openFolderButton.compareDocumentPosition(identityBlock);
    expect(panel.contains(openFolderButton)).toBe(true);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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
