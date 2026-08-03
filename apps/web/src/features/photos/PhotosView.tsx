import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, MenuItem, Select, TextField, Typography } from '@mui/material';

import { CancelIcon } from '../../components/ui/icons.js';
import { PhotosLayout } from '../../components/layout/PhotosLayout.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { adjacentFingerprint, flattenOrder, focusTarget, groupByCaptureDay, ownerRootFor, searchResultsToItems, searchSections } from './core/index.js';
import { PhotoDetailPane } from './PhotoDetailPane.js';
import { PhotoGrid } from './PhotoGrid.js';
import { PhotoViewer } from './PhotoViewer.js';
import { usePhotoThumbnailsBackfillTrigger } from './use-photo-thumbnails-backfill.js';
import { usePhotos } from './use-photos.js';

interface PhotosViewProps {
  active: boolean;
  focusFingerprint?: string | null;
  onFocusConsumed?: () => void;
  rootSeed?: string | null;
  onRootSeedConsumed?: () => void;
  onOpenInAnalysis?: (root: string, fingerprint: string) => void;
}

const noop = (): void => {};

const toLocalDay = (isoUtc: string): string => {
  const date = new Date(isoUtc);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const PhotosView = ({
  active,
  focusFingerprint = null,
  onFocusConsumed = noop,
  rootSeed = null,
  onRootSeedConsumed = noop,
  onOpenInAnalysis,
}: PhotosViewProps) => {
  const dictionary = useDictionary();
  const photos = usePhotos({ active });
  const [viewerOpen, setViewerOpen] = useState(false);

  const browseSections = useMemo(() => groupByCaptureDay(photos.items, toLocalDay), [photos.items]);
  const searchItems = useMemo(() => searchResultsToItems(photos.searchResults), [photos.searchResults]);
  const searchResultSections = useMemo(
    () => searchSections(searchItems, dictionary.photos.searchResultsLabel(photos.searchCount)),
    [dictionary, photos.searchCount, searchItems],
  );
  const sections = photos.viewMode.kind === 'search' ? searchResultSections : browseSections;
  const currentItems = photos.viewMode.kind === 'search' ? searchItems : photos.items;
  const order = useMemo(() => flattenOrder(sections), [sections]);
  const selectedItem = currentItems.find((item) => item.fingerprint === photos.selectedFingerprint) ?? null;

  const openViewer = useCallback(
    (fingerprint: string) => {
      photos.selectFingerprint(fingerprint);
      setViewerOpen(true);
    },
    [photos],
  );

  const { selectFingerprint, selectRoot } = photos;
  useEffect(() => {
    if (focusFingerprint === null || order.length === 0) return;
    const target = focusTarget(order, focusFingerprint);
    selectFingerprint(target.select);
    if (target.openViewer) setViewerOpen(true);
    onFocusConsumed();
  }, [focusFingerprint, order, selectFingerprint, onFocusConsumed]);

  useEffect(() => {
    if (rootSeed === null) return;
    selectRoot(rootSeed);
    onRootSeedConsumed();
  }, [rootSeed, selectRoot, onRootSeedConsumed]);

  usePhotoThumbnailsBackfillTrigger({ active, hasRoots: photos.roots.length > 0 });

  if (!active) return null;

  const counts = photos.counts;
  const heading = (
    <Box>
      <Typography variant="h1">{dictionary.photos.title}</Typography>
      <Typography variant="caption">{dictionary.photos.subtitle}</Typography>
      {counts === null ? null : (
        <Typography variant="caption" sx={{ display: 'block' }} data-testid="photos-status-strip">
          {[
            dictionary.photos.statusPhotos(counts.photos),
            dictionary.photos.statusPaths(counts.paths),
            dictionary.photos.statusProxied(counts.proxied),
            dictionary.photos.statusProxyFailed(counts.proxyFailed),
          ].join(' · ')}
        </Typography>
      )}
    </Box>
  );

  const toolbar = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Select
        size="small"
        value={photos.selectedRoot ?? ''}
        displayEmpty
        onChange={(event) => photos.selectRoot(event.target.value === '' ? null : event.target.value)}
        aria-label={dictionary.photos.rootPickerLabel}
        data-testid="photos-root-picker"
      >
        <MenuItem value="">{dictionary.photos.rootPickerAll}</MenuItem>
        {photos.roots.map((root) => (
          <MenuItem key={root.root} value={root.root}>{root.root}</MenuItem>
        ))}
      </Select>
      <TextField
        size="small"
        value={photos.searchInputValue}
        placeholder={dictionary.photos.searchPlaceholder}
        onChange={(event) => photos.setSearchInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') photos.clearSearch();
        }}
        slotProps={{
          htmlInput: { 'data-testid': 'photos-search-input' },
          input: {
            endAdornment: photos.searchInputValue.length === 0 ? undefined : (
              <IconButton
                aria-label={dictionary.photos.searchClear}
                size="small"
                data-testid="photos-search-clear"
                onClick={photos.clearSearch}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            ),
          },
        }}
      />
    </Box>
  );

  const notice = photos.error === null ? undefined : <Alert severity="error">{photos.error}</Alert>;

  const grid = photos.viewMode.kind === 'search' ? (
    photos.isSearchLoading ? (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} data-testid="photos-loading">
        <CircularProgress size={24} />
        <Typography sx={{ ml: 1 }}>{dictionary.photos.loadingPhotos}</Typography>
      </Box>
    ) : photos.searchResults.length === 0 ? (
      <EmptyState title={dictionary.photos.searchNoResults} body="" action={null} testId="photos-search-empty" />
    ) : (
      <PhotoGrid
        sections={sections}
        selectedFingerprint={photos.selectedFingerprint}
        onSelect={photos.selectFingerprint}
        onOpenViewer={openViewer}
      />
    )
  ) : photos.isLoading ? (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} data-testid="photos-loading">
      <CircularProgress size={24} />
      <Typography sx={{ ml: 1 }}>{dictionary.photos.loadingPhotos}</Typography>
    </Box>
  ) : photos.roots.length === 0 ? (
    <EmptyState
      title={dictionary.photos.emptyNoRootsTitle}
      body={dictionary.photos.emptyNoRootsBodyBrowse}
      action={null}
      testId="photos-empty-no-roots"
    />
  ) : photos.items.length === 0 ? (
    <EmptyState title={dictionary.photos.emptyNoPhotos} body="" action={null} testId="photos-empty-no-photos" />
  ) : (
    <>
      <PhotoGrid
        sections={sections}
        selectedFingerprint={photos.selectedFingerprint}
        onSelect={photos.selectFingerprint}
        onOpenViewer={openViewer}
      />
      {photos.hasMore ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={photos.loadMore}
            disabled={photos.isLoadingMore}
            data-testid="photos-load-more"
          >
            {photos.isLoadingMore ? <CircularProgress size={16} /> : dictionary.photos.loadMore}
          </Button>
        </Box>
      ) : null}
    </>
  );

  const detail = (
    <PhotoDetailPane
      showAnalysisTools={false}
      detail={photos.detail}
      isLoading={photos.isDetailLoading}
      variants={[]}
      onSelectVariant={() => undefined}
      onSearchTag={photos.searchTag}
      onAnalyze={() => undefined}
      isBusy={false}
      canAnalyze={false}
      analyzeProgress={null}
      onOpenInAnalysis={
        onOpenInAnalysis === undefined || photos.detail === null
          ? undefined
          : () => {
              const detail = photos.detail;
              if (detail === null) return;
              const root = ownerRootFor(detail.ownerPath, photos.roots);
              if (root === null) return;
              onOpenInAnalysis(root, detail.photo.fingerprint);
            }
      }
    />
  );

  return (
    <>
      <PhotosLayout heading={heading} toolbar={toolbar} notice={notice} grid={grid} detail={detail} />
      {viewerOpen && selectedItem !== null ? (
        <PhotoViewer
          item={selectedItem}
          proxyPath={selectedItem.proxyPath}
          onClose={() => setViewerOpen(false)}
          onPrevious={
            adjacentFingerprint(order, selectedItem.fingerprint, -1) === null
              ? null
              : () => {
                const previous = adjacentFingerprint(order, selectedItem.fingerprint, -1);
                if (previous !== null) photos.selectFingerprint(previous);
              }
          }
          onNext={
            adjacentFingerprint(order, selectedItem.fingerprint, 1) === null
              ? null
              : () => {
                const next = adjacentFingerprint(order, selectedItem.fingerprint, 1);
                if (next !== null) photos.selectFingerprint(next);
              }
          }
        />
      ) : null}
    </>
  );
};

interface EmptyStateProps {
  title: string;
  body: string;
  action: ReactNode;
  testId: string;
}

const EmptyState = ({ title, body, action, testId }: EmptyStateProps) => (
  <Box
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
    data-testid={testId}
  >
    <Typography variant="h2" color="text.primary">{title}</Typography>
    {body === '' ? null : <Typography variant="body2" sx={{ maxWidth: 420 }}>{body}</Typography>}
    {action === null ? null : <Box sx={{ mt: 1 }}>{action}</Box>}
  </Box>
);
