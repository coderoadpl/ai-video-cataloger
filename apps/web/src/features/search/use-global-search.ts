import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { SearchOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

const SEARCH_DISABLED_QUERY = '\0';

export interface SearchGroup {
  folder: SearchOutput['results'][number]['folder'];
  results: SearchOutput['results'];
}

export interface GlobalSearchState {
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  active: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  groups: SearchGroup[];
  count: number;
}

export const useGlobalSearch = (): GlobalSearchState => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const active = query.trim().length > 0;
  const search = useQuery({
    ...actions.search({ query: debouncedQuery.length > 0 ? debouncedQuery : SEARCH_DISABLED_QUERY, limit: 50, offset: 0 }),
    enabled: debouncedQuery.length > 0,
  });

  const groups = useMemo(() => groupResults(search.data?.results ?? []), [search.data?.results]);

  return {
    query,
    setQuery,
    debouncedQuery,
    active,
    isLoading: active && (debouncedQuery.length === 0 || search.isLoading),
    isError: search.isError,
    error: search.error,
    groups,
    count: search.data?.count ?? 0,
  };
};

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
