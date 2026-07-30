import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus, type JobOutput } from '@core/client/index.js';
import type {
  photosDetailOutputSchema,
  photosTreeOutputSchema,
  photosVariantRecordSchema,
} from '@core/contract/index.js';

import { actions, bridge } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import type { PhotosSearchResult, PhotosViewMode } from './core/index.js';
import type { PhotoListItem } from './core/index.js';

export type PhotoRoot = z.output<typeof photosTreeOutputSchema>['roots'][number];
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;
export type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

const PAGE_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 300;

interface UsePhotosOptions {
  active: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

export interface PhotosState {
  isLoading: boolean;
  error: string | null;
  roots: PhotoRoot[];
  selectedRoot: string | null;
  selectRoot: (root: string | null) => void;
  items: PhotoListItem[];
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  counts: { photos: number; paths: number; proxied: number; proxyFailed: number } | null;
  activeJobLabel: string | null;
  isBusy: boolean;
  scanFolder: () => void;
  generateProxies: () => void;
  selectedFingerprint: string | null;
  selectFingerprint: (fingerprint: string | null) => void;
  detail: PhotoDetail | null;
  isDetailLoading: boolean;
  viewMode: PhotosViewMode;
  searchInputValue: string;
  setSearchInputValue: (value: string) => void;
  searchTag: (tag: string) => void;
  clearSearch: () => void;
  searchResults: PhotosSearchResult[];
  searchCount: number;
  isSearchLoading: boolean;
  variants: PhotoVariantRecord[];
  selectVariant: (configId: string | null) => void;
  analyzePhotos: () => void;
  analyzeProgress: { current: number; total: number } | null;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePhotos = ({ active, addLine, intervalMs = 1000 }: UsePhotosOptions): PhotosState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const status = useQuery({ ...actions.photosStatus(selectedRoot === null ? {} : { root: selectedRoot }), enabled: active });
  const [offset, setOffset] = useState(0);
  const [loadedItems, setLoadedItems] = useState<PhotoListItem[]>([]);
  const list = useQuery({
    ...actions.photosList({ ...(selectedRoot === null ? {} : { root: selectedRoot }), offset, limit: PAGE_LIMIT }),
    enabled: active,
  });

  useEffect(() => {
    setOffset(0);
  }, [selectedRoot]);

  useEffect(() => {
    if (list.data === undefined) return;
    setLoadedItems((current) => (offset === 0 ? list.data.items : [...current, ...list.data.items]));
  }, [list.data, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_LIMIT), []);
  const detail = useQuery({
    ...actions.photosDetail({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const scanMutation = useMutation(actions.photosScan);
  const proxiesMutation = useMutation(actions.photosProxies);
  const processMutation = useMutation(actions.photosProcess);
  const selectVariantMutation = useMutation(actions.photosVariantsSelect);

  const [viewMode, setViewMode] = useState<PhotosViewMode>({ kind: 'browse' });
  const [searchInputValue, setSearchInputValueState] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(searchInputValue.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInputValue]);

  const search = useQuery({
    ...actions.photosSearch({ query: debouncedQuery.length > 0 ? debouncedQuery : '\0', limit: 50, offset: 0 }),
    enabled: active && viewMode.kind === 'search' && debouncedQuery.length > 0,
  });

  const variants = useQuery({
    ...actions.photosVariants({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const setSearchInputValue = useCallback((value: string) => {
    setSearchInputValueState(value);
    setViewMode(value.trim().length === 0 ? { kind: 'browse' } : { kind: 'search', query: value.trim() });
  }, []);

  const searchTag = useCallback((tag: string) => {
    setSearchInputValueState(tag);
    setDebouncedQuery(tag);
    setViewMode({ kind: 'search', query: tag });
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInputValueState('');
    setDebouncedQuery('');
    setViewMode({ kind: 'browse' });
  }, []);

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
    void (async () => {
      const picked = await bridge.folder.showPicker('photos');
      if (picked === null) return;
      runJob(
        scanMutation.mutateAsync({ root: picked }),
        dictionary.photos.scanProgress(0, 0),
        dictionary.photos.title,
        dictionary.photos.title,
      );
      setSelectedRoot(picked);
    })();
  }, [dictionary, runJob, scanMutation]);

  const generateProxies = useCallback(() => {
    if (selectedRoot === null) return;
    runJob(
      proxiesMutation.mutateAsync({ root: selectedRoot, force: false }),
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
    );
  }, [dictionary, proxiesMutation, runJob, selectedRoot]);

  const analyzePhotos = useCallback(() => {
    const detailOwnerPath = detail.data?.ownerPath;
    const target = selectedRoot ?? (detailOwnerPath === undefined ? null : detailOwnerPath.split('/').slice(0, -1).join('/'));
    if (target === null || target.length === 0) return;
    setAnalyzeProgress(null);
    runJob(
      processMutation.mutateAsync({ root: target, force: false }),
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
  }, [detail.data?.ownerPath, dictionary, processMutation, runJob, selectedRoot]);

  const selectVariant = useCallback((configId: string | null) => {
    if (selectedFingerprint === null) return;
    selectVariantMutation.mutate({ fingerprint: selectedFingerprint, configId });
  }, [selectedFingerprint, selectVariantMutation]);

  const error = useMemo(() => {
    for (const query of [tree, status, list]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return null;
  }, [list, status, tree]);

  return {
    isLoading: active && (tree.isLoading || status.isLoading || list.isLoading),
    error,
    roots: tree.data?.roots ?? [],
    selectedRoot,
    selectRoot: setSelectedRoot,
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
    activeJobLabel,
    isBusy: activeJobLabel !== null,
    scanFolder,
    generateProxies,
    selectedFingerprint,
    selectFingerprint: setSelectedFingerprint,
    detail: detail.data ?? null,
    isDetailLoading: detail.isLoading,
    viewMode,
    searchInputValue,
    setSearchInputValue,
    searchTag,
    clearSearch,
    searchResults: search.data?.results ?? [],
    searchCount: search.data?.count ?? 0,
    isSearchLoading: viewMode.kind === 'search' && (debouncedQuery.length === 0 || search.isLoading),
    variants: variants.data?.variants ?? [],
    selectVariant,
    analyzePhotos,
    analyzeProgress,
  };
};

export type { PhotoListItem };
