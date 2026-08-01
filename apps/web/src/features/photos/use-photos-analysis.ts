import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus, type JobOutput } from '@core/client/index.js';
import type { photosDetailOutputSchema, photosVariantRecordSchema } from '@core/contract/index.js';

import { actions, bridge } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { ownerRootFor, type PhotoListItem, type PhotoRoot } from './core/index.js';

const PAGE_LIMIT = 200;
const SCOPE_KEY = 'avc.photosScope';
const ROOT_KEY = 'avc.photosRoot';

export type PhotosAnalysisScope = 'folder' | 'all';
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;
export type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

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
  counts: { photos: number; paths: number; proxied: number; proxyFailed: number } | null;
  selectedFingerprint: string | null;
  selectFingerprint: (fingerprint: string | null) => void;
  activeJobLabel: string | null;
  isBusy: boolean;
  scanFolder: () => void;
  detail: PhotoDetail | null;
  isDetailLoading: boolean;
  variants: PhotoVariantRecord[];
  selectVariant: (configId: string | null) => void;
  analyzePhotos: () => void;
  canAnalyze: boolean;
  analyzeProgress: { current: number; total: number } | null;
  generateProxies: () => void;
}

export const usePhotosAnalysis = ({ active, addLine, intervalMs = 1000 }: UsePhotosAnalysisOptions): PhotosAnalysisState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const [scope, setScopeState] = useState<PhotosAnalysisScope>(() => readScope());
  const [selectedRoot, setSelectedRootState] = useState<string | null>(() => readRoot());
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadedItems, setLoadedItems] = useState<PhotoListItem[]>([]);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const treeRoots = tree.data?.roots;
  const roots = useMemo(() => treeRoots ?? [], [treeRoots]);

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

  const mergedOffsetRef = useRef(-1);
  useEffect(() => {
    if (list.data === undefined) return;
    if (offset === 0) {
      setLoadedItems(list.data.items);
      mergedOffsetRef.current = 0;
      return;
    }
    if (mergedOffsetRef.current === offset) return;
    setLoadedItems((current) => [...current, ...list.data.items]);
    mergedOffsetRef.current = offset;
  }, [list.data, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_LIMIT), []);

  const status = useQuery({
    ...actions.photosStatus(selectedRoot === null ? {} : { root: selectedRoot }),
    enabled: active && selectedRoot !== null,
  });

  const detail = useQuery({
    ...actions.photosDetail({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const variants = useQuery({
    ...actions.photosVariants({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const scanMutation = useMutation(actions.photosScan);
  const proxiesMutation = useMutation(actions.photosProxies);
  const processMutation = useMutation(actions.photosProcess);
  const selectVariantMutation = useMutation(actions.photosVariantsSelect);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const runJob = useCallback(
    (
      accepted: Promise<{ jobId: string }>,
      label: string,
      success: string,
      failure: string,
      onSnapshot?: (snapshot: JobOutput) => void,
    ) => {
      if (activeJobLabel !== null) return;
      setActiveJobLabel(label);
      addLine(label, 'info');
      void (async () => {
        try {
          const job = await accepted;
          const final = await pollJobUntilTerminal(job.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            onSnapshot: onSnapshot ?? (() => undefined),
          });
          if (final.status === 'completed') {
            addLine(success, 'success');
            await invalidate();
          } else {
            addLine(`${failure}: ${final.error?.message ?? 'unknown error'}`, 'error');
          }
        } catch (error) {
          addLine(`${failure}: ${messageOf(error)}`, 'error');
        } finally {
          setActiveJobLabel(null);
        }
      })();
    },
    [activeJobLabel, addLine, intervalMs, invalidate, queryClient],
  );

  const scanFolder = useCallback(() => {
    if (activeJobLabel !== null) return;
    void (async () => {
      const picked = await bridge.folder.showPicker('photos');
      if (picked === null) return;
      runJob(
        scanMutation.mutateAsync({ root: picked }),
        dictionary.photos.title,
        dictionary.photos.title,
        dictionary.photos.title,
      );
      selectRoot(picked);
    })();
  }, [activeJobLabel, dictionary, runJob, scanMutation, selectRoot]);

  const generateProxies = useCallback(() => {
    if (selectedRoot === null) return;
    runJob(
      proxiesMutation.mutateAsync({ root: selectedRoot, force: false }),
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
    );
  }, [dictionary, proxiesMutation, runJob, selectedRoot]);

  const analyzeTargetRoot = useMemo(() => {
    if (scope === 'folder') return selectedRoot;
    const selectedItem = loadedItems.find((item) => item.fingerprint === selectedFingerprint) ?? null;
    return selectedItem === null ? null : ownerRootFor(selectedItem.currentPath, roots);
  }, [loadedItems, roots, scope, selectedFingerprint, selectedRoot]);

  const analyzePhotos = useCallback(() => {
    if (analyzeTargetRoot === null) return;
    setAnalyzeProgress(null);
    runJob(
      processMutation.mutateAsync({ root: analyzeTargetRoot, force: false }),
      dictionary.photos.analyzeProgress(0, 0),
      dictionary.photos.analyzeAction,
      dictionary.photos.analyzeAction,
      (snapshot) => {
        if (snapshot.progress?.step !== 'photo-analysed') return;
        const current = snapshot.progress.data?.['current'];
        const total = snapshot.progress.data?.['total'];
        if (typeof current === 'number' && typeof total === 'number') setAnalyzeProgress({ current, total });
      },
    );
  }, [analyzeTargetRoot, dictionary, processMutation, runJob]);

  const selectVariant = useCallback((configId: string | null) => {
    if (selectedFingerprint === null) return;
    selectVariantMutation.mutate({ fingerprint: selectedFingerprint, configId });
  }, [selectedFingerprint, selectVariantMutation]);

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
    counts: status.data === undefined
      ? null
      : {
        photos: status.data.counts.photos,
        paths: status.data.counts.paths,
        proxied: status.data.counts.proxied,
        proxyFailed: status.data.counts.proxyFailed,
      },
    selectedFingerprint,
    selectFingerprint: setSelectedFingerprint,
    activeJobLabel,
    isBusy: activeJobLabel !== null,
    scanFolder,
    detail: detail.data ?? null,
    isDetailLoading: detail.isLoading,
    variants: variants.data?.variants ?? [],
    selectVariant,
    analyzePhotos,
    canAnalyze: analyzeTargetRoot !== null,
    analyzeProgress,
    generateProxies,
  };
};
