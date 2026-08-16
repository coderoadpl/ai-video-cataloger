import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en, pl } from '../../i18n/dictionary.js';
import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { PhotoStatusBadge } from './PhotoStatusBadge.js';

const theme = createAppTheme('light');

describe('PhotoStatusBadge', () => {
  it('uses dedicated short English photo status labels', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <PhotoStatusBadge status="pending" dictionary={en} testId="pending" />
        <PhotoStatusBadge status="analysed" dictionary={en} testId="analysed" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('pending').textContent).toBe('Not analyzed');
    expect(screen.getByTestId('analysed').textContent).toBe('Analyzed');
  });

  it('uses grammatically neutral short Polish photo status labels', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <PhotoStatusBadge status="pending" dictionary={pl} testId="pending" />
        <PhotoStatusBadge status="analysed" dictionary={pl} testId="analysed" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('pending').textContent).toBe('Nieprzeanalizowane');
    expect(screen.getByTestId('analysed').textContent).toBe('Przeanalizowane');
  });
});
