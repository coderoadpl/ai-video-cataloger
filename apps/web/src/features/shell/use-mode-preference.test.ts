import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  migrateLegacyView,
  readPersistedMode,
  resolveInitialMode,
  useModePreference,
  type ModePreferenceController,
} from './use-mode-preference.js';

describe('migrateLegacyView', () => {
  it('returns null for an unknown or missing legacy value', () => {
    expect(migrateLegacyView(null)).toBeNull();
    expect(migrateLegacyView('bogus')).toBeNull();
  });

  it('migrates each legacy MainView to its mode/surface pair', () => {
    expect(migrateLegacyView('videos')).toEqual({ mode: 'analysis', analysisMedia: 'videos' });
    expect(migrateLegacyView('library')).toEqual({ mode: 'library', librarySurface: 'collection' });
    expect(migrateLegacyView('photos')).toEqual({ mode: 'library', librarySurface: 'collection' });
    expect(migrateLegacyView('people')).toEqual({ mode: 'library', librarySurface: 'people' });
    expect(migrateLegacyView('map')).toEqual({ mode: 'library', librarySurface: 'map' });
  });
});

describe('resolveInitialMode', () => {
  it('prefers a persisted mode over the legacy migration and the heuristic', () => {
    expect(resolveInitialMode('analysis', { mode: 'library', librarySurface: 'collection' }, true)).toBe('analysis');
  });

  it('falls back to the legacy migration when nothing is persisted', () => {
    expect(resolveInitialMode(null, { mode: 'library', librarySurface: 'collection' }, false)).toBe('library');
  });

  it('falls back to library when the catalog is non-empty and nothing is persisted or legacy', () => {
    expect(resolveInitialMode(null, null, true)).toBe('library');
  });

  it('falls back to analysis when the catalog is empty and nothing is persisted or legacy', () => {
    expect(resolveInitialMode(null, null, false)).toBe('analysis');
  });
});

describe('useModePreference', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('resolves to library once the catalog is known non-empty, when nothing is persisted', () => {
    const { result, rerender } = renderHook<ModePreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useModePreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    expect(result.current.mode).toBe('analysis');

    rerender({ hasFiles: true });

    expect(result.current.mode).toBe('library');
  });

  it('stays on analysis when the catalog resolves empty', () => {
    const { result, rerender } = renderHook<ModePreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useModePreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    rerender({ hasFiles: false });

    expect(result.current.mode).toBe('analysis');
  });

  it('migrates a legacy avc.activeView and never rewrites it', () => {
    window.localStorage.setItem('avc.activeView', 'photos');

    const { result, rerender } = renderHook<ModePreferenceController, { hasFiles: boolean | null }>(
      ({ hasFiles }) => useModePreference(hasFiles),
      { initialProps: { hasFiles: null } },
    );

    expect(result.current.mode).toBe('library');
    expect(result.current.librarySurface).toBe('collection');

    rerender({ hasFiles: true });
    expect(result.current.mode).toBe('library');
    expect(window.localStorage.getItem('avc.activeView')).toBe('photos');
  });

  it('removes the photos-browse route by redirecting its persisted surface to Kolekcja', () => {
    window.localStorage.setItem('avc.librarySurface', 'photos');

    const { result } = renderHook(() => useModePreference(false));

    expect(result.current.librarySurface).toBe('collection');
  });

  it('setters persist and each mode remembers its own surface independently', () => {
    const { result } = renderHook(() => useModePreference(null));

    act(() => result.current.setLibrarySurface('map'));
    act(() => result.current.setAnalysisMedia('photos'));
    act(() => result.current.setMode('library'));

    expect(readPersistedMode()).toBe('library');
    expect(result.current.librarySurface).toBe('map');
    expect(result.current.analysisMedia).toBe('photos');

    act(() => result.current.setMode('analysis'));
    expect(result.current.librarySurface).toBe('map');
    expect(result.current.analysisMedia).toBe('photos');
  });
});
