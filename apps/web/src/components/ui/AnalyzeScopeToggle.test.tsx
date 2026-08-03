import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { AnalyzeScopeToggle } from './AnalyzeScopeToggle.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) => renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('AnalyzeScopeToggle', () => {
  it('switches scope on click', async () => {
    const onScopeChange = vi.fn();
    renderThemed(<AnalyzeScopeToggle scope="folder" onScopeChange={onScopeChange} />);

    await userEvent.click(screen.getByTestId('scope-tree'));
    expect(onScopeChange).toHaveBeenCalledWith('tree');
  });

  it('disables the toggle group when disabled', () => {
    renderThemed(<AnalyzeScopeToggle scope="folder" onScopeChange={vi.fn()} disabled />);

    expect(screen.getByTestId('scope-tree').hasAttribute('disabled')).toBe(true);
  });
});
