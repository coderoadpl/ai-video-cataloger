import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Dialog, DialogTitle, IconButton, Typography } from '@mui/material';

import type { CollectionInput } from '@core/client/index.js';

import { actions } from '../../api.js';
import { CancelIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { labelWithCount } from '../../lib/format.js';
import { adjacentFingerprint, ownerPhotoRootFor, type LibraryItem, type LibraryMedia } from './core/index.js';
import { LibraryGrid } from './LibraryGrid.js';
import { LibraryMediaViewer } from './LibraryMediaViewer.js';
import { usePhotoRoots } from './use-photo-roots.js';

const PAGE_LIMIT = 200;

export interface PersonMediaPanelProps {
  personId: string;
  label: string;
  media: LibraryMedia;
  onClose: () => void;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  onOpenPhotoInAnalysis: (root: string, fingerprint: string) => void;
}

export const PersonMediaPanel = ({
  personId,
  label,
  media,
  onClose,
  onOpenResult,
  onOpenPhotoInAnalysis,
}: PersonMediaPanelProps) => {
  const dictionary = useDictionary();
  const photoRoots = usePhotoRoots({ active: true });
  const [viewerFingerprint, setViewerFingerprint] = useState<string | null>(null);
  const collectionInput = {
    tags: [],
    people: [personId],
    sort: 'captured_desc',
    media,
    hideUnavailable: false,
    limit: PAGE_LIMIT,
  } satisfies CollectionInput;
  const page = useInfiniteQuery(actions.libraryCollectionInfinite(collectionInput));

  const pages = page.data?.pages ?? [];
  const items = [...new Map(
    pages.flatMap((loadedPage) => loadedPage.items).map((item) => [item.fingerprint, item]),
  ).values()];
  const total = pages[0]?.total ?? 0;
  const order = items.map((item) => item.fingerprint);
  const viewerItem = viewerFingerprint === null
    ? null
    : items.find((item) => item.fingerprint === viewerFingerprint) ?? null;

  const openInAnalysis = (item: LibraryItem): void => {
    onClose();
    if (item.media === 'video') {
      if (!item.folder.online) return;
      onOpenResult(item.folder.currentPath, `${item.folder.currentPath}/${item.fileName}`);
      return;
    }
    const root = ownerPhotoRootFor(item.currentPath, photoRoots);
    if (root === null) return;
    onOpenPhotoInAnalysis(root, item.fingerprint);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg" data-testid="person-media-panel">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="h2" component="span" sx={{ flex: 1, minWidth: 0 }} noWrap title={label}>
          {labelWithCount(label, total)}
        </Typography>
        <IconButton
          aria-label={dictionary.library.viewerClose}
          onClick={onClose}
          data-testid="person-media-close"
        >
          <CancelIcon />
        </IconButton>
      </DialogTitle>
      <Box sx={{ height: 520, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {page.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }} data-testid="person-media-loading">
            <CircularProgress size={24} />
          </Box>
        ) : items.length === 0 ? (
          <Alert severity="info" sx={{ m: 2 }} data-testid="person-media-empty">
            {dictionary.people.personMediaEmpty}
          </Alert>
        ) : (
          <>
            <LibraryGrid
              sections={[{ key: personId, label: dictionary.people.personMediaSection, offline: false, offlineReason: null, items }]}
              onOpen={(item) => setViewerFingerprint(item.fingerprint)}
              onOpenInAnalysis={openInAnalysis}
            />
            {page.hasNextPage ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => { void page.fetchNextPage(); }}
                  disabled={page.isFetchingNextPage}
                  data-testid="person-media-load-more"
                >
                  {page.isFetchingNextPage ? <CircularProgress size={16} /> : dictionary.library.loadMore}
                </Button>
              </Box>
            ) : null}
          </>
        )}
      </Box>
      {viewerItem === null ? null : (
        <LibraryMediaViewer
          item={viewerItem}
          onClose={() => setViewerFingerprint(null)}
          onOpenInAnalysis={() => openInAnalysis(viewerItem)}
          onPrevious={
            adjacentFingerprint(order, viewerItem.fingerprint, -1) === null
              ? null
              : () => setViewerFingerprint(adjacentFingerprint(order, viewerItem.fingerprint, -1))
          }
          onNext={
            adjacentFingerprint(order, viewerItem.fingerprint, 1) === null
              ? null
              : () => setViewerFingerprint(adjacentFingerprint(order, viewerItem.fingerprint, 1))
          }
        />
      )}
    </Dialog>
  );
};
