import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ThemeModeProvider } from '../theme-mode.js';
import { VisualSurface } from './surfaces.js';

afterEach(() => vi.useRealTimers());

it('pins the shell-loading banner and skeletons without in-flight queries or images', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults([], { enabled: false });
  const { container, unmount } = render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider><VisualSurface id="shell-loading" /></ThemeModeProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Setup incomplete')).toBeDefined();
  expect(screen.getByTestId('details-skeleton')).toBeDefined();
  expect(screen.getByTestId('sidebar-skeleton')).toBeDefined();
  expect(container.querySelector('img')).toBeNull();
  const initial = container.innerHTML;
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(container.innerHTML).toBe(initial);
  expect(client.getQueryCache().getAll().every((query) => query.state.fetchStatus === 'idle')).toBe(true);
  unmount();
  client.clear();
});
