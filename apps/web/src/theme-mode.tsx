import { useMemo, type ReactNode } from 'react';
import { ThemeProvider, useMediaQuery } from '@mui/material';

import { createAppTheme, type ThemeMode } from './theme.js';

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: ThemeMode = prefersDark ? 'dark' : 'light';
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};
