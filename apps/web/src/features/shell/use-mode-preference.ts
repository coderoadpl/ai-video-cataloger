import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppMode } from '../../components/ui/ModeSwitcher.js';
import type { LibrarySurface } from '../../components/ui/LibrarySubnav.js';
import type { AnalysisMedia } from '../../components/ui/AnalysisMediaToggle.js';

const MODE_KEY = 'avc.mode';
const LIBRARY_SURFACE_KEY = 'avc.librarySurface';
const ANALYSIS_MEDIA_KEY = 'avc.analysisMedia';
const LEGACY_VIEW_KEY = 'avc.activeView';

const isAppMode = (value: string | null): value is AppMode => value === 'library' || value === 'analysis';
const isLibrarySurface = (value: string | null): value is LibrarySurface =>
  value === 'collection' || value === 'people' || value === 'map';
const isAnalysisMedia = (value: string | null): value is AnalysisMedia => value === 'videos' || value === 'photos';

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

export const readPersistedMode = (): AppMode | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(MODE_KEY);
  return isAppMode(raw) ? raw : null;
};

const readPersistedLibrarySurface = (): LibrarySurface | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(LIBRARY_SURFACE_KEY);
  return isLibrarySurface(raw) ? raw : null;
};

const readPersistedAnalysisMedia = (): AnalysisMedia | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(ANALYSIS_MEDIA_KEY);
  return isAnalysisMedia(raw) ? raw : null;
};

const readLegacyView = (): string | null => {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(LEGACY_VIEW_KEY);
};

export interface LegacyModeMigration {
  mode: AppMode;
  librarySurface?: LibrarySurface;
  analysisMedia?: AnalysisMedia;
}

export const migrateLegacyView = (raw: string | null): LegacyModeMigration | null => {
  switch (raw) {
    case 'videos':
      return { mode: 'analysis', analysisMedia: 'videos' };
    case 'library':
      return { mode: 'library', librarySurface: 'collection' };
    case 'photos':
      return { mode: 'library', librarySurface: 'collection' };
    case 'people':
      return { mode: 'library', librarySurface: 'people' };
    case 'map':
      return { mode: 'library', librarySurface: 'map' };
    case null:
    default:
      return null;
  }
};

export const resolveInitialMode = (
  persisted: AppMode | null,
  legacy: LegacyModeMigration | null,
  catalogHasFiles: boolean,
): AppMode => persisted ?? legacy?.mode ?? (catalogHasFiles ? 'library' : 'analysis');

export interface ModePreferenceController {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  librarySurface: LibrarySurface;
  setLibrarySurface: (surface: LibrarySurface) => void;
  analysisMedia: AnalysisMedia;
  setAnalysisMedia: (media: AnalysisMedia) => void;
}

export const useModePreference = (catalogHasFiles: boolean | null): ModePreferenceController => {
  const legacyRef = useRef(migrateLegacyView(readLegacyView()));
  const legacy = legacyRef.current;

  const [mode, setModeState] = useState<AppMode>(() => readPersistedMode() ?? legacy?.mode ?? 'analysis');
  const [librarySurface, setLibrarySurfaceState] = useState<LibrarySurface>(
    () => readPersistedLibrarySurface() ?? legacy?.librarySurface ?? 'collection',
  );
  const [analysisMedia, setAnalysisMediaState] = useState<AnalysisMedia>(
    () => readPersistedAnalysisMedia() ?? legacy?.analysisMedia ?? 'videos',
  );
  const resolvedRef = useRef(readPersistedMode() !== null || legacy !== null);

  useEffect(() => {
    if (resolvedRef.current || catalogHasFiles === null) return;
    resolvedRef.current = true;
    if (catalogHasFiles) setModeState('library');
  }, [catalogHasFiles]);

  const setMode = useCallback((next: AppMode) => {
    resolvedRef.current = true;
    setModeState(next);
    if (canUseStorage()) window.localStorage.setItem(MODE_KEY, next);
  }, []);

  const setLibrarySurface = useCallback((next: LibrarySurface) => {
    setLibrarySurfaceState(next);
    if (canUseStorage()) window.localStorage.setItem(LIBRARY_SURFACE_KEY, next);
  }, []);

  const setAnalysisMedia = useCallback((next: AnalysisMedia) => {
    setAnalysisMediaState(next);
    if (canUseStorage()) window.localStorage.setItem(ANALYSIS_MEDIA_KEY, next);
  }, []);

  return { mode, setMode, librarySurface, setLibrarySurface, analysisMedia, setAnalysisMedia };
};
