import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, useTheme } from '@mui/material';

import basemap from './basemap/land-110m.json' with { type: 'json' };
import { clusterItems, fitViewport, panViewport, project, toScreen, unitBounds, unwrapRing, worldSizePx, zoomViewport, type MapCluster, type Viewport } from './core/index.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { MapPinPopover } from './MapPinPopover.js';
import type { CatalogLocation } from './use-catalog-locations.js';
import { AddIcon, RemoveIcon, RestartAltIcon } from '../../components/ui/icons.js';

const FALLBACK_SIZE = { width: 800, height: 600 };
const VIEWPORT_PADDING_PX = 40;
const PAN_STEP_PX = 48;
const ZOOM_FACTOR = 2;

interface MapCanvasProps {
  locations: CatalogLocation[];
  focusFingerprint: string | null;
  onFocusConsumed: () => void;
  onOpenPreview: (location: CatalogLocation) => void;
  onOpenPhoto: (fingerprint: string) => void;
  initialViewport?: Viewport | undefined;
}

const landRings = basemap.polygons.map(unwrapRing);

const worldCopyOffsetsPx = (viewport: Viewport): number[] => {
  const world = worldSizePx(viewport);
  return [-world, 0, world];
};

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('button') !== null;

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

const metersPerPixel = (viewport: Viewport, lat: number): number => {
  const world = worldSizePx(viewport);
  if (world <= 0) return 1;
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / world;
};

const graticuleLines = (viewport: Viewport): { x1: number; y1: number; x2: number; y2: number }[] => {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let lon = -180; lon <= 180; lon += 30) {
    const top = toScreen(project({ lon, lat: 85 }), viewport);
    const bottom = toScreen(project({ lon, lat: -85 }), viewport);
    lines.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const left = toScreen(project({ lon: -180, lat }), viewport);
    const right = toScreen(project({ lon: 180, lat }), viewport);
    lines.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
  }
  return lines;
};

export const MapCanvas = ({
  locations,
  focusFingerprint,
  onFocusConsumed,
  onOpenPreview,
  onOpenPhoto,
  initialViewport,
}: MapCanvasProps) => {
  const theme = useTheme();
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinRefs = useRef(new Map<string, HTMLButtonElement>());
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [viewport, setViewport] = useState<Viewport>(
    initialViewport ?? fitViewport(unitBounds(locations.map((location) => project(location))), size.width, size.height, VIEWPORT_PADDING_PX),
  );
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const dragState = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : FALLBACK_SIZE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setViewport((current) => ({ ...current, width: size.width, height: size.height }));
  }, [size]);

  useEffect(() => {
    if (focusFingerprint === null) return;
    const target = locations.find((location) => location.fingerprint === focusFingerprint);
    if (target === undefined) return;
    const bounds = unitBounds([project(target)]);
    setViewport(fitViewport(bounds, size.width, size.height, VIEWPORT_PADDING_PX));
    setSelectedFingerprint(focusFingerprint);
    onFocusConsumed();
  }, [focusFingerprint, locations, size.width, size.height, onFocusConsumed]);

  const clusters = useMemo(
    () => clusterItems(locations.map((location) => ({ id: location.fingerprint, lon: location.lon, lat: location.lat })), viewport),
    [locations, viewport],
  );

  const byFingerprint = useMemo(() => new Map(locations.map((location) => [location.fingerprint, location] as const)), [locations]);

  const zoomAtCenter = useCallback((factor: number) => {
    setViewport((current) => zoomViewport(current, factor, { x: current.centerX, y: current.centerY }));
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtCenter(event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [zoomAtCenter]);

  const resetView = useCallback(() => {
    setViewport(fitViewport(unitBounds(locations.map((location) => project(location))), size.width, size.height, VIEWPORT_PADDING_PX));
  }, [locations, size]);

  const handleClusterClick = (cluster: MapCluster) => {
    const centroid = {
      lon: cluster.items.reduce((sum, item) => sum + item.lon, 0) / cluster.items.length,
      lat: cluster.items.reduce((sum, item) => sum + item.lat, 0) / cluster.items.length,
    };
    setViewport((current) => zoomViewport(current, ZOOM_FACTOR, project(centroid)));
  };

  const selectedLocation = selectedFingerprint === null ? null : byFingerprint.get(selectedFingerprint) ?? null;

  return (
    <Box
      ref={containerRef}
      role="group"
      tabIndex={0}
      aria-label={dictionary.map.canvasLabel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setViewport((current) => panViewport(current, -PAN_STEP_PX, 0));
        else if (event.key === 'ArrowRight') setViewport((current) => panViewport(current, PAN_STEP_PX, 0));
        else if (event.key === 'ArrowUp') setViewport((current) => panViewport(current, 0, -PAN_STEP_PX));
        else if (event.key === 'ArrowDown') setViewport((current) => panViewport(current, 0, PAN_STEP_PX));
        else if (event.key === '+' || event.key === '=') zoomAtCenter(ZOOM_FACTOR);
        else if (event.key === '-') zoomAtCenter(1 / ZOOM_FACTOR);
      }}
      onPointerDown={(event) => {
        if (isControlTarget(event.target)) return;
        dragState.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragState.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        dragState.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
        setViewport((current) => panViewport(current, dx, dy));
      }}
      onPointerUp={(event) => {
        if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
      }}
      sx={{ position: 'relative', flex: 1, minHeight: 320, outline: 'none', overflow: 'hidden', touchAction: 'none' }}
      data-testid="map-canvas"
    >
      <Box
        component="svg"
        aria-hidden="true"
        width={size.width}
        height={size.height}
        sx={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <rect x={0} y={0} width={size.width} height={size.height} fill={theme.palette.map.canvas} />
        {graticuleLines(viewport).map((line) => (
          <line
            key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={theme.palette.map.graticule}
            strokeWidth={1}
          />
        ))}
        {worldCopyOffsetsPx(viewport).map((offsetPx) => (
          <g key={offsetPx} transform={`translate(${offsetPx} 0)`}>
            {landRings.map((ring, index) => (
              <polygon
                key={index}
                points={ring
                  .map(([lon, lat]) => toScreen(project({ lon: lon ?? 0, lat: lat ?? 0 }), viewport))
                  .map((point) => `${point.x},${point.y}`)
                  .join(' ')}
                fill={theme.palette.map.land}
                stroke={theme.palette.map.landBorder}
                strokeWidth={0.5}
              />
            ))}
          </g>
        ))}
      </Box>

      {clusters.map((cluster) => {
        if (cluster.count === 1) {
          const item = cluster.items[0];
          const location = item === undefined ? null : byFingerprint.get(item.id) ?? null;
          if (location === null) return null;
          const approximate = location.source !== null && location.source !== 'camera';
          const isPhoto = location.media === 'photo';
          const haloRadiusPx = approximate
            ? Math.min(64, Math.max(6, (location.accuracyM ?? 0) / metersPerPixel(viewport, location.lat)))
            : 0;
          return (
            <Box key={cluster.id} sx={{ position: 'absolute', left: cluster.x, top: cluster.y }}>
              {approximate && (
                <Box
                  aria-hidden="true"
                  data-testid="map-pin-accuracy-halo"
                  sx={{
                    position: 'absolute',
                    left: -haloRadiusPx,
                    top: -haloRadiusPx,
                    width: haloRadiusPx * 2,
                    height: haloRadiusPx * 2,
                    borderRadius: '50%',
                    bgcolor: isPhoto ? theme.palette.map.pinPhotoHalo : theme.palette.map.pinApproximateHalo,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <ButtonBase
                ref={(node) => {
                  if (node === null) pinRefs.current.delete(location.fingerprint);
                  else pinRefs.current.set(location.fingerprint, node);
                }}
                data-testid="map-pin"
                data-approximate={approximate}
                data-media={location.media}
                aria-label={location.finalName ?? location.fileName}
                onClick={() => setSelectedFingerprint(location.fingerprint)}
                sx={{
                  position: 'absolute',
                  left: -8,
                  top: -16,
                  width: 16,
                  height: 16,
                  borderRadius: isPhoto ? '3px' : approximate ? '50%' : '50% 50% 50% 0',
                  transform: isPhoto || approximate ? undefined : 'rotate(-45deg)',
                  border: approximate
                    ? `2px solid ${isPhoto ? theme.palette.map.pinPhoto : theme.palette.map.pinApproximate}`
                    : undefined,
                  bgcolor: approximate
                    ? 'transparent'
                    : isPhoto
                      ? theme.palette.map.pinPhoto
                      : location.folder.online && !location.missing ? theme.palette.map.pin : theme.palette.map.pinMuted,
                }}
              />
            </Box>
          );
        }
        const clusterHasApproximate = cluster.items.some((item) => {
          const location = byFingerprint.get(item.id);
          return location !== undefined && location.source !== null && location.source !== 'camera';
        });
        return (
          <ButtonBase
            key={cluster.id}
            data-testid="map-cluster"
            data-approximate={clusterHasApproximate}
            aria-label={dictionary.map.clusterLabel(cluster.count)}
            onClick={() => handleClusterClick(cluster)}
            sx={{
              position: 'absolute',
              left: cluster.x - 16,
              top: cluster.y - 16,
              width: 32,
              height: 32,
              borderRadius: '50%',
              bgcolor: clusterHasApproximate ? 'transparent' : theme.palette.map.cluster,
              border: clusterHasApproximate ? `2px solid ${theme.palette.map.pinApproximate}` : undefined,
              color: clusterHasApproximate ? theme.palette.map.pinApproximate : theme.palette.map.clusterText,
              fontSize: '0.75rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {cluster.count}
          </ButtonBase>
        );
      })}

      <MapPinPopover
        anchorEl={selectedFingerprint === null ? null : pinRefs.current.get(selectedFingerprint) ?? null}
        location={selectedLocation}
        onClose={() => setSelectedFingerprint(null)}
        onOpenPreview={onOpenPreview}
        onOpenPhoto={onOpenPhoto}
      />

      <Box sx={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <IconButton
          size="small"
          aria-label={dictionary.map.zoomIn}
          data-testid="map-zoom-in"
          onClick={() => zoomAtCenter(ZOOM_FACTOR)}
        >
          <AddIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={dictionary.map.zoomOut}
          data-testid="map-zoom-out"
          onClick={() => zoomAtCenter(1 / ZOOM_FACTOR)}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={dictionary.map.resetView}
          data-testid="map-reset"
          onClick={resetView}
        >
          <RestartAltIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};
