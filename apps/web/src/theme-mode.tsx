import { useMemo, type ReactNode } from 'react';
import { ThemeProvider, useMediaQuery } from '@mui/material';

import { createAppTheme, type ThemeMode } from './theme.js';

/**
 * Follows the OS appearance: the whole app re-themes when the user flips
 * light/dark in System Settings, matching the old renderer's
 * `prefers-color-scheme` stylesheet. There is no in-app toggle — the OS is the
 * single source of truth.
 */
export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: ThemeMode = prefersDark ? 'dark' : 'light';
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};
