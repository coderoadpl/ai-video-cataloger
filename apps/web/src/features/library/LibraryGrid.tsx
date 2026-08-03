import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { AspectRatioIndicator } from '../../components/ui/AspectRatioIndicator.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { buildRows, columnsForWidth, visibleRowRange, type LibraryItem, type LibraryOfflineReason } from './core/index.js';
import { TileMenu, useTileMenu } from './TileMenu.js';
import type { Dictionary } from '../../i18n/dictionary.js';

const TILE_SIZE = 168;
const GAP = 8;
const HEADER_HEIGHT = 36;

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
  onOpenInAnalysis: (item: LibraryItem) => void;
}

export const LibraryGrid = ({ sections, onOpen, onOpenInAnalysis }: LibraryGridProps) => {
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
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

  const columns = columnsForWidth(containerWidth - 32, TILE_SIZE, GAP);
  const rows = useMemo(() => buildRows(sections, columns), [sections, columns]);
  const rowHeight = TILE_SIZE + GAP;
  const range = useMemo(
    () => visibleRowRange(scrollTop, viewportHeight, rowHeight, HEADER_HEIGHT, rows),
    [rowHeight, rows, scrollTop, viewportHeight],
  );

  return (
    <Box
      ref={containerRef}
      data-testid="library-grid"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
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
                  sx={{ height: HEADER_HEIGHT, display: 'flex', alignItems: 'center', gap: 1 }}
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
                sx={{ display: 'flex', gap: `${String(GAP)}px`, height: rowHeight }}
              >
                {tiles.map((item) => (
                  <LibraryTile
                    key={item.fingerprint}
                    item={item}
                    onOpen={() => onOpen(item)}
                    onContextMenu={(event: MouseEvent) => tileMenu.open(event, item)}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
      <TileMenu controller={tileMenu} onOpenInAnalysis={onOpenInAnalysis} />
    </Box>
  );
};

interface LibraryTileProps {
  item: LibraryItem;
  onOpen: () => void;
  onContextMenu: (event: MouseEvent) => void;
}

const LibraryTile = ({ item, onOpen, onContextMenu }: LibraryTileProps) => {
  const dictionary = useDictionary();
  const isVideo = item.media === 'video';
  const imagePath = isVideo ? (item.gridThumbnailPath ?? item.thumbnailPath) : (item.gridThumbPath ?? item.thumbPath);
  const gridPath = isVideo ? item.gridThumbnailPath : item.gridThumbPath;
  const name = isVideo ? (item.finalName ?? item.fileName) : item.fileName;
  const imageFit = gridPath === null ? 'contain' : 'cover';
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
      data-fingerprint={item.fingerprint}
      data-media={item.media}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      sx={{
        position: 'relative',
        width: TILE_SIZE,
        height: TILE_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: 'background.default',
        '&:hover': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      {imagePath !== null ? (
        <Box
          component="img"
          loading="lazy"
          alt={name}
          src={mediaUrl(imagePath, item.fingerprint)}
          sx={{ width: '100%', height: '100%', objectFit: imageFit }}
        />
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
      {showMissingBadge ? (
        <Box
          data-testid="library-missing-badge"
          sx={{ position: 'absolute', bottom: 4, left: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{dictionary.library.missingBadge}</Typography>
        </Box>
      ) : null}
    </Box>
  );
};
