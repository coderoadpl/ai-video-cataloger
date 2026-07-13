import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { initWebObservability, reportError } from './observability.js';
import { queryClient } from './query-client.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';
import { renderRootErrorFallback } from './RootErrorFallback.js';
import { IndexRoute } from './routes/index.js';
import { ThemeModeProvider } from './theme-mode.js';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRoute,
});

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

initWebObservability();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ThemeModeProvider>
      <CssBaseline />
      <ErrorBoundary fallback={renderRootErrorFallback} onError={reportError}>
        <QueryClientProvider client={queryClient}>
          <RefreshSnackbar />
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeModeProvider>
  </StrictMode>,
);
