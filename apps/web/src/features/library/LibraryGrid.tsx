import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Box, Checkbox, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { AspectRatioIndicator } from '../../components/ui/AspectRatioIndicator.js';
import { FilmIcon } from '../../components/ui/icons.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { buildRows, columnsForWidth, visibleRowRange, type LibraryItem, type LibraryOfflineReason } from './core/index.js';
import { LibraryTileThumbnail } from './LibraryTileThumbnail.js';
import { LIBRARY_SECTION_HEADER_HEIGHT, LIBRARY_TILE_GAP, LIBRARY_TILE_SIZE } from './tile-metrics.js';
import { TileMenu, useTileMenu } from './TileMenu.js';
import type { Dictionary } from '../../i18n/dictionary.js';

const EMPTY_SELECTION = new Set<string>();
const INITIAL_WIDTH = LIBRARY_TILE_SIZE * 3 + LIBRARY_TILE_GAP * 2 + 32;
const INITIAL_HEIGHT = (LIBRARY_TILE_SIZE + LIBRARY_TILE_GAP) * 4 + LIBRARY_SECTION_HEADER_HEIGHT;

export interface LibraryGridSection {
  key: string;
  label: string;
  offline: boolean;
  offlineReason: LibraryOfflineReason;
  items: LibraryItem[];
}

const offlineLabel = (dictionary: Dictionary, offlineReason: LibraryOfflineReason): string =>
  offlineReason === 'file-missing' ? dictionary.library.missingBadge : dictionary.library.offlineFolderBadge;

interface LibraryGridProps {
  sections: LibraryGridSection[];
  onOpen: (item: LibraryItem) => void;
  onSelect?: ((item: LibraryItem, event: MouseEvent) => void) | undefined;
  onSelectAll?: (() => void) | undefined;
  onOpenInAnalysis: (item: LibraryItem) => void;
  selectedFingerprints?: ReadonlySet<string> | undefined;
  hiddenView?: boolean | undefined;
  onHideItem?: ((item: LibraryItem) => void) | undefined;
  onRestoreItem?: ((item: LibraryItem) => void) | undefined;
}

const NO_SELECT = (): void => undefined;

const LibraryGridView = ({
  sections,
  onOpen,
  onSelect = NO_SELECT,
  onSelectAll = NO_SELECT,
  onOpenInAnalysis,
  selectedFingerprints = EMPTY_SELECTION,
  hiddenView = false,
  onHideItem = NO_SELECT,
  onRestoreItem = NO_SELECT,
}: LibraryGridProps) => {
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(INITIAL_WIDTH);
  const [viewportHeight, setViewportHeight] = useState(INITIAL_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const tileMenu = useTileMenu();

  useEffect(() => {
    const element = containerRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setContainerWidth(entry.contentRect.width);
      setViewportHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = columnsForWidth(containerWidth - 32, LIBRARY_TILE_SIZE, LIBRARY_TILE_GAP);
  const rows = useMemo(() => buildRows(sections, columns), [sections, columns]);
  const rowHeight = LIBRARY_TILE_SIZE + LIBRARY_TILE_GAP;
  const range = useMemo(
    () => visibleRowRange(scrollTop, viewportHeight, rowHeight, LIBRARY_SECTION_HEADER_HEIGHT, rows),
    [rowHeight, rows, scrollTop, viewportHeight],
  );
  const onGridKeyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectAll();
    }
  };
  const tileMenuOpen = tileMenu.open;
  const openTileMenu = useCallback(
    (event: MouseEvent, item: LibraryItem) => tileMenuOpen(event, item),
    [tileMenuOpen],
  );

  return (
    <Box
      ref={containerRef}
      data-testid="library-grid"
      role="listbox"
      aria-multiselectable="true"
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onGridKeyDown}
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', px: 2, pt: 1, scrollbarGutter: 'stable' }}
    >
      <Box sx={{ position: 'relative', height: range.totalHeight }}>
        <Box sx={{ position: 'absolute', top: range.topOffset, left: 0, right: 0 }}>
          {rows.slice(range.first, range.last + 1).map((row) => {
            const section = sections[row.section];
            if (section === undefined) return null;
            if (row.kind === 'header') {
              return (
                <Box
                  key={`header-${String(row.section)}`}
                  sx={{ height: LIBRARY_SECTION_HEADER_HEIGHT, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Typography variant="subtitle2" data-testid="library-section-header">
                    {section.label}
                  </Typography>
                  {section.offline ? (
                    <Typography variant="caption" data-testid="library-section-offline-badge" color="text.secondary">
                      {offlineLabel(dictionary, section.offlineReason)}
                    </Typography>
                  ) : null}
                </Box>
              );
            }
            const tiles = section.items.slice(row.start, row.start + row.count);
            return (
              <Box
                key={`tiles-${String(row.section)}-${String(row.start)}`}
                sx={{ display: 'flex', gap: `${String(LIBRARY_TILE_GAP)}px`, height: rowHeight }}
              >
                {tiles.map((item) => (
                  <LibraryTile
                    key={item.fingerprint}
                    item={item}
                    onOpen={onOpen}
                    onSelect={onSelect}
                    onContextMenu={openTileMenu}
                    selected={selectedFingerprints.has(item.fingerprint)}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
      <TileMenu
        controller={tileMenu}
        onOpenInAnalysis={onOpenInAnalysis}
        hiddenView={hiddenView}
        onHideItem={onHideItem}
        onRestoreItem={onRestoreItem}
      />
    </Box>
  );
};

export const LibraryGrid = memo(LibraryGridView);

interface LibraryTileProps {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onSelect: (item: LibraryItem, event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent, item: LibraryItem) => void;
  selected: boolean;
}

const LibraryTileView = ({ item, onOpen, onSelect, onContextMenu, selected }: LibraryTileProps) => {
  const dictionary = useDictionary();
  const isVideo = item.media === 'video';
  const imagePath = isVideo ? (item.gridThumbnailPath ?? item.thumbnailPath) : (item.gridThumbPath ?? item.thumbPath);
  const name = isVideo ? (item.finalName ?? item.fileName) : item.fileName;
  const isOfflineFolder = isVideo && !item.folder.online;
  const offlineReason = isVideo ? item.folder.offlineReason : null;
  const isFileMissing = isVideo ? item.missing : item.missingAt !== null;
  const width = isVideo ? item.width : null;
  const height = isVideo ? item.height : null;
  const showOfflineBadge = imagePath !== null && isOfflineFolder;
  const showMissingBadge = imagePath !== null && isFileMissing && !isOfflineFolder;
  const placeholderCaption = imagePath !== null
    ? undefined
    : isOfflineFolder
      ? offlineLabel(dictionary, offlineReason)
      : isFileMissing
        ? dictionary.library.missingBadge
        : undefined;

  return (
    <Box
      data-testid="library-tile"
      className="library-tile"
      data-fingerprint={item.fingerprint}
      data-media={item.media}
      role="option"
      aria-selected={selected}
      aria-label={name}
      tabIndex={-1}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          onSelect(item, event);
          return;
        }
        onOpen(item);
      }}
      onContextMenu={(event) => onContextMenu(event, item)}
      sx={{
        position: 'relative',
        width: LIBRARY_TILE_SIZE,
        height: LIBRARY_TILE_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: 'library.tileBackground',
        '&:hover': { outline: '2px solid', outlineColor: 'primary.main' },
        ...(selected ? {
          outline: '3px solid',
          outlineColor: 'library.selectionOutline',
          outlineOffset: -3,
        } : {}),
      }}
    >
      {imagePath !== null ? (
        <LibraryTileThumbnail src={mediaUrl(imagePath, item.fingerprint)} />
      ) : (
        <PlaceholderTile
          testId="library-tile-placeholder"
          name={name}
          caption={placeholderCaption}
          captionTestId="library-offline-badge"
        />
      )}
      {showOfflineBadge ? (
        <Box
          data-testid="library-offline-badge"
          sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{offlineLabel(dictionary, offlineReason)}</Typography>
        </Box>
      ) : null}
      <AspectRatioIndicator width={width} height={height} testId="library-aspect-indicator" />
      {isVideo && !showMissingBadge ? (
        <Box
          data-testid="library-tile-video-badge"
          role="img"
          aria-label={dictionary.library.videoBadge}
          sx={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FilmIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
        </Box>
      ) : null}
      {showMissingBadge ? (
        <Box
          data-testid="library-missing-badge"
          sx={{ position: 'absolute', bottom: 4, left: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{dictionary.library.missingBadge}</Typography>
        </Box>
      ) : null}
      <Checkbox
        checked={selected}
        slotProps={{ input: { 'aria-label': name } }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(item, event);
        }}
        sx={{
          position: 'absolute',
          top: 4,
          left: 4,
          zIndex: 2,
          width: 32,
          height: 32,
          bgcolor: 'background.paper',
          borderRadius: 1,
          opacity: selected ? 1 : 0,
          pointerEvents: selected ? 'auto' : 'none',
          transition: 'opacity 120ms ease',
          '.MuiSvgIcon-root': { fontSize: 20 },
          '&:hover': { bgcolor: 'background.paper' },
          '.library-tile:hover &': { opacity: 1, pointerEvents: 'auto' },
        }}
      />
      {selected ? (
        <Box
          data-testid="library-tile-selected"
          sx={{ position: 'absolute', inset: 0, bgcolor: 'library.selectionOverlay', pointerEvents: 'none' }}
        />
      ) : null}
    </Box>
  );
};

const LibraryTile = memo(LibraryTileView);
