import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';

import { WarningIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { buildRows, columnsForWidth, visibleRowRange, type DaySection, type PhotoListItem } from './core/index.js';

const TILE_SIZE = 168;
const GAP = 8;
const HEADER_HEIGHT = 36;

interface PhotoGridProps {
  sections: DaySection[];
  selectedFingerprint: string | null;
  onSelect: (fingerprint: string) => void;
  onOpenViewer: (fingerprint: string) => void;
}

export const PhotoGrid = ({ sections, selectedFingerprint, onSelect, onOpenViewer }: PhotoGridProps) => {
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
      data-testid="photos-grid"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      sx={{ height: '100%', overflow: 'auto', position: 'relative', px: 2, pt: 1, scrollbarGutter: 'stable' }}
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
                  {section.day === null && section.label === '' ? dictionary.photos.unknownDate : section.label}
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
                  <PhotoTile
                    key={item.fingerprint}
                    item={item}
                    selected={item.fingerprint === selectedFingerprint}
                    onSelect={() => onSelect(item.fingerprint)}
                    onOpenViewer={() => onOpenViewer(item.fingerprint)}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

interface PhotoTileProps {
  item: PhotoListItem;
  selected: boolean;
  onSelect: () => void;
  onOpenViewer: () => void;
}

const PhotoTile = ({ item, selected, onSelect, onOpenViewer }: PhotoTileProps) => {
  const dictionary = useDictionary();
  const imagePath = item.gridThumbPath ?? item.thumbPath;

  return (
    <Box
      data-testid="photos-tile"
      data-fingerprint={item.fingerprint}
      onClick={onSelect}
      onDoubleClick={onOpenViewer}
      sx={{
        position: 'relative',
        width: TILE_SIZE,
        height: TILE_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        outline: selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        bgcolor: 'background.default',
      }}
    >
      {item.thumbState === 'done' && imagePath !== null ? (
        <Box
          component="img"
          loading="lazy"
          alt={item.fileName}
          src={mediaUrl(imagePath, item.fingerprint)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <PlaceholderTile testId="photos-tile-placeholder" name={item.fileName} />
      )}
      {item.sightings > 1 ? (
        <Box
          data-testid="photos-duplicate-badge"
          sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{dictionary.photos.duplicatesBadge(item.sightings)}</Typography>
        </Box>
      ) : null}
      {item.missingAt !== null ? (
        <Box
          data-testid="photos-missing-badge"
          sx={{ position: 'absolute', bottom: 4, left: 4, bgcolor: 'background.paper', px: 0.5, borderRadius: 1 }}
        >
          <Typography variant="caption">{dictionary.photos.missingBadge}</Typography>
        </Box>
      ) : null}
      {item.proxyState === 'failed' ? (
        <Tooltip title={dictionary.photos.proxyFailedTooltip}>
          <Box sx={{ position: 'absolute', top: 4, left: 4 }} data-testid="photos-proxy-failed-badge">
            <WarningIcon fontSize="small" color="warning" />
          </Box>
        </Tooltip>
      ) : null}
    </Box>
  );
};
