import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { DetailsPanel } from './DetailsPanel.js';

const theme = createAppTheme('light');

describe('DetailsPanel loading skeleton', () => {
  it('renders the skeleton while initial queries are in flight and nothing is selected', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <DetailsPanel video={null} analyzing={false} loading />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('details-skeleton')).toBeDefined();
    expect(screen.queryByText('Welcome to AI Video Cataloger')).toBeNull();
  });

  it('falls back to the welcome screen when not loading', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <DetailsPanel video={null} analyzing={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('details-skeleton')).toBeNull();
    expect(screen.getByText('Welcome to AI Video Cataloger')).toBeDefined();
  });
});
