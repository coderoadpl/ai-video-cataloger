import { useEffect, useState } from 'react';
import { Box, Skeleton } from '@mui/material';

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
  square?: boolean;
  loading?: boolean;
}

export const MediaThumbnail = ({
  path,
  mtime,
  alt,
  width,
  height,
  source,
  selected = false,
  square = false,
  loading = false,
}: MediaThumbnailProps) => {
  const src = path === null ? null : mediaUrl(path, mtime);
  const [failed, setFailed] = useState(false);
  const box = square
    ? { width, height: width }
    : height === undefined
      ? thumbnailBoxForSource(source, width)
      : { width, height };

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src !== null && !failed;
  const showShimmer = src === null && loading;

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
      data-thumbnail-state={showImage ? 'image' : showShimmer ? 'loading' : 'placeholder'}
    >
      {showImage ? (
        <Box
          component="img"
          src={src ?? undefined}
          alt={alt}
          onError={() => setFailed(true)}
          data-testid="media-thumbnail-img"
          sx={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: square ? 'auto' : '100%',
            height: square ? 'auto' : '100%',
            objectFit: square ? 'contain' : 'cover',
          }}
        />
      ) : showShimmer ? (
        <Skeleton
          variant="rectangular"
          animation="wave"
          width="100%"
          height="100%"
          data-testid="media-thumbnail-shimmer"
        />
      ) : (
        <FilmIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      )}
    </Box>
  );
};
