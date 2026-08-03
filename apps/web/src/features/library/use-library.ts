import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { LibraryItem, LibraryMedia } from './core/index.js';
import { toSearchParams, type LibraryFilterState, type LibrarySearchParams } from './core/filter-state.js';
import type { LibrarySort } from './core/folder-groups.js';

const PAGE_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 220;

export interface LibraryState {
  query: string;
  effectiveSort: LibrarySort;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  items: LibraryItem[];
  total: number;
  videoTotal: number;
  photoTotal: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  isError: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const searchParamsKey = (params: LibrarySearchParams): string => JSON.stringify(params);

const dedupeByFingerprint = (items: readonly LibraryItem[]): LibraryItem[] => {
  const seen = new Set<string>();
  const deduped: LibraryItem[] = [];
  for (const item of items) {
    if (seen.has(item.fingerprint)) continue;
    seen.add(item.fingerprint);
    deduped.push(item);
  }
  return deduped;
};

export const useLibrary = (input: {
  active: boolean;
  filters: LibraryFilterState;
  sort: LibrarySort;
  media: LibraryMedia;
}): LibraryState => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [pagination, setPagination] = useState<{ requestKey: string; cursor: string } | null>(null);
  const searchParams = toSearchParams(input.filters);
  const filtersKey = searchParamsKey(searchParams);
  const requestKey = `${filtersKey}|${input.sort}|${input.media}|${debouncedQuery}`;
  const cursor = pagination !== null && pagination.requestKey === requestKey ? pagination.cursor : null;

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  const effectiveSort: LibrarySort = input.sort === 'relevance' && debouncedQuery.length === 0 ? 'captured_desc' : input.sort;

  const page = useQuery({
    ...actions.libraryCollection({
      ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
      tags: searchParams.tags,
      people: searchParams.people,
      ...(searchParams.place === null ? {} : { place: searchParams.place }),
      ...(searchParams.from === null ? {} : { from: searchParams.from }),
      ...(searchParams.to === null ? {} : { to: searchParams.to }),
      ...(searchParams.hasGps === null ? {} : { hasGps: searchParams.hasGps }),
      ...(searchParams.folderId === null ? {} : { folderId: searchParams.folderId }),
      sort: effectiveSort,
      media: input.media,
      limit: PAGE_LIMIT,
      ...(cursor === null ? {} : { cursor }),
    }),
    enabled: input.active,
    placeholderData: keepPreviousData,
  });

  const mergedCursorRef = useRef<string | null>(null);
  useEffect(() => {
    if (page.data === undefined || page.isPlaceholderData) return;
    if (cursor === null) {
      setItems(dedupeByFingerprint(page.data.items));
      mergedCursorRef.current = null;
      return;
    }
    if (mergedCursorRef.current === cursor) return;
    setItems((current) => dedupeByFingerprint([...current, ...page.data.items]));
    mergedCursorRef.current = cursor;
  }, [page.data, page.isPlaceholderData, cursor]);

  const loadMore = useCallback(() => {
    const nextCursor = page.data?.nextCursor ?? null;
    if (nextCursor === null) return;
    setPagination({ requestKey, cursor: nextCursor });
  }, [page.data?.nextCursor, requestKey]);

  return {
    query,
    effectiveSort,
    setQuery,
    debouncedQuery,
    items,
    total: page.data?.total ?? 0,
    videoTotal: page.data?.videoTotal ?? 0,
    photoTotal: page.data?.photoTotal ?? 0,
    isLoading: input.active && cursor === null && page.isLoading,
    isLoadingMore: cursor !== null && page.isFetching,
    isError: page.isError,
    error: page.isError ? messageOf(page.error) : null,
    hasMore: (page.data?.nextCursor ?? null) !== null,
    loadMore,
  };
};
