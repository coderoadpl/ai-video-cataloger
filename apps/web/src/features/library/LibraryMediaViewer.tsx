import { useEffect } from 'react';
import { Box, Button, IconButton, Modal, Typography } from '@mui/material';

import { ArrowBackIcon, CancelIcon, SkipNextIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { viewerTitle, type LibraryItem } from './core/index.js';
import { LibraryPhotoDetails, LibraryPhotoStage } from './LibraryPhotoPane.js';
import { LibraryVideoDetails, LibraryVideoStage } from './LibraryVideoPane.js';

interface LibraryMediaViewerProps {
  item: LibraryItem;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onOpenInAnalysis: () => void;
}

export const LibraryMediaViewer = ({
  item,
  onClose,
  onPrevious,
  onNext,
  onOpenInAnalysis,
}: LibraryMediaViewerProps) => {
  const dictionary = useDictionary();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && onPrevious !== null) onPrevious();
      if (event.key === 'ArrowRight' && onNext !== null) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onNext, onPrevious]);

  const capturedAt = formatCapturedAt(item.capturedAt, dictionary.locale);
  const title = viewerTitle(item);

  return (
    <Modal open onClose={onClose}>
      <Box
        data-testid="library-media-viewer"
        data-media={item.media}
        data-fingerprint={item.fingerprint}
        sx={{
          position: 'absolute',
          top: '5%',
          left: '5%',
          right: '5%',
          bottom: '5%',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={onOpenInAnalysis}
            data-testid="library-media-viewer-open-analysis"
          >
            {dictionary.library.openInAnalysis}
          </Button>
          <IconButton
            aria-label={dictionary.library.viewerClose}
            onClick={onClose}
            data-testid="library-media-viewer-close"
          >
            <CancelIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', p: 2 }}>
            {onPrevious === null ? null : (
              <IconButton
                aria-label={dictionary.library.viewerPrevious}
                onClick={onPrevious}
                data-testid="library-media-viewer-previous"
                sx={{ position: 'absolute', left: 8 }}
              >
                <ArrowBackIcon />
              </IconButton>
            )}
            {item.media === 'video' ? <LibraryVideoStage item={item} /> : <LibraryPhotoStage item={item} />}
            {onNext === null ? null : (
              <IconButton
                aria-label={dictionary.library.viewerNext}
                onClick={onNext}
                data-testid="library-media-viewer-next"
                sx={{ position: 'absolute', right: 8 }}
              >
                <SkipNextIcon />
              </IconButton>
            )}
          </Box>
          <Box
            data-testid="library-media-viewer-details"
            sx={{
              width: 340,
              flexShrink: 0,
              maxWidth: '38%',
              borderLeft: 1,
              borderColor: 'divider',
              p: 2,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Typography variant="h2">{title}</Typography>
            {item.media === 'video' ? <LibraryVideoDetails item={item} /> : <LibraryPhotoDetails item={item} />}
          </Box>
        </Box>
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Typography variant="body2" data-testid="library-media-viewer-caption">
            {capturedAt === null ? title : `${title} · ${capturedAt}`}
          </Typography>
        </Box>
      </Box>
    </Modal>
  );
};
