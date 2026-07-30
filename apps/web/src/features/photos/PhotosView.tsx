import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Select, Typography } from '@mui/material';

import { PhotosLayout } from '../../components/layout/PhotosLayout.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { groupByCaptureDay, flattenOrder, adjacentFingerprint } from './core/index.js';
import { PhotoDetailPane } from './PhotoDetailPane.js';
import { PhotoGrid } from './PhotoGrid.js';
import { PhotoViewer } from './PhotoViewer.js';
import { usePhotos } from './use-photos.js';

interface PhotosViewProps {
  active: boolean;
  addLine: AddLogLine;
}

const toLocalDay = (isoUtc: string): string => {
  const date = new Date(isoUtc);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const PhotosView = ({ active, addLine }: PhotosViewProps) => {
  const dictionary = useDictionary();
  const photos = usePhotos({ active, addLine });
  const [viewerOpen, setViewerOpen] = useState(false);

  const sections = useMemo(() => groupByCaptureDay(photos.items, toLocalDay), [photos.items]);
  const order = useMemo(() => flattenOrder(sections), [sections]);
  const selectedItem = photos.items.find((item) => item.fingerprint === photos.selectedFingerprint) ?? null;

  const openViewer = useCallback(
    (fingerprint: string) => {
      photos.selectFingerprint(fingerprint);
      setViewerOpen(true);
    },
    [photos],
  );

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
      <Button
        variant="outlined"
        size="small"
        onClick={photos.scanFolder}
        disabled={photos.isBusy}
        data-testid="photos-scan-action"
      >
        {dictionary.photos.scanFolderAction}
      </Button>
    </Box>
  );

  const notice = photos.error === null ? undefined : <Alert severity="error">{photos.error}</Alert>;

  const proxiesPending = photos.selectedRoot !== null && counts !== null && counts.proxied === 0 && counts.photos > 0;

  const grid = photos.isLoading ? (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} data-testid="photos-loading">
      <CircularProgress size={24} />
      <Typography sx={{ ml: 1 }}>{dictionary.photos.loadingPhotos}</Typography>
    </Box>
  ) : photos.roots.length === 0 ? (
    <EmptyState
      title={dictionary.photos.emptyNoRootsTitle}
      body={dictionary.photos.emptyNoRootsBody}
      action={
        <Button variant="contained" onClick={photos.scanFolder} disabled={photos.isBusy} data-testid="photos-empty-scan">
          {dictionary.photos.scanFolderAction}
        </Button>
      }
      testId="photos-empty-no-roots"
    />
  ) : photos.items.length === 0 ? (
    <EmptyState title={dictionary.photos.emptyNoPhotos} body="" action={null} testId="photos-empty-no-photos" />
  ) : (
    <>
      {proxiesPending ? (
        <Alert
          severity="info"
          data-testid="photos-proxies-pending"
          action={
            <Button color="inherit" size="small" onClick={photos.generateProxies} disabled={photos.isBusy}>
              {dictionary.photos.generateProxiesAction}
            </Button>
          }
        >
          {dictionary.photos.proxiesPendingStrip}
        </Alert>
      ) : null}
      <PhotoGrid
        sections={sections}
        selectedFingerprint={photos.selectedFingerprint}
        onSelect={photos.selectFingerprint}
        onOpenViewer={openViewer}
      />
    </>
  );

  const detail = <PhotoDetailPane detail={photos.detail} isLoading={photos.isDetailLoading} />;

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
