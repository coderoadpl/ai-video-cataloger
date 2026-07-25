import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useScopePreference } from './use-scope-preference.js';

describe('useScopePreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to folder scope and persists the choice per folder', () => {
    const { result, rerender } = renderHook(
      ({ folder }: { folder: string | null }) => useScopePreference(folder),
      { initialProps: { folder: '/movies/a' } },
    );

    expect(result.current[0]).toBe('folder');
    act(() => result.current[1]('tree'));
    expect(result.current[0]).toBe('tree');

    rerender({ folder: '/movies/b' });
    expect(result.current[0]).toBe('folder');

    rerender({ folder: '/movies/a' });
    expect(result.current[0]).toBe('tree');
  });

  it('restores a persisted choice on a fresh mount', () => {
    window.localStorage.setItem('avc.analyzeScope:/movies/a', 'tree');

    const { result } = renderHook(() => useScopePreference('/movies/a'));

    expect(result.current[0]).toBe('tree');
  });
});
