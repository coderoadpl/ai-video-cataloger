import { useMemo, type MouseEvent, type ReactNode } from 'react';
import { Box, Button, CircularProgress, List, ListItemButton, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

import { bridge } from '../../api.js';
import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { RevealContextMenu, useRevealContextMenu } from '../../components/ui/RevealContextMenu.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { DuplicateBadge } from '../../components/ui/DuplicateBadge.js';
import { type CatalogVideo, keyOf } from './core/index.js';
import { useWindowedList } from './use-windowed-list.js';

const EMPTY_FAILED: ReadonlySet<string> = new Set();
const VIDEO_ROW_HEIGHT = 96;
const THUMB_BOX = 56;
const ERROR_VIDEO_ROW_HEIGHT = 120;

const hasErrorLine = (video: CatalogVideo): boolean =>
  video.status === 'error' && video.errorMessage != null && video.errorMessage.length > 0;

const rowHeightOf = (video: CatalogVideo): number =>
  hasErrorLine(video) ? ERROR_VIDEO_ROW_HEIGHT : VIDEO_ROW_HEIGHT;

interface VideoListProps {
  folder?: string | null;
  videos: readonly CatalogVideo[];
  selectedKey: string | null;
  analyzingPath: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onSelect: (video: CatalogVideo) => void;
  thumbnailFailedPaths?: ReadonlySet<string>;
  maxHeight?: number | undefined;
  subfolderVideoCount?: number;
  onSwitchToWholeTree?: (() => void) | undefined;
  onShowInLibrary?: ((folderPath: string, fingerprint: string | null) => void) | undefined;
}

export const thumbnailLoading = (
  video: Pick<CatalogVideo, 'path' | 'artifacts'>,
  failedPaths: ReadonlySet<string>,
): boolean => video.artifacts.thumbnailPath === null && !failedPaths.has(video.path);

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
  thumbnailLoadingState,
  onSelect,
  onContextMenu,
}: {
  video: CatalogVideo;
  selected: boolean;
  analyzing: boolean;
  thumbnailLoadingState: boolean;
  onSelect: (video: CatalogVideo) => void;
  onContextMenu: (event: MouseEvent, path: string, fingerprint: string | null) => void;
}) => (
  <ListItemButton
    selected={selected}
    onClick={() => onSelect(video)}
    onContextMenu={(event) => onContextMenu(event, video.path, video.contentHash)}
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
      loading={thumbnailLoadingState}
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
        {video.duplicate != null && !analyzing ? (
          <DuplicateBadge canonicalPath={video.duplicate.canonicalPath} />
        ) : (
          <VideoStatusBadge status={video.status} analyzing={analyzing} variant="list" />
        )}
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
  folder = null,
  videos,
  selectedKey,
  analyzingPath,
  isLoading,
  isError,
  error,
  onSelect,
  thumbnailFailedPaths = EMPTY_FAILED,
  maxHeight,
  subfolderVideoCount = 0,
  onSwitchToWholeTree,
  onShowInLibrary,
}: VideoListProps) => {
  const dictionary = useDictionary();
  const revealMenu = useRevealContextMenu();
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
    if (subfolderVideoCount > 0 && onSwitchToWholeTree !== undefined) {
      return (
        <Centered>
          <Typography variant="body2" data-testid="empty-folder-scope">
            {dictionary.catalog.noVideosInFolder(subfolderVideoCount)}
          </Typography>
          <Button size="small" variant="outlined" onClick={onSwitchToWholeTree} data-testid="switch-to-tree">
            {dictionary.catalog.switchToWholeTree}
          </Button>
        </Centered>
      );
    }
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
              thumbnailLoadingState={thumbnailLoading(video, thumbnailFailedPaths)}
              onSelect={onSelect}
              onContextMenu={revealMenu.open}
            />
          ))}
        </Box>
      </Box>
      <RevealContextMenu
        controller={revealMenu}
        onReveal={(path) => bridge.revealInFinder(path)}
        onShowInLibrary={onShowInLibrary === undefined || folder === null
          ? undefined
          : (_path, fingerprint) => onShowInLibrary(folder, fingerprint)}
      />
    </List>
  );
};
