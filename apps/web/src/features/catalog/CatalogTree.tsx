import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, List, ListItemButton, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ChevronRightIcon, ExpandMoreIcon, FolderIcon } from '../../components/ui/icons.js';
import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { RevealContextMenu, useRevealContextMenu } from '../../components/ui/RevealContextMenu.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { ApiError } from '@core/client/index.js';
import { actions, bridge } from '../../api.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import {
  buildTreeRows,
  folderNeedsFetch,
  keyOf,
  type CatalogTreeNode,
  type CatalogVideo,
  type FolderCountsData,
  type FolderRow,
  type LoadedFolder,
  type StatusRow,
  type TreeRow,
  type VideoRow as VideoRowData,
} from './core/index.js';
import { DuplicateBadge } from '../../components/ui/DuplicateBadge.js';
import { thumbnailLoading } from './VideoList.js';
import { useThumbnailGeneration } from './use-thumbnail-generation.js';
import { useWindowedList } from './use-windowed-list.js';

interface CatalogTreeProps {
  root: CatalogTreeNode;
  rootVideos: readonly CatalogVideo[];
  selectedKey: string | null;
  analyzingPath: string | null;
  thumbnailFailedPaths?: ReadonlySet<string>;
  onSelect: (video: CatalogVideo) => void;
  registerVideos: (videos: readonly CatalogVideo[]) => void;
}

const LARGE_TREE_VIDEO_THRESHOLD = 2_000;
const FOLDER_ROW_HEIGHT = 40;
const STATUS_ROW_HEIGHT = 52;
const VIDEO_ROW_HEIGHT = 96;
const ERROR_VIDEO_ROW_HEIGHT = 120;
const INDENT = 18;
const THUMB_BOX = 56;
const EMPTY_SUBFOLDER_VIDEOS: readonly CatalogVideo[] = [];
const EMPTY_FAILED: ReadonlySet<string> = new Set();

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const processDriveCommand = (root: string): string => `ai-video-cataloger process-drive ${shellQuote(root)}`;

const hasErrorLine = (video: CatalogVideo): boolean =>
  video.status === 'error' && video.errorMessage != null && video.errorMessage.length > 0;

const rowHeightOf = (row: TreeRow): number => {
  if (row.kind === 'folder') return FOLDER_ROW_HEIGHT;
  if (row.kind === 'status') return STATUS_ROW_HEIGHT;
  return hasErrorLine(row.video) ? ERROR_VIDEO_ROW_HEIGHT : VIDEO_ROW_HEIGHT;
};

const countsText = (counts: FolderCountsData, dictionary: Dictionary): string => {
  if (!counts.known) return dictionary.catalog.unknownFolderCounts(counts.videoCount);
  if (counts.duplicates > 0) {
    return dictionary.catalog.folderCountsWithDuplicates(counts.pending, counts.done, counts.duplicates);
  }
  return dictionary.catalog.folderCounts(counts.pending, counts.done);
};

const RowGuides = ({ row }: { row: TreeRow }) => {
  if (row.depth === 0) return null;
  const connector = row.depth - 1;
  const lines: ReactNode[] = [];
  for (let level = 0; level < connector; level += 1) {
    if (!row.ancestorContinues[level]) continue;
    lines.push(
      <Box
        key={`v-${String(level)}`}
        sx={(theme) => ({
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: level * INDENT + INDENT / 2,
          width: '1px',
          bgcolor: theme.palette.divider,
        })}
      />,
    );
  }
  const x = connector * INDENT + INDENT / 2;
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-testid="row-guides">
      {lines}
      <Box sx={(theme) => ({ position: 'absolute', top: 0, height: '50%', left: x, width: '1px', bgcolor: theme.palette.divider })} />
      {row.isLast ? null : (
        <Box sx={(theme) => ({ position: 'absolute', top: '50%', bottom: 0, left: x, width: '1px', bgcolor: theme.palette.divider })} />
      )}
      <Box sx={(theme) => ({ position: 'absolute', top: '50%', left: x, width: INDENT / 2, height: '1px', bgcolor: theme.palette.divider })} />
    </Box>
  );
};

const FolderRowView = ({
  row,
  onToggle,
  onContextMenu,
}: {
  row: FolderRow;
  onToggle: (relativePath: string) => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
}) => {
  const dictionary = useDictionary();
  return (
    <ListItemButton
      role="treeitem"
      aria-expanded={row.expanded}
      aria-level={row.depth + 1}
      onClick={() => onToggle(row.relativePath)}
      onContextMenu={(event) => onContextMenu(event, row.path)}
      data-testid={row.isRoot ? 'folder-root-row' : 'folder-row'}
      data-folder-name={row.name}
      data-folder-pending={row.counts.known ? row.counts.pending : null}
      data-folder-duplicates={row.counts.duplicates}
      title={row.path}
      sx={{ position: 'relative', gap: 0.75, py: 0.5, pl: `${row.depth * INDENT + 8}px`, height: FOLDER_ROW_HEIGHT, borderRadius: 1 }}
    >
      <RowGuides row={row} />
      {row.expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
      <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>
        {row.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
        {countsText(row.counts, dictionary)}
      </Typography>
    </ListItemButton>
  );
};

const VideoRowView = ({
  row,
  selected,
  analyzing,
  thumbnailLoadingState,
  onSelect,
  onContextMenu,
}: {
  row: VideoRowData;
  selected: boolean;
  analyzing: boolean;
  thumbnailLoadingState: boolean;
  onSelect: (video: CatalogVideo) => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
}) => {
  const dictionary = useDictionary();
  const video = row.video;
  const height = hasErrorLine(video) ? ERROR_VIDEO_ROW_HEIGHT : VIDEO_ROW_HEIGHT;
  const formattedError = video.errorMessage == null ? null : formatAnalyzerError(video.errorMessage, dictionary.errors);
  return (
    <ListItemButton
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      selected={selected}
      onClick={() => onSelect(video)}
      onContextMenu={(event) => onContextMenu(event, video.path)}
      title={video.path}
      data-testid="video-item"
      data-video-filename={video.filename}
      data-video-status={video.status}
      sx={{ position: 'relative', alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1, height, pl: `${row.depth * INDENT + 8}px` }}
    >
      <RowGuides row={row} />
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
        {hasErrorLine(video) && formattedError !== null ? (
          <Typography
            variant="caption"
            noWrap
            title={formattedError}
            sx={(theme) => ({ color: theme.palette.status.error.main })}
          >
            {formattedError}
          </Typography>
        ) : null}
      </Box>
    </ListItemButton>
  );
};

const StatusRowView = ({ row }: { row: StatusRow }) => {
  const dictionary = useDictionary();
  return (
    <Box sx={{ position: 'relative', height: STATUS_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 1, pl: `${row.depth * INDENT + 8}px` }}>
      <RowGuides row={row} />
      {row.variant === 'loading' ? (
        <>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">{dictionary.catalog.scanningFolder}</Typography>
        </>
      ) : (
        <Typography variant="caption" role="alert" sx={(theme) => ({ color: theme.palette.status.error.main })}>
          {row.error instanceof ApiError
            ? formatAnalyzerError(row.error.appError.message, dictionary.errors)
            : dictionary.catalog.genericScanError}
        </Typography>
      )}
    </Box>
  );
};

const FolderFetcher = ({
  relativePath,
  path,
  onLoaded,
  registerVideos,
}: {
  relativePath: string;
  path: string;
  onLoaded: (relativePath: string, loaded: LoadedFolder) => void;
  registerVideos: (videos: readonly CatalogVideo[]) => void;
}) => {
  const details = useQuery(actions.catalogTreeFolder({ folder: path }));
  const videos = details.data?.videos;
  useEffect(() => {
    if (videos !== undefined) registerVideos(videos);
    onLoaded(relativePath, {
      videos: videos ?? [],
      isLoading: details.isLoading,
      isError: details.isError,
      error: details.error,
    });
  }, [relativePath, videos, details.isLoading, details.isError, details.error, onLoaded, registerVideos]);
  return null;
};

export const CatalogTree = ({ root, rootVideos, selectedKey, analyzingPath, thumbnailFailedPaths = EMPTY_FAILED, onSelect, registerVideos }: CatalogTreeProps) => {
  const dictionary = useDictionary();
  const revealMenu = useRevealContextMenu();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']));
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedFolder>>(() => new Map());

  const isExpanded = useCallback((relativePath: string) => expanded.has(relativePath), [expanded]);
  const onToggle = useCallback((relativePath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }, []);
  const onLoaded = useCallback((relativePath: string, value: LoadedFolder) => {
    setLoaded((current) => {
      const previous = current.get(relativePath);
      if (
        previous !== undefined &&
        previous.videos === value.videos &&
        previous.isLoading === value.isLoading &&
        previous.isError === value.isError &&
        previous.error === value.error
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(relativePath, value);
      return next;
    });
  }, []);

  const loadedFolder = useCallback((relativePath: string) => loaded.get(relativePath), [loaded]);

  const fetchTargets = useMemo(() => {
    const targets: { relativePath: string; path: string }[] = [];
    const visit = (node: CatalogTreeNode): void => {
      if (!expanded.has(node.relativePath)) return;
      for (const child of node.children) {
        if (expanded.has(child.relativePath) && folderNeedsFetch(child)) {
          targets.push({ relativePath: child.relativePath, path: child.path });
        }
        visit(child);
      }
    };
    visit(root);
    return targets;
  }, [root, expanded]);

  const subfolderVideos = useMemo(() => {
    const collected: CatalogVideo[] = [];
    for (const target of fetchTargets) {
      const entry = loaded.get(target.relativePath);
      if (entry !== undefined) collected.push(...entry.videos);
    }
    return collected.length === 0 ? EMPTY_SUBFOLDER_VIDEOS : collected;
  }, [fetchTargets, loaded]);

  const rows = useMemo(
    () => buildTreeRows({ root, rootVideos, isExpanded, loadedFolder }),
    [root, rootVideos, isExpanded, loadedFolder],
  );
  const rowHeights = useMemo(() => rows.map(rowHeightOf), [rows]);
  const { range, onScroll, containerRef } = useWindowedList(rowHeights);

  // The ffmpeg thumbnail queue drains every foreground request before any background one, so an
  // off-screen folder's burst would otherwise starve a visible row for minutes.
  const visibleVideoPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const row of rows.slice(range.start, range.end)) {
      if (row.kind === 'video') paths.add(row.video.path);
    }
    return paths;
  }, [rows, range.start, range.end]);

  const visibleSubfolderVideos = useMemo(
    () => subfolderVideos.filter((video) => visibleVideoPaths.has(video.path)),
    [subfolderVideos, visibleVideoPaths],
  );
  const restSubfolderVideos = useMemo(
    () => subfolderVideos.filter((video) => !visibleVideoPaths.has(video.path)),
    [subfolderVideos, visibleVideoPaths],
  );

  const visibleSubfolderThumbnails = useThumbnailGeneration(root.path, visibleSubfolderVideos, 'viewport-first');
  const restSubfolderThumbnails = useThumbnailGeneration(root.path, restSubfolderVideos, 'background');
  const isThumbnailLoading = useCallback(
    (video: CatalogVideo): boolean =>
      thumbnailLoading(video, thumbnailFailedPaths)
      && thumbnailLoading(video, visibleSubfolderThumbnails.failedPaths)
      && thumbnailLoading(video, restSubfolderThumbnails.failedPaths),
    [thumbnailFailedPaths, visibleSubfolderThumbnails.failedPaths, restSubfolderThumbnails.failedPaths],
  );

  const rootVideoCount = root.videoCount ?? root.videos.length;
  const command = processDriveCommand(root.path);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        {fetchTargets.map((target) => (
          <FolderFetcher
            key={target.relativePath}
            relativePath={target.relativePath}
            path={target.path}
            onLoaded={onLoaded}
            registerVideos={registerVideos}
          />
        ))}
      </Box>
      {rootVideoCount > LARGE_TREE_VIDEO_THRESHOLD ? (
        <Alert
          severity="warning"
          data-testid="large-tree-warning"
          sx={{ m: 1, alignItems: 'flex-start' }}
          action={
            <Button color="inherit" size="small" onClick={() => { void navigator.clipboard?.writeText(command); }}>
              {dictionary.catalog.largeRunCommandLabel}
            </Button>
          }
        >
          <Typography variant="subtitle2">{dictionary.catalog.largeRunWarningTitle}</Typography>
          <Typography variant="body2">{dictionary.catalog.largeRunWarningBody(rootVideoCount)}</Typography>
          <Typography component="code" variant="caption" sx={{ display: 'block', mt: 0.75, userSelect: 'all' }}>
            {command}
          </Typography>
        </Alert>
      ) : null}
      <List
        dense
        disablePadding
        ref={containerRef}
        onScroll={onScroll}
        role="tree"
        aria-label={dictionary.batchToolbar.wholeTree}
        data-testid="catalog-tree-scroll"
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}
      >
        <Box sx={{ height: range.totalHeight, position: 'relative' }}>
          <Box sx={{ transform: `translateY(${String(range.offsetTop)}px)` }}>
            {rows.slice(range.start, range.end).map((row) => {
              if (row.kind === 'folder') return <FolderRowView key={row.key} row={row} onToggle={onToggle} onContextMenu={revealMenu.open} />;
              if (row.kind === 'status') return <StatusRowView key={row.key} row={row} />;
              return (
                <VideoRowView
                  key={row.key}
                  row={row}
                  selected={keyOf(row.video) === selectedKey}
                  analyzing={row.video.path === analyzingPath}
                  thumbnailLoadingState={isThumbnailLoading(row.video)}
                  onSelect={onSelect}
                  onContextMenu={revealMenu.open}
                />
              );
            })}
          </Box>
        </Box>
      </List>
      <RevealContextMenu controller={revealMenu} onReveal={(path) => bridge.revealInFinder(path)} />
    </Box>
  );
};
