import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { buildRows, columnsForWidth, rowIndexOfFingerprint, visibleRowRange, type LibraryItem } from './core/index.js';
import { TileMenu, useTileMenu } from './TileMenu.js';

const TILE_SIZE = 168;
const GAP = 8;
const HEADER_HEIGHT = 36;

export interface LibraryGridSection {
  key: string;
  label: string;
  offline: boolean;
  items: LibraryItem[];
}

interface LibraryGridProps {
  sections: LibraryGridSection[];
  onOpen: (item: LibraryItem) => void;
  onOpenInAnalysis: (item: LibraryItem) => void;
  scrollToFingerprint?: string | null;
  onScrolledToFingerprint?: () => void;
}

export const LibraryGrid = ({ sections, onOpen, onOpenInAnalysis, scrollToFingerprint = null, onScrolledToFingerprint }: LibraryGridProps) => {
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

  useLayoutEffect(() => {
    if (scrollToFingerprint === null || containerRef.current === null) return;
    const targetRow = rowIndexOfFingerprint(sections, columns, scrollToFingerprint);
    if (targetRow === null) return;
    let offset = 0;
    for (let index = 0; index < targetRow; index += 1) {
      offset += rows[index]?.kind === 'header' ? HEADER_HEIGHT : rowHeight;
    }
    containerRef.current.scrollTop = offset;
    setScrollTop(offset);
    onScrolledToFingerprint?.();
  }, [scrollToFingerprint, sections, columns, rows, rowHeight, onScrolledToFingerprint]);

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
                      {dictionary.library.offlineFolderBadge}
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
  const imagePath = item.gridThumbnailPath ?? item.thumbnailPath;
  const name = item.finalName ?? item.fileName;
  const imageFit = item.gridThumbnailPath === null ? 'contain' : 'cover';

  return (
    <Box
      data-testid="library-tile"
      data-fingerprint={item.fingerprint}
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
        opacity: item.missing ? 0.5 : 1,
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
          caption={item.folder.online ? undefined : dictionary.library.offlineFolderBadge}
          captionTestId="library-offline-badge"
        />
      )}
      {item.folder.online || imagePath === null ? null : (
        <Box
          data-testid="library-offline-badge"
          sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{dictionary.library.offlineFolderBadge}</Typography>
        </Box>
      )}
      {item.missing ? (
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
