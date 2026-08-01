import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { LibraryItem } from './core/index.js';
import { toSearchParams, type LibraryFilterState, type LibrarySearchParams } from './core/filter-state.js';
import type { LibrarySort } from './core/folder-groups.js';

const PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 220;

export interface LibraryState {
  query: string;
  effectiveSort: LibrarySort;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  items: LibraryItem[];
  total: number;
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

export const useLibrary = (input: {
  active: boolean;
  filters: LibraryFilterState;
  sort: LibrarySort;
}): LibraryState => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const searchParams = toSearchParams(input.filters);
  const filtersKey = searchParamsKey(searchParams);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQuery, filtersKey, input.sort]);

  const effectiveSort: LibrarySort = input.sort === 'relevance' && debouncedQuery.length === 0 ? 'captured_desc' : input.sort;

  const page = useQuery({
    ...actions.search({
      ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
      tags: searchParams.tags,
      people: searchParams.people,
      ...(searchParams.place === null ? {} : { place: searchParams.place }),
      ...(searchParams.from === null ? {} : { from: searchParams.from }),
      ...(searchParams.to === null ? {} : { to: searchParams.to }),
      ...(searchParams.hasGps === null ? {} : { hasGps: searchParams.hasGps }),
      ...(searchParams.folderId === null ? {} : { folderId: searchParams.folderId }),
      sort: effectiveSort,
      thumbnails: 'existing',
      limit: PAGE_SIZE,
      offset,
    }),
    enabled: input.active,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (page.data === undefined || page.isPlaceholderData) return;
    setItems((current) => (offset === 0 ? page.data.results : [...current, ...page.data.results]));
  }, [page.data, page.isPlaceholderData, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_SIZE), []);

  return {
    query,
    effectiveSort,
    setQuery,
    debouncedQuery,
    items,
    total: page.data?.total ?? 0,
    isLoading: input.active && offset === 0 && page.isLoading,
    isLoadingMore: offset > 0 && page.isFetching,
    isError: page.isError,
    error: page.isError ? messageOf(page.error) : null,
    hasMore: items.length < (page.data?.total ?? 0),
    loadMore,
  };
};
