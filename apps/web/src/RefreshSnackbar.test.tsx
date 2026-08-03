import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { refreshToastStore } from './refresh-toast.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';

describe('RefreshSnackbar', () => {
  afterEach(() => {
    refreshToastStore.dismiss();
  });

  it('sanitizes an absolute path leaked in a background refresh error', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RefreshSnackbar />
      </QueryClientProvider>,
    );

    act(() => {
      refreshToastStore.show(
        'Could not read /Users/example/Movies/private-folder-name/clip.mp4: permission denied',
      );
    });

    const message = screen.getByText(/couldn't refresh/);
    expect(message.textContent).not.toContain('/Users/example');
    expect(message.textContent).toContain('permission denied');
  });
});
