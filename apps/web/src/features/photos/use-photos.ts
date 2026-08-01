import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError } from '@core/client/index.js';
import type {
  photosDetailOutputSchema,
  photosTreeOutputSchema,
  photosVariantRecordSchema,
} from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { PhotosSearchResult, PhotosViewMode } from './core/index.js';
import type { PhotoListItem } from './core/index.js';

export type PhotoRoot = z.output<typeof photosTreeOutputSchema>['roots'][number];
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;
export type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

const PAGE_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 300;

interface UsePhotosOptions {
  active: boolean;
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
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePhotos = ({ active }: UsePhotosOptions): PhotosState => {
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);

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
  const detail = useQuery({
    ...actions.photosDetail({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const [viewMode, setViewMode] = useState<PhotosViewMode>({ kind: 'browse' });
  const [searchInputValue, setSearchInputValueState] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(searchInputValue.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInputValue]);

  const search = useQuery({
    ...actions.photosSearch({ query: debouncedQuery.length > 0 ? debouncedQuery : '\0', limit: 50, offset: 0 }),
    enabled: active && viewMode.kind === 'search' && debouncedQuery.length > 0,
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
  };
};

export type { PhotoListItem };
