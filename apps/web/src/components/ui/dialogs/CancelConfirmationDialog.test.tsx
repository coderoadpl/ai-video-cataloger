import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en, pl } from '../../../i18n/dictionary.js';
import { renderWithProviders } from '../../../test/render.js';
import { createAppTheme } from '../../../theme.js';
import { CancelConfirmationDialog } from './CancelConfirmationDialog.js';

const theme = createAppTheme('light');

describe('CancelConfirmationDialog', () => {
  it('uses photo-specific cancellation copy for a photos run in both dictionaries', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <CancelConfirmationDialog
          confirmation={{ open: true, isBatch: false }}
          media="photo"
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(en.cancelDialog.photoTitle)).toBeDefined();
    expect(screen.getByText(en.cancelDialog.photoBody)).toBeDefined();
    expect(screen.getByText(en.cancelDialog.photoAlert)).toBeDefined();
    expect(en.cancelDialog.photoAlert).not.toContain('video');
    expect(pl.cancelDialog.photoAlert).not.toContain('film');
    expect(pl.cancelDialog.photoAlert).toContain('zdjęci');
  });
});
