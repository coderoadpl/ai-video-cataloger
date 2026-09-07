import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';

import { MediaViewerShell } from '../../components/ui/MediaViewerShell.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { viewerSourceCandidates, type PhotoListItem } from './core/index.js';

interface PhotoViewerProps {
  item: PhotoListItem;
  proxyPath: string | null;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

export const PhotoViewer = ({ item, proxyPath, onClose, onPrevious, onNext }: PhotoViewerProps) => {
  const dictionary = useDictionary();
  const candidates = viewerSourceCandidates(item, proxyPath);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [item.fingerprint]);

  const source = candidates[attempt] ?? null;
  const capturedAt = item.capturedAt === null ? null : formatCapturedAt(item.capturedAt, dictionary.locale);

  return (
    <MediaViewerShell
      testId="photos-viewer"
      title={item.fileName}
      caption={capturedAt === null ? item.fileName : `${item.fileName} · ${capturedAt}`}
      onClose={onClose}
      closeLabel={dictionary.photos.viewerClose}
      closeTestId="photos-viewer-close"
      previousLabel={dictionary.photos.viewerPrevious}
      nextLabel={dictionary.photos.viewerNext}
      previousTestId="photos-viewer-previous"
      nextTestId="photos-viewer-next"
      onPrevious={onPrevious}
      onNext={onNext}
      stage={source === null ? (
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
    />
  );
};
