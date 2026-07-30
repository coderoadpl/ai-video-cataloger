import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { buildRows, columnsForWidth, visibleRowRange, type LibraryDaySection, type LibraryItem } from './core/index.js';

const TILE_SIZE = 168;
const GAP = 8;
const HEADER_HEIGHT = 36;

interface LibraryGridProps {
  sections: LibraryDaySection[];
  onOpen: (item: LibraryItem) => void;
}

export const LibraryGrid = ({ sections, onOpen }: LibraryGridProps) => {
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

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

  const columns = columnsForWidth(containerWidth, TILE_SIZE, GAP);
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
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
    >
      <Box sx={{ position: 'relative', height: range.totalHeight }}>
        <Box sx={{ position: 'absolute', top: range.topOffset, left: 0, right: 0 }}>
          {rows.slice(range.first, range.last + 1).map((row) => {
            const section = sections[row.section];
            if (section === undefined) return null;
            if (row.kind === 'header') {
              return (
                <Typography
                  key={`header-${String(row.section)}`}
                  variant="subtitle2"
                  sx={{ height: HEADER_HEIGHT, display: 'flex', alignItems: 'center' }}
                >
                  {section.day === null ? dictionary.library.unknownDate : section.day}
                </Typography>
              );
            }
            const tiles = section.items.slice(row.start, row.start + row.count);
            return (
              <Box
                key={`tiles-${String(row.section)}-${String(row.start)}`}
                sx={{ display: 'flex', gap: `${String(GAP)}px`, height: rowHeight }}
              >
                {tiles.map((item) => (
                  <LibraryTile key={item.fingerprint} item={item} onOpen={() => onOpen(item)} />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

interface LibraryTileProps {
  item: LibraryItem;
  onOpen: () => void;
}

const LibraryTile = ({ item, onOpen }: LibraryTileProps) => {
  const dictionary = useDictionary();

  return (
    <Box
      data-testid="library-tile"
      data-fingerprint={item.fingerprint}
      onClick={onOpen}
      sx={{
        position: 'relative',
        width: TILE_SIZE,
        height: TILE_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: item.folder.online ? 'pointer' : 'not-allowed',
        opacity: item.missing ? 0.5 : 1,
        bgcolor: 'background.default',
      }}
    >
      {item.thumbnailPath !== null ? (
        <Box
          component="img"
          loading="lazy"
          alt={item.finalName ?? item.fileName}
          src={mediaUrl(item.thumbnailPath, item.fingerprint)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Box
          data-testid="library-tile-placeholder"
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 1,
          }}
        >
          <Typography variant="caption" noWrap>{item.finalName ?? item.fileName}</Typography>
        </Box>
      )}
      {item.folder.online ? null : (
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
