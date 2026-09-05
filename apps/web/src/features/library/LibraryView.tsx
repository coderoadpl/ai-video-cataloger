import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Autocomplete, Box, Button, CircularProgress, IconButton, InputAdornment, Snackbar, TextField, Typography } from '@mui/material';
import { ApiError, isTerminalJobStatus, invalidateLibraryVisibilityConsumers } from '@core/client/index.js';
import { libraryTrashSummaryOfDetails } from '@core/contract/index.js';
import { z } from 'zod';

import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { formatDayLabel } from '../../lib/format.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { CancelIcon, SearchIcon } from '../../components/ui/icons.js';
import { TrashConfirmationDialog, type TrashConfirmationRoot } from '../../components/ui/dialogs/TrashConfirmationDialog.js';
import { FilterBar, type LibraryGroupBy } from './FilterBar.js';
import { LibraryMediaViewer } from './LibraryMediaViewer.js';
import {
  adjacentFingerprint,
  groupByCaptureDay,
  groupByFolder,
  isLibraryMedia,
  ownerPhotoRootFor,
  type LibraryItem,
  type LibraryMedia,
  type LibraryVideoItem,
} from './core/index.js';

import {
  EMPTY_LIBRARY_FILTERS,
  libraryFilterIsEmpty,
  libraryFilterReducer,
  noHiddenSentence,
  noMatchSentence,
  videoOnlyFilterChips,
  type LibraryFilterChipLabels,
} from './core/filter-state.js';
import {
  emptyLibrarySelection,
  librarySelectionReducer,
  selectedFingerprintCount,
  selectedFingerprints,
  selectionCountLabel,
  selectionResetKey,
  selectionScopeOf,
  type LibrarySelectionScope,
} from './core/selection.js';
import type { LibrarySort } from './core/folder-groups.js';
import { LibraryGrid, type LibraryGridSection } from './LibraryGrid.js';
import { useLibrary } from './use-library.js';
import { useLibraryFacets } from './use-library-facets.js';
import { usePhotoRoots } from './use-photo-roots.js';
import { usePhotoThumbnailsBackfillTrigger } from './use-photo-thumbnails-backfill.js';
import { useSearchSuggestions } from './use-search-suggestions.js';
import { useThumbnailsBackfillTrigger } from './use-thumbnails-backfill.js';

export type LibrarySeed =
  | { kind: 'tag'; tag: string }
  | { kind: 'person'; personId: string; label: string }
  | { kind: 'media'; media: LibraryMedia };

interface LibraryViewProps {
  active: boolean;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  onOpenPhotoInAnalysis?: (root: string, fingerprint: string) => void;
  onGoToVideos: () => void;
  seed?: LibrarySeed | null;
  onSeedConsumed?: () => void;
}

type SearchOption =
  | { kind: 'recent'; label: string }
  | { kind: 'tag'; label: string; count: number };

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const targetRootDetailsSchema = z.object({
  roots: z.array(z.union([
    z.string(),
    z.object({
      displayName: z.string().optional(),
      currentPath: z.string().optional(),
    }).strict(),
  ])),
}).strict();

const rootNamesOf = (error: unknown, code: 'target_read_only' | 'target_offline'): string[] => {
  if (!(error instanceof ApiError) || error.appError.code !== code) return [];
  const parsed = targetRootDetailsSchema.safeParse(error.appError.details);
  if (!parsed.success) return [];
  return parsed.data.roots
    .map((root) => typeof root === 'string' ? root : root.displayName ?? root.currentPath ?? '')
    .filter((name) => name.length > 0);
};

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

const MEDIA_KEY = 'avc.library.media';
const readMedia = (): LibraryMedia => {
  if (typeof window === 'undefined') return 'all';
  const raw = window.localStorage.getItem(MEDIA_KEY);
  return raw !== null && isLibraryMedia(raw) ? raw : 'all';
};

const HIDE_UNAVAILABLE_KEY = 'avc.library.hideUnavailable';
const readHideUnavailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(HIDE_UNAVAILABLE_KEY) === 'true';
};

export const LibraryView = ({
  active,
  onOpenResult,
  onOpenPhotoInAnalysis,
  onGoToVideos,
  seed = null,
  onSeedConsumed,
}: LibraryViewProps) => {
  const dictionary = useDictionary();
  const [filters, dispatch] = useReducer(libraryFilterReducer, EMPTY_LIBRARY_FILTERS);
  const [groupBy, setGroupByState] = useState<LibraryGroupBy>(() => readGroupBy());
  const [media, setMediaState] = useState<LibraryMedia>(() => readMedia());
  const [hideUnavailable, setHideUnavailableState] = useState(() => readHideUnavailable());
  const [hiddenActive, setHiddenActive] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('captured_desc');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const [viewerFingerprint, setViewerFingerprint] = useState<string | null>(null);
  const [selection, dispatchSelection] = useReducer(librarySelectionReducer, undefined, emptyLibrarySelection);
  const [trashScope, setTrashScope] = useState<LibrarySelectionScope | null>(null);
  const [trashChecked, setTrashChecked] = useState(false);
  const [trashReadOnlyRootNames, setTrashReadOnlyRootNames] = useState<string[]>([]);
  const [trashOfflineRootNames, setTrashOfflineRootNames] = useState<string[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [activeTrashJobId, setActiveTrashJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const hideMutation = useMutation(actions.libraryHide);
  const unhideMutation = useMutation(actions.libraryUnhide);
  const trashMutation = useMutation(actions.libraryTrash);
  const suggestions = useSearchSuggestions();

  const setGroupBy = (next: LibraryGroupBy) => {
    setGroupByState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(GROUP_BY_KEY, next);
  };
  const setMedia = (next: LibraryMedia) => {
    setMediaState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(MEDIA_KEY, next);
  };
  const setHideUnavailable = (next: boolean) => {
    setHideUnavailableState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(HIDE_UNAVAILABLE_KEY, String(next));
  };

  useEffect(() => {
    if (seed === null) return;
    if (seed.kind === 'person') {
      dispatch({ type: 'addPerson', personId: seed.personId, displayName: seed.label });
    } else if (seed.kind === 'tag') {
      dispatch({ type: 'addTag', tag: seed.tag });
    } else {
      setMedia(seed.media);
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

  const hidden: 'only' | 'exclude' = hiddenActive ? 'only' : 'exclude';
  const library = useLibrary({ active, filters, sort, media, hideUnavailable, hidden });
  const facetsState = useLibraryFacets({ active });
  const photoRoots = usePhotoRoots({ active });
  const backfillFolders = useMemo(
    () => [...new Set(
      library.items
        .filter((item): item is LibraryVideoItem => item.media === 'video' && item.folder.online)
        .map((item) => item.folder.currentPath),
    )],
    [library.items],
  );
  useThumbnailsBackfillTrigger({ active, folders: backfillFolders });
  usePhotoThumbnailsBackfillTrigger({ active, hasRoots: photoRoots.length > 0 });
  const searchOptions = useMemo<SearchOption[]>(() => [
    ...suggestions.recentSearches.slice(0, 10).map((label) => ({ kind: 'recent' as const, label })),
    ...suggestions.topTags.slice(0, 15).map((tag) => ({ kind: 'tag' as const, label: tag.name, count: tag.count })),
  ], [suggestions.recentSearches, suggestions.topTags]);
  const searchDropdownOpen = searchFocused
    && !searchDismissed
    && library.query.trim().length === 0
    && searchOptions.length > 0;

  const canGroupByFolder = media === 'video' || library.photoTotal === 0;
  const effectiveGroupBy: LibraryGroupBy = canGroupByFolder ? groupBy : 'date';
  const sections: LibraryGridSection[] = useMemo(() => {
    if (effectiveGroupBy === 'folder') {
      const videoItems = library.items.filter((item): item is LibraryVideoItem => item.media === 'video');
      return groupByFolder(videoItems, library.effectiveSort).map((section) => ({
        key: section.folderId,
        label: section.displayName,
        offline: section.offline,
        offlineReason: section.offlineReason,
        items: section.items,
      }));
    }
    return groupByCaptureDay(library.items, toLocalDay).map((section) => ({
      key: section.day ?? 'undated',
      label: section.day === null ? dictionary.library.noRecordingDate : formatDayLabel(section.day, dictionary.locale),
      offline: false,
      offlineReason: null,
      items: section.items,
    }));
  }, [effectiveGroupBy, library.items, library.effectiveSort, dictionary.library.noRecordingDate, dictionary.locale]);

  const viewerOrder = useMemo(
    () => sections.flatMap((section) => section.items.map((item) => item.fingerprint)),
    [sections],
  );
  const viewerItem = viewerFingerprint === null
    ? null
    : library.items.find((item) => item.fingerprint === viewerFingerprint) ?? null;
  const selectionTotal = selectedFingerprintCount(selection, library.total);
  const selectedFingerprintLookup = useMemo(() => {
    if (selection.mode === 'all-in-filter') {
      return new Set(library.items.map((item) => item.fingerprint));
    }
    return new Set(selectedFingerprints(selection));
  }, [library.items, selection]);
  const selected = selectionTotal > 0;
  const scopeInput = useMemo(() => ({
    filters,
    query: library.debouncedQuery,
    media,
    hideUnavailable,
    hidden,
  }), [filters, library.debouncedQuery, media, hideUnavailable, hidden]);
  const currentScope = useMemo(() => selectionScopeOf(selection, scopeInput), [selection, scopeInput]);
  const trashPreview = useQuery({
    ...actions.librarySelectionPreview({ scope: trashScope ?? { kind: 'fingerprints', fingerprints: ['preview-placeholder'] } }),
    enabled: active && trashScope !== null,
  });
  const trashRoots: TrashConfirmationRoot[] = trashPreview.data?.roots ?? [];
  const trashCounts = trashPreview.data === undefined ? null : {
    total: trashPreview.data.total,
    videoCount: trashPreview.data.videoCount,
    photoCount: trashPreview.data.photoCount,
    hiddenCount: trashPreview.data.hiddenCount,
  };
  const resetKey = useMemo(
    () => selectionResetKey({ ...scopeInput, sort }),
    [scopeInput, sort],
  );
  const selectionResetKeyRef = useRef(resetKey);

  const clearSelection = (): void => dispatchSelection({ type: 'clear' });
  const runVisibilityMutation = (scope: LibrarySelectionScope, restore: boolean): void => {
    void (async () => {
      try {
        if (restore) await unhideMutation.mutateAsync({ scope });
        else await hideMutation.mutateAsync({ scope });
        clearSelection();
        setMutationError(null);
      } catch (error) {
        setMutationError(`${restore ? dictionary.library.restoreFailed : dictionary.library.hideFailed}: ${messageOf(error)}`);
      }
    })();
  };
  const openTrashDialog = (scope: LibrarySelectionScope): void => {
    setTrashScope(scope);
    setTrashChecked(false);
    setTrashReadOnlyRootNames([]);
    setTrashOfflineRootNames([]);
    setMutationError(null);
  };
  const confirmTrash = (): void => {
    if (trashScope === null) return;
    void (async () => {
      try {
        const output = await trashMutation.mutateAsync({ scope: trashScope, confirm: true, dryRun: false });
        if (output.kind === 'job') {
          setActiveTrashJobId(output.jobId);
          const final = await pollJobUntilTerminal(output.jobId, {
            intervalMs: 1000,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            onSnapshot: () => undefined,
          });
          if (final.status !== 'completed') {
            throw new ApiError(final.error ?? { code: 'internal', message: dictionary.library.trashFailed });
          }
        }
        clearSelection();
        setTrashScope(null);
        setTrashChecked(false);
        setTrashReadOnlyRootNames([]);
        setTrashOfflineRootNames([]);
        setMutationError(null);
      } catch (error) {
        const readOnlyRootNames = rootNamesOf(error, 'target_read_only');
        const offlineRootNames = rootNamesOf(error, 'target_offline');
        if (readOnlyRootNames.length > 0) setTrashReadOnlyRootNames(readOnlyRootNames);
        if (offlineRootNames.length > 0) setTrashOfflineRootNames(offlineRootNames);
        const summary = error instanceof ApiError ? libraryTrashSummaryOfDetails(error.appError.details) : null;
        setMutationError(summary === null
          ? `${dictionary.library.trashFailed}: ${messageOf(error)}`
          : `${dictionary.library.trashFailed}: ${dictionary.library.trashIncompleteCounts(summary.filesTrashed, summary.filesFailed, summary.filesNotAttempted)}`);
      } finally {
        await invalidateLibraryVisibilityConsumers(queryClient);
        setActiveTrashJobId(null);
      }
    })();
  };

  useEffect(() => {
    if (sort === 'relevance' && media === 'all') setSort('captured_desc');
  }, [sort, media]);

  useEffect(() => {
    if (selectionResetKeyRef.current === resetKey) return;
    selectionResetKeyRef.current = resetKey;
    dispatchSelection({ type: 'clear' });
    setTrashScope(null);
    setTrashChecked(false);
    setTrashReadOnlyRootNames([]);
    setTrashOfflineRootNames([]);
  }, [resetKey]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || trashScope !== null || viewerItem !== null) return;
      if (event.key === 'Escape') dispatchSelection({ type: 'clear' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, trashScope, viewerItem]);

  if (!active) return null;

  const openInAnalysis = (item: LibraryItem): void => {
    if (item.media === 'video') {
      if (!item.folder.online) return;
      onOpenResult(item.folder.currentPath, `${item.folder.currentPath}/${item.fileName}`);
      return;
    }
    if (onOpenPhotoInAnalysis === undefined) return;
    const root = ownerPhotoRootFor(item.currentPath, photoRoots);
    if (root === null) return;
    onOpenPhotoInAnalysis(root, item.fingerprint);
  };

  const isEmptyCatalog = !library.isLoading && library.error === null && library.debouncedQuery.length === 0
    && libraryFilterIsEmpty(filters) && !hideUnavailable && !hiddenActive && library.total === 0;
  const isHiddenEmpty = !library.isLoading && library.error === null && hiddenActive && library.total === 0;
  const isNoMatch = !library.isLoading && library.error === null && library.total === 0 && !isEmptyCatalog && !isHiddenEmpty;
  const videoOnlyFilterActive = filters.place !== null || filters.hasGps !== null;
  const showVideoOnlyFilterNotice = media === 'all' && videoOnlyFilterActive;
  const body = () => {
    if (library.error !== null) {
      return <Alert severity="error" data-testid="library-error" sx={{ m: 2 }}>{formatAnalyzerError(library.error, dictionary.errors)}</Alert>;
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
            {noMatchSentence(filters, chipLabels, (parts) => dictionary.library.noMatchNamed(parts.join(', ')), dictionary.library.noMatchBody)}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => { library.setQuery(''); dispatch({ type: 'clearAll' }); setHideUnavailable(false); }}
            data-testid="library-no-match-clear"
            sx={{ mt: 1 }}
          >
            {dictionary.library.noMatchClearAction}
          </Button>
        </Box>
      );
    }
    if (isHiddenEmpty) {
      return (
        <Box
          data-testid="library-hidden-empty"
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
          <Typography variant="h2" color="text.primary">{dictionary.library.hiddenEmptyTitle}</Typography>
          <Typography variant="body2" sx={{ maxWidth: 420 }} data-testid="library-hidden-empty-body">
            {noHiddenSentence(filters, chipLabels, (parts) => dictionary.library.noMatchNamed(parts.join(', ')), dictionary.library.hiddenEmptyBody)}
          </Typography>
        </Box>
      );
    }
    return (
      <>
        {showVideoOnlyFilterNotice ? (
          <Alert severity="info" data-testid="library-video-only-filter-notice" sx={{ mx: 2, mt: 1 }}>
            {dictionary.library.videoOnlyFilterNotice(videoOnlyFilterChips(filters, chipLabels).map((chip) => chip.label).join(', '))}
          </Alert>
        ) : null}
        <LibraryGrid
          sections={sections}
          onOpen={(item) => setViewerFingerprint(item.fingerprint)}
          onSelect={(item, event) => {
            if (event.shiftKey) {
              dispatchSelection({ type: 'extendTo', fingerprint: item.fingerprint, order: viewerOrder });
              return;
            }
            dispatchSelection({ type: 'toggle', fingerprint: item.fingerprint });
          }}
          onSelectAll={() => dispatchSelection({ type: 'selectAllInFilter' })}
          onOpenInAnalysis={openInAnalysis}
          selectedFingerprints={selectedFingerprintLookup}
          hiddenView={hiddenActive}
          onHideItem={(item) => runVisibilityMutation({ kind: 'fingerprints', fingerprints: [item.fingerprint] }, false)}
          onRestoreItem={(item) => runVisibilityMutation({ kind: 'fingerprints', fingerprints: [item.fingerprint] }, true)}
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
          onClose={() => setSearchDismissed(true)}
          onInputChange={(_, value, reason) => {
            if (reason !== 'input' && reason !== 'clear') return;
            library.setQuery(value);
            setSearchDismissed(false);
          }}
          onChange={(_, value) => {
            if (value === null) return;
            const label = typeof value === 'string' ? value : value.label;
            library.setQuery(label);
            suggestions.recordSearch(label);
          }}
          onFocus={() => {
            setSearchFocused(true);
            setSearchDismissed(false);
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
          sx={{ mb: 2 }}
        />
        <FilterBar
          state={filters}
          dispatch={dispatch}
          facets={facetsState.facets}
          chipLabels={chipLabels}
          groupBy={effectiveGroupBy}
          onGroupByChange={setGroupBy}
          canGroupByFolder={canGroupByFolder}
          sort={library.effectiveSort}
          onSortChange={setSort}
          hasQuery={library.debouncedQuery.length > 0}
          media={media}
          onMediaChange={setMedia}
          mediaTotals={library.mediaTotals}
          hideUnavailable={hideUnavailable}
          onHideUnavailableChange={setHideUnavailable}
          hiddenActive={hiddenActive}
          hiddenCount={facetsState.facets.counts.hidden}
          onHiddenChange={setHiddenActive}
        />
        {selected ? (
          <Box
            data-testid="library-selection-bar"
            sx={{
              mt: 1.25,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="body2" data-testid="library-selection-count" sx={{ fontWeight: 600 }}>
              {selectionCountLabel(selection, library.total, {
                items: dictionary.library.selectionCount,
                allInFilter: dictionary.library.selectionCount,
              })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => dispatchSelection({ type: 'selectAllInFilter' })}
              data-testid="library-select-all"
            >
              {dictionary.library.selectAll}
            </Button>
            <Button size="small" onClick={() => dispatchSelection({ type: 'clear' })} data-testid="library-clear-selection">
              {dictionary.library.clearSelection}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={currentScope === null || hideMutation.isPending || unhideMutation.isPending}
              onClick={() => { if (currentScope !== null) runVisibilityMutation(currentScope, hiddenActive); }}
              data-testid={hiddenActive ? 'library-unhide-selected' : 'library-hide-selected'}
            >
              {hiddenActive ? dictionary.library.restoreSelected : dictionary.library.hideSelected}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={currentScope === null || trashMutation.isPending || activeTrashJobId !== null}
              onClick={() => { if (currentScope !== null) openTrashDialog(currentScope); }}
              data-testid="library-trash-selected"
            >
              {dictionary.library.trashSelected}
            </Button>
          </Box>
        ) : null}
        {activeTrashJobId === null ? null : (
          <Alert severity="info" data-testid="library-trash-active-job" sx={{ mt: 1 }}>
            {dictionary.library.trashStarted}
          </Alert>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{body()}</Box>
      {viewerItem === null ? null : (
        <LibraryMediaViewer
          item={viewerItem}
          onClose={() => setViewerFingerprint(null)}
          onOpenInAnalysis={() => openInAnalysis(viewerItem)}
          onPrevious={
            adjacentFingerprint(viewerOrder, viewerItem.fingerprint, -1) === null
              ? null
              : () => setViewerFingerprint(adjacentFingerprint(viewerOrder, viewerItem.fingerprint, -1))
          }
          onNext={
            adjacentFingerprint(viewerOrder, viewerItem.fingerprint, 1) === null
              ? null
              : () => setViewerFingerprint(adjacentFingerprint(viewerOrder, viewerItem.fingerprint, 1))
          }
        />
      )}
      <TrashConfirmationDialog
        open={trashScope !== null}
        counts={trashCounts}
        roots={trashRoots}
        loading={trashPreview.isLoading || trashPreview.isFetching}
        error={trashPreview.isError ? messageOf(trashPreview.error) : null}
        checked={trashChecked}
        confirming={trashMutation.isPending}
        readOnlyRootNames={trashReadOnlyRootNames}
        offlineRootNames={trashOfflineRootNames}
        onCheckedChange={setTrashChecked}
        onClose={() => {
          setTrashScope(null);
          setTrashChecked(false);
          setTrashReadOnlyRootNames([]);
          setTrashOfflineRootNames([]);
        }}
        onConfirm={confirmTrash}
      />
      <Snackbar
        open={mutationError !== null}
        onClose={() => setMutationError(null)}
        autoHideDuration={8000}
      >
        <Alert severity="error" onClose={() => setMutationError(null)} data-testid="library-mutation-error">
          {mutationError}
        </Alert>
      </Snackbar>
    </Box>
  );
};
