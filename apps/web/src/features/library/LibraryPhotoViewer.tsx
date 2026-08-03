import { useEffect, useState } from 'react';
import { Box, IconButton, Modal, Typography } from '@mui/material';

import { ArrowBackIcon, CancelIcon, SkipNextIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { photoViewerSourceCandidates, type LibraryPhotoItem } from './core/index.js';

interface LibraryPhotoViewerProps {
  item: LibraryPhotoItem;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

export const LibraryPhotoViewer = ({ item, onClose, onPrevious, onNext }: LibraryPhotoViewerProps) => {
  const dictionary = useDictionary();
  const candidates = photoViewerSourceCandidates(item, item.proxyPath);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [item.fingerprint]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && onPrevious !== null) onPrevious();
      if (event.key === 'ArrowRight' && onNext !== null) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onNext, onPrevious]);

  const source = candidates[attempt] ?? null;

  return (
    <Modal open onClose={onClose} data-testid="photos-viewer">
      <Box
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
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
          <IconButton aria-label={dictionary.photos.viewerClose} onClick={onClose} data-testid="photos-viewer-close">
            <CancelIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {onPrevious !== null ? (
            <IconButton
              aria-label={dictionary.photos.viewerPrevious}
              onClick={onPrevious}
              data-testid="photos-viewer-previous"
              sx={{ position: 'absolute', left: 8 }}
            >
              <ArrowBackIcon />
            </IconButton>
          ) : null}
          {source === null ? (
            <Typography>{dictionary.photos.noProxyYet}</Typography>
          ) : (
            <Box
              component="img"
              alt={item.fileName}
              src={mediaUrl(source, item.fingerprint)}
              onError={() => setAttempt((current) => current + 1)}
              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          )}
          {onNext !== null ? (
            <IconButton
              aria-label={dictionary.photos.viewerNext}
              onClick={onNext}
              data-testid="photos-viewer-next"
              sx={{ position: 'absolute', right: 8 }}
            >
              <SkipNextIcon />
            </IconButton>
          ) : null}
        </Box>
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Typography variant="body2">
            {item.fileName}
            {item.capturedAt === null ? '' : ` · ${formatCapturedAt(item.capturedAt, dictionary.locale) ?? ''}`}
          </Typography>
        </Box>
      </Box>
    </Modal>
  );
};
