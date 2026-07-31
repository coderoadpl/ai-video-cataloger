import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { TagsListOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

export type TopTag = TagsListOutput['tags'][number];

export const RECENT_SEARCHES_KEY = 'ai-video-cataloger.recent-searches';
const RECENT_SEARCH_LIMIT = 10;

export interface SearchSuggestionsState {
  recentSearches: readonly string[];
  recordSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  topTags: readonly TopTag[];
  onSearchFocus: () => void;
}

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

export const useSearchSuggestions = (): SearchSuggestionsState => {
  const [recentSearches, setRecentSearches] = useState<readonly string[]>(readRecentSearches);
  const [searchFocused, setSearchFocused] = useState(false);

  const tags = useQuery({ ...actions.tagsList, enabled: searchFocused });
  const onSearchFocus = useCallback(() => setSearchFocused(true), []);

  const recordSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setRecentSearches((current) => {
      const next = storeRecentSearch(current, trimmed);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((value: string) => {
    setRecentSearches((current) => {
      const next = current.filter((entry) => entry !== value);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  return {
    recentSearches,
    recordSearch,
    removeRecentSearch,
    topTags: tags.data?.tags ?? [],
    onSearchFocus,
  };
};
