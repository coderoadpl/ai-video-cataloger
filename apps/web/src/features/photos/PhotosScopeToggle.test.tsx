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
  it('uses the shared video scope toggle and switches to whole-tree scope', () => {
    const onScopeChange = vi.fn();
    renderThemed(<PhotosScopeToggle scope="folder" onScopeChange={onScopeChange} />);

    fireEvent.click(screen.getByTestId('scope-tree'));
    expect(onScopeChange).toHaveBeenCalledWith('tree');
    expect(screen.getByTestId('scope-folder').textContent).toBe('This folder');
    expect(screen.getByTestId('scope-tree').textContent).toBe('Whole tree');
  });

  it('disables whole-tree selection under the same rule as videos', () => {
    renderThemed(<PhotosScopeToggle scope="folder" onScopeChange={vi.fn()} disabled />);
    expect(screen.getByTestId('scope-tree').getAttribute('disabled')).not.toBeNull();
  });
});
