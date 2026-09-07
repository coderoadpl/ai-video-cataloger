import { describe, expect, it } from 'vitest';

import { buildSpatialIndex, visibleClusters, type LocatedItem } from './cluster.js';
import { fitViewport, project, unitBounds, zoomViewport } from './projection.js';

const baseViewport = { width: 800, height: 600, scale: 512, centerX: 0.5, centerY: 0.5 };

const clusterItems = (items: readonly LocatedItem[], viewport: typeof baseViewport) =>
  visibleClusters(buildSpatialIndex(items), viewport);

describe('visibleClusters', () => {
  it('merges two nearby points into one cluster at their centroid', () => {
    const items: LocatedItem[] = [
      { id: 'a', lon: 0, lat: 0 },
      { id: 'b', lon: 0.0001, lat: 0 },
    ];

    const clusters = clusterItems(items, baseViewport);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[0]?.items.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('separates the same two points once zoomed far enough apart', () => {
    const items: LocatedItem[] = [
      { id: 'a', lon: 0, lat: 0 },
      { id: 'b', lon: 0.01, lat: 0 },
    ];

    const zoomedViewport = zoomViewport(baseViewport, 64);
    const clusters = clusterItems(items, zoomedViewport);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.count === 1)).toBe(true);
  });

  it('produces deterministic ids and order across two calls', () => {
    const items: LocatedItem[] = [
      { id: 'a', lon: -30, lat: 10 },
      { id: 'b', lon: 40, lat: -20 },
      { id: 'c', lon: 100, lat: 60 },
    ];

    const viewport = fitViewport(unitBounds(items.map((item) => project(item))), 800, 600, 40);
    const first = clusterItems(items, viewport);
    const second = clusterItems(items, viewport);

    expect(first).not.toEqual([]);
    expect(first.map((cluster) => cluster.id)).toEqual(second.map((cluster) => cluster.id));
    expect(first.map((cluster) => cluster.id)).toEqual([...first.map((cluster) => cluster.id)].sort());
  });

  it('loses no item and double-counts none across a continent-spread set', () => {
    const items: LocatedItem[] = Array.from({ length: 110 }, (_, index) => ({
      id: `item-${index}`,
      lon: -20 + (index % 20) * 4,
      lat: 30 + Math.floor(index / 20) * 3,
    }));

    const bounds = unitBounds(items.map((item) => project(item)));
    const viewport = fitViewport(bounds, 1200, 800, 40);
    const clusters = clusterItems(items, viewport);

    expect(clusters.length).toBeLessThan(110);
    expect(clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(110);
    const allIds = clusters.flatMap((cluster) => cluster.items.map((item) => item.id));
    expect(new Set(allIds).size).toBe(110);
  });

  it('excludes points well outside the viewport once panned far away', () => {
    const items: LocatedItem[] = [
      { id: 'near', lon: 0, lat: 0 },
      { id: 'far', lon: 170, lat: 80 },
    ];

    const index = buildSpatialIndex(items);
    const clusters = visibleClusters(index, zoomViewport(baseViewport, 4));

    const allIds = clusters.flatMap((cluster) => cluster.items.map((item) => item.id));
    expect(allIds).toContain('near');
    expect(allIds).not.toContain('far');
  });
});
