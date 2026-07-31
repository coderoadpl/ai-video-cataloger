import { useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { CancelIcon, SearchIcon } from '../../components/ui/icons.js';
import { FilterBar, type LibraryGroupBy } from './FilterBar.js';
import { groupByCaptureDay, groupByFolder, type LibraryItem } from './core/index.js';

export type { LibraryItem } from './core/index.js';
import {
  EMPTY_LIBRARY_FILTERS,
  libraryFilterIsEmpty,
  libraryFilterReducer,
  noMatchSentence,
  type LibraryFilterChipLabels,
} from './core/filter-state.js';
import type { LibrarySort } from './core/folder-groups.js';
import { LibraryGrid, type LibraryGridSection } from './LibraryGrid.js';
import { useLibrary } from './use-library.js';
import { useLibraryFacets } from './use-library-facets.js';
import { useSearchSuggestions } from './use-search-suggestions.js';

export type LibrarySeed =
  | { kind: 'folder'; folderId: string; folderLabel: string; fingerprint: string | null }
  | { kind: 'tag'; tag: string };

interface LibraryViewProps {
  active: boolean;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  onPreview: (item: LibraryItem) => void;
  onGoToVideos: () => void;
  seed?: LibrarySeed | null;
  onSeedConsumed?: () => void;
}

type SearchOption =
  | { kind: 'recent'; label: string }
  | { kind: 'tag'; label: string; count: number };

const toLocalDay = (isoUtc: string): string => {
  const date = new Date(isoUtc);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const GROUP_BY_KEY = 'avc.library.groupBy';
const readGroupBy = (): LibraryGroupBy => {
  if (typeof window === 'undefined') return 'date';
  const raw = window.localStorage.getItem(GROUP_BY_KEY);
  return raw === 'folder' ? 'folder' : 'date';
};

export const LibraryView = ({ active, onOpenResult, onPreview, onGoToVideos, seed = null, onSeedConsumed }: LibraryViewProps) => {
  const dictionary = useDictionary();
  const [filters, dispatch] = useReducer(libraryFilterReducer, EMPTY_LIBRARY_FILTERS);
  const [groupBy, setGroupByState] = useState<LibraryGroupBy>(() => readGroupBy());
  const [sort, setSort] = useState<LibrarySort>('captured_desc');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const suggestions = useSearchSuggestions();

  const setGroupBy = (next: LibraryGroupBy) => {
    setGroupByState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(GROUP_BY_KEY, next);
  };

  useEffect(() => {
    if (seed === null) return;
    if (seed.kind === 'folder') {
      dispatch({ type: 'setFolder', folderId: seed.folderId, displayName: seed.folderLabel });
      setScrollTarget(seed.fingerprint);
    } else {
      dispatch({ type: 'addTag', tag: seed.tag });
    }
    onSeedConsumed?.();
  }, [seed, onSeedConsumed]);

  const chipLabels: LibraryFilterChipLabels = useMemo(() => ({
    hasGps: dictionary.library.chipHasGps,
    noGps: dictionary.library.chipNoGps,
    folder: dictionary.library.chipFolder,
    dateRange: dictionary.library.chipDateRange,
    dateFrom: dictionary.library.chipDateFrom,
    dateTo: dictionary.library.chipDateTo,
  }), [dictionary]);

  const library = useLibrary({ active, filters, sort });
  const facetsState = useLibraryFacets({ active });
  const searchOptions = useMemo<SearchOption[]>(() => [
    ...suggestions.recentSearches.slice(0, 10).map((label) => ({ kind: 'recent' as const, label })),
    ...suggestions.topTags.slice(0, 15).map((tag) => ({ kind: 'tag' as const, label: tag.name, count: tag.count })),
  ], [suggestions.recentSearches, suggestions.topTags]);
  const searchDropdownOpen = searchFocused && library.query.trim().length === 0 && searchOptions.length > 0;

  const sections: LibraryGridSection[] = useMemo(() => {
    if (groupBy === 'folder') {
      return groupByFolder(library.items, library.effectiveSort).map((section) => ({
        key: section.folderId,
        label: section.displayName,
        offline: section.offline,
        items: section.items,
      }));
    }
    return groupByCaptureDay(library.items, toLocalDay).map((section) => ({
      key: section.day ?? 'undated',
      label: section.day ?? dictionary.library.unknownDate,
      offline: false,
      items: section.items,
    }));
  }, [groupBy, library.items, library.effectiveSort, dictionary.library.unknownDate]);

  if (!active) return null;

  const previewItem = (item: LibraryItem): void => {
    if (!item.folder.online) return;
    onPreview(item);
  };

  const openInAnalysis = (item: LibraryItem): void => {
    if (!item.folder.online) return;
    onOpenResult(item.folder.currentPath, `${item.folder.currentPath}/${item.fileName}`);
  };

  const isEmptyCatalog = !library.isLoading && library.error === null && library.debouncedQuery.length === 0
    && libraryFilterIsEmpty(filters) && library.total === 0;
  const isNoMatch = !library.isLoading && library.error === null && library.total === 0 && !isEmptyCatalog;

  const body = () => {
    if (library.error !== null) {
      return <Alert severity="error" data-testid="library-error" sx={{ m: 2 }}>{library.error}</Alert>;
    }
    if (library.isLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} data-testid="library-loading">
          <CircularProgress size={24} />
          <Typography sx={{ ml: 1 }}>{dictionary.library.loadingLibrary}</Typography>
        </Box>
      );
    }
    if (isEmptyCatalog) {
      return (
        <Box
          data-testid="library-empty-catalog"
          sx={{
            flex: 1,
            minHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
        >
          <Typography variant="h2" color="text.primary">{dictionary.library.emptyCatalogTitle}</Typography>
          <Typography variant="body2" sx={{ maxWidth: 420 }}>{dictionary.library.emptyCatalogBody}</Typography>
          <Button variant="contained" onClick={onGoToVideos} data-testid="library-empty-go-videos" sx={{ mt: 1 }}>
            {dictionary.library.emptyCatalogAction}
          </Button>
        </Box>
      );
    }
    if (isNoMatch) {
      return (
        <Box
          data-testid="library-no-match"
          sx={{
            flex: 1,
            minHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
        >
          <Typography variant="h2" color="text.primary">{dictionary.library.noMatchTitle(library.debouncedQuery)}</Typography>
          <Typography variant="body2" sx={{ maxWidth: 420 }} data-testid="library-no-match-body">
            {noMatchSentence(filters, library.debouncedQuery, chipLabels, (parts) => dictionary.library.noMatchNamed(parts.join(', ')), dictionary.library.noMatchBody)}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => { library.setQuery(''); dispatch({ type: 'clearAll' }); }}
            data-testid="library-no-match-clear"
            sx={{ mt: 1 }}
          >
            {dictionary.library.noMatchClearAction}
          </Button>
        </Box>
      );
    }
    return (
      <>
        <LibraryGrid
          sections={sections}
          onOpen={previewItem}
          onOpenInAnalysis={openInAnalysis}
          scrollToFingerprint={scrollTarget}
          onScrolledToFingerprint={() => setScrollTarget(null)}
        />
        {library.hasMore ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={library.loadMore}
              disabled={library.isLoadingMore}
              data-testid="library-load-more"
            >
              {library.isLoadingMore ? <CircularProgress size={16} /> : dictionary.library.loadMore}
            </Button>
          </Box>
        ) : null}
      </>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h1">{dictionary.library.title}</Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
          {library.isLoading ? dictionary.library.subtitle : dictionary.library.countHeader(library.items.length, library.total)}
        </Typography>
        <Autocomplete
          freeSolo
          clearOnBlur={false}
          value={null}
          inputValue={library.query}
          open={searchDropdownOpen}
          options={searchOptions}
          groupBy={(option) => option.kind === 'recent' ? dictionary.library.recentSearches : dictionary.library.topTags}
          getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') library.setQuery(value);
          }}
          onChange={(_, value) => {
            if (value === null) return;
            const label = typeof value === 'string' ? value : value.label;
            library.setQuery(label);
            suggestions.recordSearch(label);
          }}
          onFocus={() => {
            setSearchFocused(true);
            suggestions.onSearchFocus();
          }}
          onBlur={() => setSearchFocused(false)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return (
              <Box key={key} component="li" {...optionProps}>
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  {option.label}
                </Box>
                {option.kind === 'tag' ? (
                  <Typography variant="caption">{option.count}</Typography>
                ) : (
                  <IconButton
                    aria-label={dictionary.library.removeRecentSearch(option.label)}
                    size="small"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      suggestions.removeRecentSearch(option.label);
                    }}
                  >
                    <CancelIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              fullWidth
              placeholder={dictionary.library.searchPlaceholder}
              data-testid="library-search-input"
              onKeyDown={(event) => {
                if (event.key === 'Enter') suggestions.recordSearch(library.query);
              }}
              slotProps={{
                ...params.slotProps,
                input: {
                  ...params.slotProps.input,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                      {params.slotProps.input.startAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
          sx={{ mb: 1 }}
        />
        <FilterBar
          state={filters}
          dispatch={dispatch}
          facets={facetsState.facets}
          chipLabels={chipLabels}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          sort={library.effectiveSort}
          onSortChange={setSort}
          hasQuery={library.debouncedQuery.length > 0}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{body()}</Box>
    </Box>
  );
};
