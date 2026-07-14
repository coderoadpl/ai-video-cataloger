import { QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { reportError } from './observability.js';
import { refreshToastStore } from './refresh-toast.js';

const MAX_RETRIES = 3;

const queryCache = new QueryCache({
  onError: (error, query) => {
    reportError(error);
    if (query.state.data === undefined) return;
    const message = error instanceof ApiError ? error.appError.message : 'Could not refresh data';
    refreshToastStore.show(message);
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (failureCount >= MAX_RETRIES) return false;
        if (error instanceof ApiError) return error.appError.code === 'internal';
        return true;
      },
    },
  },
});
