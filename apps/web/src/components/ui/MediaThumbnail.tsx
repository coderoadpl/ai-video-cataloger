import { useEffect, useState } from 'react';
import { Box } from '@mui/material';

import { mediaUrl } from '../../lib/media-url.js';
import { thumbnailBoxForSource, type SourceAspectInput } from '../../lib/thumbnail-aspect.js';
import { FilmIcon } from './icons.js';

interface MediaThumbnailProps {
  path: string | null;
  mtime: number | null;
  alt: string;
  width: number;
  height?: number | undefined;
  source?: SourceAspectInput | undefined;
  selected?: boolean;
}

export const MediaThumbnail = ({
  path,
  mtime,
  alt,
  width,
  height,
  source,
  selected = false,
}: MediaThumbnailProps) => {
  const src = path === null ? null : mediaUrl(path, mtime);
  const [failed, setFailed] = useState(false);
  const box = height === undefined ? thumbnailBoxForSource(source, width) : { width, height };

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showFallback = src === null || failed;

  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width: box.width,
        height: box.height,
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
      data-testid="media-thumbnail"
      data-thumbnail-width={box.width}
      data-thumbnail-height={box.height}
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
