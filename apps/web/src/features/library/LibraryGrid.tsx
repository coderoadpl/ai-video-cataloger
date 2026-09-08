import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Box, Checkbox, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { AspectRatioIndicator } from '../../components/ui/AspectRatioIndicator.js';
import { CloudOffIcon, FilmIcon, ImageIcon, WarningIcon } from '../../components/ui/icons.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { TileBadge } from '../../components/ui/TileBadge.js';
import {
  buildRows,
  columnsForWidth,
  gridTileRows,
  moveGridFocus,
  renderedRowIndexes,
  rowBounds,
  tileRowIndexOf,
  visibleRowRange,
  type GridMove,
  type LibraryItem,
  type LibraryOfflineReason,
} from './core/index.js';
import { LibraryTileThumbnail } from './LibraryTileThumbnail.js';
import {
  LIBRARY_SECTION_HEADER_HEIGHT,
  LIBRARY_TILE_GAP,
  LIBRARY_TILE_SIZE,
} from '../../theme.js';
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

export interface LibrarySelectionModifiers {
  shiftKey: boolean;
}

const offlineLabel = (dictionary: Dictionary, offlineReason: LibraryOfflineReason): string =>
  offlineReason === 'file-missing' ? dictionary.library.missingBadge : dictionary.library.offlineFolderBadge;

const INTERACTIVE_DESCENDANT = 'input, button, textarea, select, a[href], [contenteditable="true"]';

const fromInteractiveDescendant = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_DESCENDANT) !== null;

const MOVE_FOR_KEY: Record<string, GridMove> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

interface LibraryGridProps {
  sections: LibraryGridSection[];
  onOpen: (item: LibraryItem) => void;
  onSelect?: ((item: LibraryItem, modifiers: LibrarySelectionModifiers) => void) | undefined;
  onSelectAll?: (() => void) | undefined;
  onOpenInAnalysis: (item: LibraryItem) => void;
  selectedFingerprints?: ReadonlySet<string> | undefined;
  hiddenView?: boolean | undefined;
  onHideItem?: ((item: LibraryItem) => void) | undefined;
  onRestoreItem?: ((item: LibraryItem) => void) | undefined;
  selectable?: boolean;
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
  onHideItem,
  onRestoreItem,
  selectable = true,
}: LibraryGridProps) => {
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(INITIAL_WIDTH);
  const [viewportHeight, setViewportHeight] = useState(INITIAL_HEIGHT);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeFingerprint, setActiveFingerprint] = useState<string | null>(null);
  const tileMenu = useTileMenu();
  const tileIdPrefix = useId();

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
  const bounds = useMemo(
    () => rowBounds(rows, rowHeight, LIBRARY_SECTION_HEADER_HEIGHT),
    [rowHeight, rows],
  );
  const range = useMemo(
    () => visibleRowRange(scrollTop, viewportHeight, rowHeight, LIBRARY_SECTION_HEADER_HEIGHT, rows),
    [rowHeight, rows, scrollTop, viewportHeight],
  );
  const tileRows = useMemo(() => gridTileRows(rows, sections), [rows, sections]);
  const activeRowIndex = useMemo(() => tileRowIndexOf(tileRows, activeFingerprint), [tileRows, activeFingerprint]);
  const itemByFingerprint = useMemo(
    () => new Map(sections.flatMap((section) => section.items.map((item) => [item.fingerprint, item]))),
    [sections],
  );
  const tileDomId = useCallback(
    (fingerprint: string) => `${tileIdPrefix}-${fingerprint}`,
    [tileIdPrefix],
  );

  useEffect(() => {
    if (activeRowIndex === null) return;
    const container = containerRef.current;
    const bound = bounds[activeRowIndex];
    if (container === null || bound === undefined) return;
    if (bound.offset < container.scrollTop) container.scrollTop = bound.offset;
    else if (bound.bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bound.bottom - container.clientHeight;
    }
  }, [activeRowIndex, bounds]);

  const move = (key: string, shiftKey: boolean): void => {
    const direction = MOVE_FOR_KEY[key];
    if (direction === undefined) return;
    const next = moveGridFocus(tileRows, activeFingerprint, direction);
    if (next === null) return;
    setActiveFingerprint(next);
    if (!shiftKey || !selectable) return;
    const item = itemByFingerprint.get(next);
    if (item !== undefined) onSelect(item, { shiftKey: true });
  };

  const onGridKeyDown = (event: KeyboardEvent): void => {
    if (fromInteractiveDescendant(event.target)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectAll();
      return;
    }
    if (event.key in MOVE_FOR_KEY) {
      event.preventDefault();
      move(event.key, event.shiftKey);
      return;
    }
    const item = activeFingerprint === null ? undefined : itemByFingerprint.get(activeFingerprint);
    if (item === undefined) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(item);
      return;
    }
    if (event.key !== ' ') return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (selectable) onSelect(item, { shiftKey: false });
      return;
    }
    onOpen(item);
  };

  const tileMenuOpen = tileMenu.open;
  const openTileMenu = useCallback(
    (event: MouseEvent, item: LibraryItem) => tileMenuOpen(event, item),
    [tileMenuOpen],
  );
  const selectTile = useCallback(
    (item: LibraryItem, modifiers: LibrarySelectionModifiers) => {
      setActiveFingerprint(item.fingerprint);
      onSelect(item, modifiers);
    },
    [onSelect],
  );

  const renderedRows = useMemo(
    () => renderedRowIndexes(range, activeRowIndex),
    [activeRowIndex, range],
  );

  return (
    <Box
      ref={containerRef}
      data-testid="library-grid"
      role="listbox"
      aria-multiselectable={selectable}
      aria-label={dictionary.library.gridLabel}
      tabIndex={0}
      {...(activeFingerprint === null || activeRowIndex === null
        ? {}
        : { 'aria-activedescendant': tileDomId(activeFingerprint) })}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onGridKeyDown}
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', px: 2, pt: 1, scrollbarGutter: 'stable' }}
    >
      <Box sx={{ position: 'relative', height: range.totalHeight }}>
        {renderedRows.map((rowIndex) => {
          const row = rows[rowIndex];
          if (row === undefined) return null;
          const section = sections[row.section];
          const bound = bounds[rowIndex];
          if (section === undefined || bound === undefined) return null;
          if (row.kind === 'header') {
            return (
              <Box
                key={`header-${String(row.section)}`}
                sx={{
                  position: 'absolute',
                  top: bound.offset,
                  left: 0,
                  right: 0,
                  height: LIBRARY_SECTION_HEADER_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
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
              sx={{
                position: 'absolute',
                top: bound.offset,
                left: 0,
                right: 0,
                display: 'flex',
                gap: `${String(LIBRARY_TILE_GAP)}px`,
                height: rowHeight,
              }}
            >
              {tiles.map((item) => (
                <LibraryTile
                  key={item.fingerprint}
                  domId={tileDomId(item.fingerprint)}
                  item={item}
                  onOpen={onOpen}
                  onSelect={selectTile}
                  onContextMenu={openTileMenu}
                  selected={selectedFingerprints.has(item.fingerprint)}
                  active={item.fingerprint === activeFingerprint}
                  selectable={selectable}
                />
              ))}
            </Box>
          );
        })}
      </Box>
      <TileMenu
        controller={tileMenu}
        onOpenInAnalysis={onOpenInAnalysis}
        hiddenView={hiddenView}
        {...(onHideItem === undefined ? {} : { onHideItem })}
        {...(onRestoreItem === undefined ? {} : { onRestoreItem })}
      />
    </Box>
  );
};

export const LibraryGrid = memo(LibraryGridView);

interface LibraryTileProps {
  domId: string;
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onSelect: (item: LibraryItem, modifiers: LibrarySelectionModifiers) => void;
  onContextMenu: (event: MouseEvent, item: LibraryItem) => void;
  selected: boolean;
  active: boolean;
  selectable: boolean;
}

const LibraryTileView = ({
  domId,
  item,
  onOpen,
  onSelect,
  onContextMenu,
  selected,
  active,
  selectable,
}: LibraryTileProps) => {
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
      id={domId}
      data-testid="library-tile"
      className="library-tile"
      data-fingerprint={item.fingerprint}
      data-media={item.media}
      data-tile-active={active ? 'true' : 'false'}
      role="option"
      aria-selected={selected}
      aria-label={name}
      title={name}
      tabIndex={-1}
      onClick={(event) => {
        if (selectable && (event.metaKey || event.ctrlKey || event.shiftKey)) {
          onSelect(item, { shiftKey: event.shiftKey });
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
        ...(active ? { outline: '2px dashed', outlineColor: 'primary.main', outlineOffset: -2 } : {}),
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
        <TileBadge
          testId="library-offline-badge"
          placement="top-right"
          token="notTracked"
          icon={<CloudOffIcon />}
          label={offlineLabel(dictionary, offlineReason)}
        />
      ) : showMissingBadge ? (
        <TileBadge
          testId="library-missing-badge"
          placement="top-right"
          token="error"
          icon={<WarningIcon />}
          label={dictionary.library.missingBadge}
        />
      ) : null}
      <AspectRatioIndicator width={width} height={height} testId="library-aspect-indicator" />
      <TileBadge
        testId={isVideo ? 'library-tile-video-badge' : 'library-tile-photo-badge'}
        placement="bottom-left"
        token="notTracked"
        iconOnly
        icon={isVideo ? <FilmIcon /> : <ImageIcon />}
        label={isVideo ? dictionary.library.videoBadge : dictionary.library.photoBadge}
      />
      {selectable ? (
        <Checkbox
          checked={selected}
          slotProps={{ input: { 'aria-label': name } }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(item, { shiftKey: event.shiftKey });
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
            '.library-tile[data-tile-active="true"] &': { opacity: 1, pointerEvents: 'auto' },
          }}
        />
      ) : null}
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
