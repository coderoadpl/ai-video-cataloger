import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';

import { actions, bridge } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import type { PhotoListItem, PhotoRoot } from './core/index.js';

const PAGE_LIMIT = 200;
const SCOPE_KEY = 'avc.photosScope';
const ROOT_KEY = 'avc.photosRoot';

export type PhotosAnalysisScope = 'folder' | 'all';

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

const isScope = (value: string | null): value is PhotosAnalysisScope => value === 'folder' || value === 'all';

const readScope = (): PhotosAnalysisScope => {
  if (!canUseStorage()) return 'folder';
  const raw = window.localStorage.getItem(SCOPE_KEY);
  return isScope(raw) ? raw : 'folder';
};

const readRoot = (): string | null => {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(ROOT_KEY);
};

const resolveSelectedRoot = (persisted: string | null, roots: readonly PhotoRoot[]): string | null => {
  if (roots.length === 0) return null;
  if (persisted !== null && roots.some((root) => root.root === persisted)) return persisted;
  return roots[0]?.root ?? null;
};

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

interface UsePhotosAnalysisOptions {
  active: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

export interface PhotosAnalysisState {
  isLoading: boolean;
  error: string | null;
  roots: PhotoRoot[];
  scope: PhotosAnalysisScope;
  setScope: (scope: PhotosAnalysisScope) => void;
  selectedRoot: string | null;
  selectRoot: (root: string | null) => void;
  items: PhotoListItem[];
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  selectedFingerprint: string | null;
  selectFingerprint: (fingerprint: string | null) => void;
  activeJobLabel: string | null;
  isBusy: boolean;
  scanFolder: () => void;
}

export const usePhotosAnalysis = ({ active, addLine, intervalMs = 1000 }: UsePhotosAnalysisOptions): PhotosAnalysisState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const [scope, setScopeState] = useState<PhotosAnalysisScope>(() => readScope());
  const [selectedRoot, setSelectedRootState] = useState<string | null>(() => readRoot());
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadedItems, setLoadedItems] = useState<PhotoListItem[]>([]);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const roots = tree.data?.roots ?? [];

  useEffect(() => {
    if (tree.data === undefined) return;
    const resolved = resolveSelectedRoot(selectedRoot, tree.data.roots);
    if (resolved !== selectedRoot) setSelectedRootState(resolved);
  }, [tree.data, selectedRoot]);

  const setScope = useCallback((next: PhotosAnalysisScope) => {
    setScopeState(next);
    if (canUseStorage()) window.localStorage.setItem(SCOPE_KEY, next);
  }, []);

  const selectRoot = useCallback((next: string | null) => {
    setSelectedRootState(next);
    if (canUseStorage()) {
      if (next === null) window.localStorage.removeItem(ROOT_KEY);
      else window.localStorage.setItem(ROOT_KEY, next);
    }
  }, []);

  const listRoot = scope === 'folder' ? selectedRoot : null;

  useEffect(() => {
    setOffset(0);
  }, [listRoot]);

  const list = useQuery({
    ...actions.photosList({ ...(listRoot === null ? {} : { root: listRoot }), offset, limit: PAGE_LIMIT }),
    enabled: active,
  });

  useEffect(() => {
    if (list.data === undefined) return;
    setLoadedItems((current) => (offset === 0 ? list.data.items : [...current, ...list.data.items]));
  }, [list.data, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_LIMIT), []);

  const scanMutation = useMutation(actions.photosScan);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const scanFolder = useCallback(() => {
    if (activeJobLabel !== null) return;
    void (async () => {
      const picked = await bridge.folder.showPicker('photos');
      if (picked === null) return;
      setActiveJobLabel(dictionary.photos.title);
      addLine(dictionary.photos.title, 'info');
      try {
        const job = await scanMutation.mutateAsync({ root: picked });
        const final = await pollJobUntilTerminal(job.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
        });
        if (final.status === 'completed') {
          addLine(dictionary.photos.title, 'success');
          await invalidate();
          selectRoot(picked);
        } else {
          addLine(`${dictionary.photos.title}: ${final.error?.message ?? 'unknown error'}`, 'error');
        }
      } catch (error) {
        addLine(`${dictionary.photos.title}: ${messageOf(error)}`, 'error');
      } finally {
        setActiveJobLabel(null);
      }
    })();
  }, [activeJobLabel, addLine, dictionary, intervalMs, invalidate, queryClient, scanMutation, selectRoot]);

  const error = useMemo(() => {
    for (const query of [tree, list]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return null;
  }, [list, tree]);

  return {
    isLoading: active && (tree.isLoading || list.isLoading),
    error,
    roots,
    scope,
    setScope,
    selectedRoot,
    selectRoot,
    items: loadedItems,
    total: list.data?.total ?? 0,
    hasMore: loadedItems.length < (list.data?.total ?? 0),
    isLoadingMore: offset > 0 && list.isFetching,
    loadMore,
    selectedFingerprint,
    selectFingerprint: setSelectedFingerprint,
    activeJobLabel,
    isBusy: activeJobLabel !== null,
    scanFolder,
  };
};
