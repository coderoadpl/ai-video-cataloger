import { StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGuardedCallback, useMountGuard } from './use-mount-guard.js';

describe('useMountGuard', () => {
  it('reports a mounted guard with a live signal', () => {
    const { result } = renderHook(() => useMountGuard());

    expect(result.current.isMounted()).toBe(true);
    expect(result.current.signal().aborted).toBe(false);
  });

  it('aborts the signal and reports unmounted after teardown', () => {
    const { result, unmount } = renderHook(() => useMountGuard());
    const guard = result.current;

    unmount();

    expect(guard.isMounted()).toBe(false);
    expect(guard.signal().aborted).toBe(true);
  });

  it('re-arms after the double mount React runs in strict mode', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useMountGuard(), { wrapper });

    expect(result.current.isMounted()).toBe(true);
    expect(result.current.signal().aborted).toBe(false);
  });
});

describe('useGuardedCallback', () => {
  it('forwards arguments while mounted and drops calls after unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => {
      const guard = useMountGuard();
      return useGuardedCallback(guard, callback);
    });

    result.current('first', 1);
    expect(callback).toHaveBeenCalledWith('first', 1);

    const guarded = result.current;
    unmount();
    guarded('second', 2);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
