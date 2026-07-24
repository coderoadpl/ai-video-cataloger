import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { SearchOutput, TagsListOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

export type TopTag = TagsListOutput['tags'][number];

const SEARCH_DISABLED_QUERY = '\0';
export const RECENT_SEARCHES_KEY = 'ai-video-cataloger.recent-searches';
const RECENT_SEARCH_LIMIT = 10;

export interface SearchGroup {
  folder: SearchOutput['results'][number]['folder'];
  results: SearchOutput['results'];
}

export interface GlobalSearchState {
  query: string;
  setQuery: (query: string) => void;
  submitSearch: (query: string) => void;
  clearSearch: () => void;
  debouncedQuery: string;
  active: boolean;
  recentSearches: readonly string[];
  removeRecentSearch: (query: string) => void;
  topTags: readonly TopTag[];
  onSearchFocus: () => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  groups: SearchGroup[];
  count: number;
}

export const useGlobalSearch = (): GlobalSearchState => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<readonly string[]>(readRecentSearches);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const active = query.trim().length > 0;
  const search = useQuery({
    ...actions.search({ query: debouncedQuery.length > 0 ? debouncedQuery : SEARCH_DISABLED_QUERY, limit: 50, offset: 0 }),
    enabled: debouncedQuery.length > 0,
  });

  const tags = useQuery({ ...actions.tagsList, enabled: searchFocused });
  const onSearchFocus = useCallback(() => setSearchFocused(true), []);

  const groups = useMemo(() => groupResults(search.data?.results ?? []), [search.data?.results]);
  const submitSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    setQuery(trimmed);
    setDebouncedQuery(trimmed);
    if (trimmed.length === 0) return;
    setRecentSearches((current) => {
      const next = storeRecentSearch(current, trimmed);
      writeRecentSearches(next);
      return next;
    });
  }, []);
  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
  }, []);
  const removeRecentSearch = useCallback((value: string) => {
    setRecentSearches((current) => {
      const next = current.filter((entry) => entry !== value);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  return {
    query,
    setQuery,
    submitSearch,
    clearSearch,
    debouncedQuery,
    active,
    recentSearches,
    removeRecentSearch,
    topTags: tags.data?.tags ?? [],
    onSearchFocus,
    isLoading: active && (debouncedQuery.length === 0 || search.isLoading),
    isError: search.isError,
    error: search.error,
    groups,
    count: search.data?.count ?? 0,
  };
};

export const readRecentSearches = (): readonly string[] => {
  if (typeof window === 'undefined') return [];
  if (typeof window.localStorage.getItem !== 'function') return [];
  const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
};

export const writeRecentSearches = (values: readonly string[]): void => {
  if (typeof window === 'undefined') return;
  if (typeof window.localStorage.setItem !== 'function') return;
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(values.slice(0, RECENT_SEARCH_LIMIT)));
};

export const storeRecentSearch = (current: readonly string[], value: string): readonly string[] => [
  value,
  ...current.filter((entry) => entry !== value),
].slice(0, RECENT_SEARCH_LIMIT);

const groupResults = (results: SearchOutput['results']): SearchGroup[] => {
  const groups = new Map<string, SearchGroup>();
  for (const result of results) {
    const existing = groups.get(result.folder.folderId);
    if (existing !== undefined) {
      existing.results.push(result);
      continue;
    }
    groups.set(result.folder.folderId, { folder: result.folder, results: [result] });
  }
  return [...groups.values()];
};
