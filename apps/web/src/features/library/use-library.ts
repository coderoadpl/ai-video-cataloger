import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { LibraryItem } from './core/index.js';

const PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 220;

export interface LibraryState {
  query: string;
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

export const useLibrary = (input: { active: boolean }): LibraryState => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQuery]);

  const page = useQuery({
    ...actions.search({
      ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
      sort: 'captured_desc',
      thumbnails: 'existing',
      limit: PAGE_SIZE,
      offset,
    }),
    enabled: input.active,
  });

  useEffect(() => {
    if (page.data === undefined) return;
    setItems((current) => (offset === 0 ? page.data.results : [...current, ...page.data.results]));
  }, [page.data, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_SIZE), []);

  return {
    query,
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
