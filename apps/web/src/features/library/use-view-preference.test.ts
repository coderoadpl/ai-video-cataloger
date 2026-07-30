import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPersistedView, resolveInitialView, useViewPreference, type ViewPreferenceController } from './use-view-preference.js';

describe('resolveInitialView', () => {
  it('prefers a persisted view over the catalog-emptiness default', () => {
    expect(resolveInitialView('videos', true)).toBe('videos');
  });

  it('falls back to library when the catalog is non-empty and nothing is persisted', () => {
    expect(resolveInitialView(null, true)).toBe('library');
  });

  it('falls back to videos when the catalog is empty and nothing is persisted', () => {
    expect(resolveInitialView(null, false)).toBe('videos');
  });
});

describe('useViewPreference', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('resolves to library once the catalog is known non-empty, when nothing is persisted', () => {
    const { result, rerender } = renderHook<ViewPreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useViewPreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    expect(result.current.view).toBe('videos');

    rerender({ hasFiles: true });

    expect(result.current.view).toBe('library');
  });

  it('stays on videos when the catalog resolves empty', () => {
    const { result, rerender } = renderHook<ViewPreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useViewPreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    rerender({ hasFiles: false });

    expect(result.current.view).toBe('videos');
  });

  it('a persisted preference wins over the catalog-emptiness default and survives a resolve', () => {
    window.localStorage.setItem('avc.activeView', 'people');

    const { result, rerender } = renderHook<ViewPreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useViewPreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    expect(result.current.view).toBe('people');

    rerender({ hasFiles: true });

    expect(result.current.view).toBe('people');
  });

  it('persists an explicit view change', () => {
    const { result } = renderHook(() => useViewPreference(null));

    act(() => result.current.setView('map'));

    expect(readPersistedView()).toBe('map');
  });
});
