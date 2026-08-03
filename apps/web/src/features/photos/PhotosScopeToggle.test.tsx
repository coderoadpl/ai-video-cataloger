import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { PhotosScopeToggle } from './PhotosScopeToggle.js';

const theme = createAppTheme('light');
const renderThemed = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('PhotosScopeToggle', () => {
  it('switches between folder and all scope', () => {
    const onScopeChange = vi.fn();
    renderThemed(<PhotosScopeToggle scope="folder" onScopeChange={onScopeChange} />);

    fireEvent.click(screen.getByTestId('photos-scope-all'));
    expect(onScopeChange).toHaveBeenCalledWith('all');
  });

  it('truncates each toggle label instead of wrapping onto a second line at narrow widths', () => {
    renderThemed(<PhotosScopeToggle scope="folder" onScopeChange={vi.fn()} />);

    const folderButton = screen.getByTestId('photos-scope-folder');
    const allButton = screen.getByTestId('photos-scope-all');
    expect(getComputedStyle(folderButton).minWidth).toBe('0px');
    expect(getComputedStyle(allButton).minWidth).toBe('0px');

    for (const button of [folderButton, allButton]) {
      const label = button.querySelector('span');
      if (label === null) throw new Error('missing label span');
      const style = getComputedStyle(label);
      expect(style.whiteSpace).toBe('nowrap');
      expect(style.overflow).toBe('hidden');
      expect(style.textOverflow).toBe('ellipsis');
    }
  });
});
