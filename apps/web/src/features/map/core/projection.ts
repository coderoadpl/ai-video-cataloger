export interface LonLat {
  lon: number;
  lat: number;
}

export interface UnitPoint {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  centerX: number;
  centerY: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MAX_MERCATOR_LAT = 85.05112878;
export const MIN_SCALE = 1;
export const MAX_SCALE = 4096;
const SINGLE_POINT_SCALE_CAP = 64;

const clampLat = (lat: number): number => Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const project = ({ lon, lat }: LonLat): UnitPoint => {
  const clampedLat = clampLat(lat);
  const x = (lon + 180) / 360;
  const phi = (clampedLat * Math.PI) / 180;
  const y = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
  return { x, y };
};

export const unproject = ({ x, y }: UnitPoint): LonLat => {
  const lon = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lon, lat };
};

const size = (viewport: Pick<Viewport, 'width' | 'height'>): number => Math.min(viewport.width, viewport.height);

export const worldSizePx = (viewport: Viewport): number => viewport.scale * size(viewport);

export const toScreen = (point: UnitPoint, viewport: Viewport): UnitPoint => ({
  x: (point.x - viewport.centerX) * viewport.scale * size(viewport) + viewport.width / 2,
  y: (point.y - viewport.centerY) * viewport.scale * size(viewport) + viewport.height / 2,
});

export const unitBounds = (points: readonly UnitPoint[]): Bounds | null => {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

export const fitViewport = (bounds: Bounds | null, width: number, height: number, paddingPx: number): Viewport => {
  if (bounds === null) return { width, height, scale: MIN_SCALE, centerX: 0.5, centerY: 0.5 };

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const shorterSide = Math.min(width, height);
  const availablePx = Math.max(1, shorterSide - paddingPx * 2);

  if (spanX === 0 && spanY === 0) {
    return { width, height, scale: SINGLE_POINT_SCALE_CAP, centerX, centerY };
  }

  const scaleForSpan = (span: number): number => (span === 0 ? Number.POSITIVE_INFINITY : availablePx / (span * shorterSide));
  const scale = clamp(Math.min(scaleForSpan(spanX), scaleForSpan(spanY)), MIN_SCALE, MAX_SCALE);

  return { width, height, scale, centerX, centerY };
};

export const zoomViewport = (viewport: Viewport, factor: number, anchor?: UnitPoint): Viewport => {
  const nextScale = clamp(viewport.scale * factor, MIN_SCALE, MAX_SCALE);
  if (anchor === undefined) return { ...viewport, scale: nextScale };

  const appliedFactor = nextScale / viewport.scale;
  const centerX = anchor.x - (anchor.x - viewport.centerX) / appliedFactor;
  const centerY = anchor.y - (anchor.y - viewport.centerY) / appliedFactor;
  return { ...viewport, scale: nextScale, centerX, centerY };
};

export const panViewport = (viewport: Viewport, dxPx: number, dyPx: number): Viewport => {
  const worldSize = viewport.scale * size(viewport);
  const centerX = clamp(viewport.centerX - dxPx / worldSize, 0, 1);
  const centerY = clamp(viewport.centerY - dyPx / worldSize, 0, 1);
  return { ...viewport, centerX, centerY };
};
