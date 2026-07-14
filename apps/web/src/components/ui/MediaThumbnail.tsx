import { useEffect, useState } from 'react';
import { Box } from '@mui/material';

import { mediaUrl } from '../../lib/media-url.js';
import { FilmIcon } from './icons.js';

interface MediaThumbnailProps {
  path: string | null;
  mtime: number | null;
  alt: string;
  width: number;
  height: number;
  selected?: boolean;
}

export const MediaThumbnail = ({
  path,
  mtime,
  alt,
  width,
  height,
  selected = false,
}: MediaThumbnailProps) => {
  const src = path === null ? null : mediaUrl(path, mtime);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showFallback = src === null || failed;

  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width,
        height,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: theme.palette.action.hover,
        ...(selected
          ? { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 }
          : {}),
      })}
    >
      {showFallback ? (
        <FilmIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      ) : (
        <Box
          component="img"
          src={src ?? undefined}
          alt={alt}
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </Box>
  );
};
