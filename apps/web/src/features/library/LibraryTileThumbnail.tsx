import { useState } from 'react';
import { Box, Skeleton } from '@mui/material';

import { BrokenImageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';

type ThumbnailPhase = 'loading' | 'ready' | 'failed';

export const LibraryTileThumbnail = ({ src }: { src: string }) => {
  const dictionary = useDictionary();
  const [progress, setProgress] = useState<{ src: string; phase: ThumbnailPhase }>({ src, phase: 'loading' });
  const phase: ThumbnailPhase = progress.src === src ? progress.phase : 'loading';

  if (phase === 'failed') {
    return (
      <Box
        data-testid="library-tile-thumbnail-unavailable"
        role="img"
        aria-label={dictionary.library.thumbnailUnavailable}
        title={dictionary.library.thumbnailUnavailable}
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'library.tileUnavailableBackground',
        }}
      >
        <BrokenImageIcon sx={{ color: 'library.tileUnavailableForeground' }} />
      </Box>
    );
  }

  return (
    <>
      <Box
        component="img"
        alt=""
        src={src}
        onLoad={() => setProgress({ src, phase: 'ready' })}
        onError={() => setProgress({ src, phase: 'failed' })}
        sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {phase === 'loading' ? (
        <Skeleton
          data-testid="library-tile-thumbnail-skeleton"
          variant="rectangular"
          animation="wave"
          sx={{ position: 'absolute', inset: 0, bgcolor: 'library.tileBackground' }}
        />
      ) : null}
    </>
  );
};
