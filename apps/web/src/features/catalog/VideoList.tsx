import { useMemo, type ReactNode } from 'react';
import { Box, Chip, CircularProgress, List, ListItemButton, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { type CatalogVideo, keyOf } from './catalog-video.js';
import { DuplicateBadge } from './DuplicateBadge.js';
import { useWindowedList } from './use-windowed-list.js';

const EMPTY_SKIPPED: ReadonlySet<string> = new Set();
const VIDEO_ROW_HEIGHT = 96;
const THUMB_BOX = 56;
const ERROR_VIDEO_ROW_HEIGHT = 120;

const hasErrorLine = (video: CatalogVideo): boolean =>
  video.status === 'error' && video.errorMessage != null && video.errorMessage.length > 0;

const rowHeightOf = (video: CatalogVideo): number =>
  hasErrorLine(video) ? ERROR_VIDEO_ROW_HEIGHT : VIDEO_ROW_HEIGHT;

interface VideoListProps {
  videos: readonly CatalogVideo[];
  selectedKey: string | null;
  analyzingPath: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onSelect: (video: CatalogVideo) => void;
  skippedPaths?: ReadonlySet<string>;
  maxHeight?: number | undefined;
}

export const SkippedBadge = ({ dictionary }: { dictionary: Dictionary }) => (
  <Chip
    size="small"
    label={dictionary.catalog.skipped}
    data-testid="skipped-badge"
    sx={(theme) => ({
      bgcolor: theme.palette.status.notTracked.soft,
      color: theme.palette.status.notTracked.main,
    })}
  />
);

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

const errorMessage = (error: unknown, dictionary: Dictionary): string =>
  error instanceof ApiError ? error.appError.message : dictionary.catalog.genericScanError;

const VideoRow = ({
  video,
  selected,
  analyzing,
  skipped,
  onSelect,
  dictionary,
}: {
  video: CatalogVideo;
  selected: boolean;
  analyzing: boolean;
  skipped: boolean;
  onSelect: (video: CatalogVideo) => void;
  dictionary: Dictionary;
}) => (
  <ListItemButton
    selected={selected}
    onClick={() => onSelect(video)}
    title={video.path}
    data-testid="video-item"
    data-video-filename={video.filename}
    data-video-status={video.status}
    sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1, height: rowHeightOf(video) }}
  >
    <MediaThumbnail
      path={video.artifacts.thumbnailPath}
      mtime={video.artifacts.thumbnailMtime}
      alt={video.filename}
      width={THUMB_BOX}
      square
      source={video.source}
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
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {video.duplicate != null ? (
          <DuplicateBadge canonicalPath={video.duplicate.canonicalPath} />
        ) : (
          <VideoStatusBadge status={video.status} analyzing={analyzing} variant="list" />
        )}
        {skipped ? <SkippedBadge dictionary={dictionary} /> : null}
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

export const VideoList = ({
  videos,
  selectedKey,
  analyzingPath,
  isLoading,
  isError,
  error,
  onSelect,
  skippedPaths = EMPTY_SKIPPED,
  maxHeight,
}: VideoListProps) => {
  const dictionary = useDictionary();
  const rowHeights = useMemo(() => videos.map(rowHeightOf), [videos]);
  const { range, onScroll, containerRef } = useWindowedList(rowHeights);

  if (isLoading) {
    return (
      <Centered>
        <CircularProgress size={22} />
        <Typography variant="body2">{dictionary.catalog.scanningFolder}</Typography>
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
          {errorMessage(error, dictionary)}
        </Typography>
      </Centered>
    );
  }

  if (videos.length === 0) {
    return (
      <Centered>
        <Typography variant="body2">{dictionary.catalog.noVideosFound}</Typography>
      </Centered>
    );
  }

  return (
    <List
      dense
      disablePadding
      ref={containerRef}
      onScroll={onScroll}
      sx={{
        p: 1,
        height: maxHeight === undefined ? '100%' : maxHeight,
        maxHeight: maxHeight,
        overflow: 'auto',
      }}
    >
      <Box sx={{ height: range.totalHeight, position: 'relative' }}>
        <Box sx={{ transform: `translateY(${String(range.offsetTop)}px)` }}>
          {videos.slice(range.start, range.end).map((video) => (
            <VideoRow
              key={keyOf(video)}
              video={video}
              selected={keyOf(video) === selectedKey}
              analyzing={video.path === analyzingPath}
              skipped={skippedPaths.has(video.path)}
              onSelect={onSelect}
              dictionary={dictionary}
            />
          ))}
        </Box>
      </Box>
    </List>
  );
};
