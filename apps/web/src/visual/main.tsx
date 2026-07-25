import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '../query-client.js';
import { ThemeModeProvider } from '../theme-mode.js';
import { surfaceIdFromSearch, VisualSurface } from './surfaces.js';

queryClient.setQueryDefaults([], { enabled: false });

const container = document.getElementById('visual-root');
if (!container) throw new Error('Missing #visual-root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <CssBaseline />
        <VisualSurface id={surfaceIdFromSearch(window.location.search)} />
      </ThemeModeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
