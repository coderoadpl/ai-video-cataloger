import { useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { FilterBar, type LibraryGroupBy } from './FilterBar.js';
import { groupByCaptureDay, groupByFolder, type LibraryItem } from './core/index.js';
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

export interface LibraryShowInSeed {
  folderId: string;
  folderLabel: string;
  fingerprint: string | null;
}

interface LibraryViewProps {
  active: boolean;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  onGoToVideos: () => void;
  seed?: LibraryShowInSeed | null;
  onSeedConsumed?: () => void;
}

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

export const LibraryView = ({ active, onOpenResult, onGoToVideos, seed = null, onSeedConsumed }: LibraryViewProps) => {
  const dictionary = useDictionary();
  const [filters, dispatch] = useReducer(libraryFilterReducer, EMPTY_LIBRARY_FILTERS);
  const [groupBy, setGroupByState] = useState<LibraryGroupBy>(() => readGroupBy());
  const [sort, setSort] = useState<LibrarySort>('captured_desc');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const setGroupBy = (next: LibraryGroupBy) => {
    setGroupByState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(GROUP_BY_KEY, next);
  };

  useEffect(() => {
    if (seed === null) return;
    dispatch({ type: 'setFolder', folderId: seed.folderId, displayName: seed.folderLabel });
    setScrollTarget(seed.fingerprint);
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

  const openItem = (item: LibraryItem): void => {
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
          onOpen={openItem}
          onOpenInFolder={openItem}
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
        <TextField
          size="small"
          fullWidth
          value={library.query}
          onChange={(event) => library.setQuery(event.target.value)}
          placeholder={dictionary.library.searchPlaceholder}
          data-testid="library-search-input"
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
