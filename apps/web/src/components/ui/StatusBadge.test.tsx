import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAppTheme } from '../../theme.js';
import { CheckCircleIcon } from './icons.js';
import { StatusBadge } from './StatusBadge.js';

const theme = createAppTheme('light');

describe('StatusBadge', () => {
  it('UI-06 spaces the badge icon in pixels, not theme spacing steps', () => {
    render(
      <ThemeProvider theme={theme}>
        <StatusBadge icon={<CheckCircleIcon />} label="Analyzed" token="completed" testId="status-badge" />
      </ThemeProvider>,
    );

    const icon = screen.getByTestId('status-badge').querySelector('.MuiChip-icon');
    if (icon === null) throw new Error('badge renders no icon');
    const computed = getComputedStyle(icon);

    expect(computed.marginLeft).toBe('8px');
    expect(computed.marginRight).toBe('3px');
  });
});
