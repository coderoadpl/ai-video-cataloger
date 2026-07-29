import { project, toScreen, type Viewport } from './projection.js';

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

interface Bucket {
  cellX: number;
  cellY: number;
  items: LocatedItem[];
  sumX: number;
  sumY: number;
}

export const clusterItems = (
  items: readonly LocatedItem[],
  viewport: Viewport,
  cellPx = 56,
): MapCluster[] => {
  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const screen = toScreen(project({ lon: item.lon, lat: item.lat }), viewport);
    const cellX = Math.floor(screen.x / cellPx);
    const cellY = Math.floor(screen.y / cellPx);
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { cellX, cellY, items: [item], sumX: screen.x, sumY: screen.y });
    } else {
      bucket.items.push(item);
      bucket.sumX += screen.x;
      bucket.sumY += screen.y;
    }
  }

  return [...buckets.values()]
    .map((bucket): MapCluster => ({
      id: `${bucket.cellX}:${bucket.cellY}`,
      x: bucket.sumX / bucket.items.length,
      y: bucket.sumY / bucket.items.length,
      count: bucket.items.length,
      items: bucket.items,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};
