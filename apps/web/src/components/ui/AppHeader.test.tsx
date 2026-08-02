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

  it('renders no FolderBar and no media toggle — both moved into the sidebar', () => {
    renderHeader({ mode: 'analysis' });

    expect(screen.queryByRole('button', { name: en.folderBar.openFolder })).toBeNull();
    expect(screen.queryByTestId('analysis-media-videos')).toBeNull();
  });
});

describe('AppHeader actions', () => {
  it('fires the settings/models/prerequisites callbacks', () => {
    const onShowSettings = vi.fn();
    const onShowModelManager = vi.fn();
    const onShowPrerequisites = vi.fn();
    renderHeader({ onShowSettings, onShowModelManager, onShowPrerequisites });

    fireEvent.click(screen.getByTestId('open-settings-button'));
    expect(onShowSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByText(en.appHeader.models));
    expect(onShowModelManager).toHaveBeenCalled();

    fireEvent.click(screen.getByText(en.appHeader.prerequisites));
    expect(onShowPrerequisites).toHaveBeenCalled();
  });
});
