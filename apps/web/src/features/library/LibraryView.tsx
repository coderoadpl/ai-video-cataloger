import { useMemo } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { groupByCaptureDay, type LibraryItem } from './core/index.js';
import { LibraryGrid } from './LibraryGrid.js';
import { useLibrary } from './use-library.js';

interface LibraryViewProps {
  active: boolean;
  onOpenResult: (folderPath: string, videoPath: string) => void;
  onGoToVideos: () => void;
}

const toLocalDay = (isoUtc: string): string => {
  const date = new Date(isoUtc);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const LibraryView = ({ active, onOpenResult, onGoToVideos }: LibraryViewProps) => {
  const dictionary = useDictionary();
  const library = useLibrary({ active });
  const sections = useMemo(() => groupByCaptureDay(library.items, toLocalDay), [library.items]);

  if (!active) return null;

  const openItem = (item: LibraryItem): void => {
    if (!item.folder.online) return;
    onOpenResult(item.folder.currentPath, `${item.folder.currentPath}/${item.fileName}`);
  };

  const isEmptyCatalog = !library.isLoading && library.error === null && library.debouncedQuery.length === 0 && library.total === 0;
  const isNoMatch = !library.isLoading && library.error === null && library.debouncedQuery.length > 0 && library.total === 0;

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
          <Typography variant="body2" sx={{ maxWidth: 420 }}>{dictionary.library.noMatchBody}</Typography>
          <Button variant="outlined" onClick={() => library.setQuery('')} data-testid="library-no-match-clear" sx={{ mt: 1 }}>
            {dictionary.library.noMatchClearAction}
          </Button>
        </Box>
      );
    }
    return (
      <>
        <LibraryGrid sections={sections} onOpen={openItem} />
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
          {library.isLoading ? dictionary.library.subtitle : dictionary.library.countHeader(library.total)}
        </Typography>
        <TextField
          size="small"
          fullWidth
          value={library.query}
          onChange={(event) => library.setQuery(event.target.value)}
          placeholder={dictionary.library.searchPlaceholder}
          data-testid="library-search-input"
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{body()}</Box>
    </Box>
  );
};
