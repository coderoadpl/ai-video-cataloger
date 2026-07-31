import { describe, expect, it } from 'vitest';

import { readRecentSearches, RECENT_SEARCHES_KEY, storeRecentSearch, writeRecentSearches } from './use-search-suggestions.js';

describe('recent searches', () => {
  it('stores newest first, dedupes, persists, and caps at 10', () => {
    const stored = Array.from({ length: 12 }, (_, index) => `q-${index}`)
      .reduce<readonly string[]>((current, value) => storeRecentSearch(current, value), []);

    expect(stored).toHaveLength(10);
    expect(stored[0]).toBe('q-11');
    expect(stored.at(-1)).toBe('q-2');

    const deduped = storeRecentSearch(stored, 'q-5');
    expect(deduped[0]).toBe('q-5');
    expect(deduped.filter((entry) => entry === 'q-5')).toHaveLength(1);

    writeRecentSearches(deduped);
    expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toHaveLength(10);
    expect(readRecentSearches()).toEqual(deduped);
  });
});
