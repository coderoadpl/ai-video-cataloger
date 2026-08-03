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
});
