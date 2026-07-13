import { type ReactNode } from 'react';
import { Box, CircularProgress, List, ListItemButton, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { type CatalogVideo, keyOf } from './catalog-video.js';

interface VideoListProps {
  videos: readonly CatalogVideo[];
  selectedKey: string | null;
  analyzingPath: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onSelect: (video: CatalogVideo) => void;
}

const Centered = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      py: 6,
      px: 2,
      color: 'text.secondary',
      textAlign: 'center',
    }}
  >
    {children}
  </Box>
);

const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : 'Could not scan this folder.';

const VideoRow = ({
  video,
  selected,
  analyzing,
  onSelect,
}: {
  video: CatalogVideo;
  selected: boolean;
  analyzing: boolean;
  onSelect: (video: CatalogVideo) => void;
}) => (
  <ListItemButton
    selected={selected}
    onClick={() => onSelect(video)}
    title={video.path}
    data-testid="video-item"
    data-video-filename={video.filename}
    data-video-status={video.status}
    sx={{ alignItems: 'flex-start', gap: 1.25, borderRadius: 1, py: 1 }}
  >
    <MediaThumbnail
      path={video.artifacts.thumbnailPath}
      mtime={video.artifacts.thumbnailMtime}
      alt={video.filename}
      width={64}
      height={36}
      selected={selected}
    />
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
        {video.filename}
      </Typography>
      <Typography variant="caption" component="div" noWrap>
        {video.durationFormatted === null ? null : <span>{video.durationFormatted}</span>}
        {video.durationFormatted === null ? null : <span> · </span>}
        <span>{video.sizeFormatted}</span>
      </Typography>
      <Box>
        <VideoStatusBadge status={video.status} analyzing={analyzing} variant="list" />
      </Box>
      {video.status === 'error' && video.errorMessage != null && video.errorMessage.length > 0 ? (
        <Typography
          variant="caption"
          noWrap
          title={video.errorMessage}
          sx={(theme) => ({ color: theme.palette.status.error.main })}
        >
          {video.errorMessage}
        </Typography>
      ) : null}
    </Box>
  </ListItemButton>
);

/**
 * The sidebar video list: a scrollable column of rows, each a thumbnail, name,
 * duration/size and status pill. Renders the loading, error and empty states
 * from the scan query (parity-inventory §2). Selection and the currently
 * analyzing row are driven from `useCatalog` and highlighted here.
 */
export const VideoList = ({
  videos,
  selectedKey,
  analyzingPath,
  isLoading,
  isError,
  error,
  onSelect,
}: VideoListProps) => {
  if (isLoading) {
    return (
      <Centered>
        <CircularProgress size={22} />
        <Typography variant="body2">Scanning folder…</Typography>
      </Centered>
    );
  }

  if (isError) {
    return (
      <Centered>
        <Typography
          variant="body2"
          role="alert"
          sx={(theme) => ({ color: theme.palette.status.error.main })}
        >
          {errorMessage(error)}
        </Typography>
      </Centered>
    );
  }

  if (videos.length === 0) {
    return (
      <Centered>
        <Typography variant="body2">No videos found</Typography>
      </Centered>
    );
  }

  return (
    <List dense disablePadding sx={{ p: 1 }}>
      {videos.map((video) => (
        <VideoRow
          key={keyOf(video)}
          video={video}
          selected={keyOf(video) === selectedKey}
          analyzing={video.path === analyzingPath}
          onSelect={onSelect}
        />
      ))}
    </List>
  );
};
