import { useCallback, useEffect, useState } from 'react';

import type { AnalyzeScope } from '../../components/ui/ScopeAnalyzeToolbar.js';

const KEY_PREFIX = 'avc.analyzeScope:';

const isScope = (value: string | null): value is AnalyzeScope => value === 'folder' || value === 'tree';

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

const readScope = (folder: string | null): AnalyzeScope => {
  if (folder === null || !canUseStorage()) return 'folder';
  const raw = window.localStorage.getItem(`${KEY_PREFIX}${folder}`);
  return isScope(raw) ? raw : 'folder';
};

export const useScopePreference = (
  folder: string | null,
): readonly [AnalyzeScope, (scope: AnalyzeScope) => void] => {
  const [scope, setScopeState] = useState<AnalyzeScope>(() => readScope(folder));

  useEffect(() => {
    setScopeState(readScope(folder));
  }, [folder]);

  const setScope = useCallback(
    (next: AnalyzeScope) => {
      setScopeState(next);
      if (folder !== null && canUseStorage()) {
        window.localStorage.setItem(`${KEY_PREFIX}${folder}`, next);
      }
    },
    [folder],
  );

  return [scope, setScope];
};
