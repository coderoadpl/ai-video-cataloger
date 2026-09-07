import { project, toScreen, worldSizePx, type UnitPoint, type Viewport } from './projection.js';

export interface LocatedItem {
  id: string;
  lon: number;
  lat: number;
}

export interface MapCluster {
  id: string;
  x: number;
  y: number;
  count: number;
  items: LocatedItem[];
}

interface ProjectedLocation {
  item: LocatedItem;
  x: number;
  y: number;
}

export interface SpatialIndexNode {
  point: ProjectedLocation;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  left: SpatialIndexNode | null;
  right: SpatialIndexNode | null;
}

export type SpatialIndex = SpatialIndexNode | null;

const buildNode = (points: ProjectedLocation[], depth: number): SpatialIndexNode | null => {
  if (points.length === 0) return null;
  const axis = depth % 2 === 0 ? 'x' : 'y';
  points.sort((left, right) => left[axis] - right[axis]);
  const middle = Math.floor(points.length / 2);
  const point = points[middle];
  if (point === undefined) return null;
  const left = buildNode(points.slice(0, middle), depth + 1);
  const right = buildNode(points.slice(middle + 1), depth + 1);
  return {
    point,
    left,
    right,
    minX: Math.min(point.x, left?.minX ?? point.x, right?.minX ?? point.x),
    maxX: Math.max(point.x, left?.maxX ?? point.x, right?.maxX ?? point.x),
    minY: Math.min(point.y, left?.minY ?? point.y, right?.minY ?? point.y),
    maxY: Math.max(point.y, left?.maxY ?? point.y, right?.maxY ?? point.y),
  };
};

export const buildSpatialIndex = (items: readonly LocatedItem[]): SpatialIndex => buildNode(
  items.map((item): ProjectedLocation => ({ item, ...project(item) })),
  0,
);

const clampToViewportRange = (
  viewport: Viewport,
  overscanPx: number,
  cellPx: number,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  const world = worldSizePx(viewport);
  const screenMin = Math.floor(-overscanPx / cellPx) * cellPx;
  const screenMaxX = Math.ceil((viewport.width + overscanPx) / cellPx) * cellPx;
  const screenMaxY = Math.ceil((viewport.height + overscanPx) / cellPx) * cellPx;
  return {
    minX: viewport.centerX + (screenMin - viewport.width / 2) / world,
    minY: viewport.centerY + (screenMin - viewport.height / 2) / world,
    maxX: viewport.centerX + (screenMaxX - viewport.width / 2) / world,
    maxY: viewport.centerY + (screenMaxY - viewport.height / 2) / world,
  };
};

export interface VisibleClustersOptions {
  cellPx?: number;
  overscanPx?: number;
}

export const visibleClusters = (
  index: SpatialIndex,
  viewport: Viewport,
  options: VisibleClustersOptions = {},
): MapCluster[] => {
  const cellPx = options.cellPx ?? 56;
  const overscanPx = options.overscanPx ?? 64;
  const { minX, minY, maxX, maxY } = clampToViewportRange(viewport, overscanPx, cellPx);
  const buckets = new Map<string, MapCluster>();

  const visit = (node: SpatialIndex): void => {
    if (node === null || node.maxX < minX || node.minX >= maxX || node.maxY < minY || node.minY >= maxY) return;
    const point = node.point;
    if (point.x >= minX && point.x < maxX && point.y >= minY && point.y < maxY) {
      const screen: UnitPoint = toScreen(point, viewport);
      const id = `${Math.floor(screen.x / cellPx)}:${Math.floor(screen.y / cellPx)}`;
      const bucket = buckets.get(id) ?? { id, x: 0, y: 0, count: 0, items: [] };
      bucket.x += screen.x;
      bucket.y += screen.y;
      bucket.count += 1;
      bucket.items.push(point.item);
      buckets.set(id, bucket);
    }
    visit(node.left);
    visit(node.right);
  };
  visit(index);

  return [...buckets.values()]
    .map((bucket): MapCluster => ({ ...bucket, x: bucket.x / bucket.count, y: bucket.y / bucket.count }))
    .filter((bucket) => bucket.x >= -overscanPx && bucket.x <= viewport.width + overscanPx
      && bucket.y >= -overscanPx && bucket.y <= viewport.height + overscanPx)
    .sort((left, right) => left.id.localeCompare(right.id));
};
