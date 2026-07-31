import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAppTheme } from '../../theme.js';
import { en } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { AppHeader } from './AppHeader.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

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
    mode: 'analysis',
    onModeChange: () => undefined,
    ...overrides,
  };
  return renderThemed(<AppHeader {...props} />);
};

describe('AppHeader mode switcher', () => {
  it('renders the mode switcher and fires onModeChange when a mode is clicked', () => {
    const onModeChange = vi.fn();
    renderHeader({ onModeChange });

    expect(screen.getByTestId('mode-switcher')).toBeDefined();

    fireEvent.click(screen.getByTestId('mode-library'));
    expect(onModeChange).toHaveBeenCalledWith('library');
  });

  it('renders no search input', () => {
    renderHeader();

    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders the FolderBar in analysis mode', () => {
    renderHeader({ mode: 'analysis' });

    expect(screen.getByRole('button', { name: en.folderBar.openFolder })).toBeDefined();
  });

  it('renders no FolderBar in library mode', () => {
    renderHeader({ mode: 'library' });

    expect(screen.queryByRole('button', { name: en.folderBar.openFolder })).toBeNull();
  });
});
