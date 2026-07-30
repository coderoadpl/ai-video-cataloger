import { useCallback, useEffect, useRef, useState } from 'react';

import type { MainView } from '../../components/ui/ViewNav.js';

const STORAGE_KEY = 'avc.activeView';

const isMainView = (value: string | null): value is MainView =>
  value === 'videos' || value === 'library' || value === 'photos' || value === 'people' || value === 'map';

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

export const readPersistedView = (): MainView | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isMainView(raw) ? raw : null;
};

export const resolveInitialView = (persisted: MainView | null, catalogHasFiles: boolean): MainView =>
  persisted ?? (catalogHasFiles ? 'library' : 'videos');

export interface ViewPreferenceController {
  view: MainView;
  setView: (view: MainView) => void;
}

export const useViewPreference = (
  catalogHasFiles: boolean | null,
): ViewPreferenceController => {
  const [view, setViewState] = useState<MainView>(() => readPersistedView() ?? 'videos');
  const resolvedRef = useRef(readPersistedView() !== null);

  useEffect(() => {
    if (resolvedRef.current || catalogHasFiles === null) return;
    resolvedRef.current = true;
    if (catalogHasFiles) setViewState('library');
  }, [catalogHasFiles]);

  const setView = useCallback((next: MainView) => {
    resolvedRef.current = true;
    setViewState(next);
    if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return { view, setView };
};
