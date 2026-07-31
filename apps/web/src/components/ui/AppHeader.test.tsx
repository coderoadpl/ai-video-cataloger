import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAppTheme } from '../../theme.js';
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
  renderThemed(<AppHeader {...props} />);
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
});
