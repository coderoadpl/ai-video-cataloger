import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestQueryClient } from '../../test/render.js';
import { useGlobalSearch } from './use-global-search.js';

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('useGlobalSearch clearSearch', () => {
  it('deactivates the search so the detail view can take over on sidebar select', async () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });

    act(() => result.current.submitSearch('drone'));
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => result.current.clearSearch());
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(result.current.query).toBe('');
    expect(result.current.debouncedQuery).toBe('');
  });
});
