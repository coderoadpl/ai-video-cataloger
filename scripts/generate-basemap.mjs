import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-110m.json' with { type: 'json' };

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/web/src/features/map/basemap/land-110m.json',
);

const roundRing = (ring) => ring.map(([lon, lat]) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);

const ringsOf = (geometry) => {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
};

const collection = feature(topology, topology.objects.land);
const geometries = collection.type === 'FeatureCollection' ? collection.features.map((f) => f.geometry) : [collection.geometry];

const polygons = geometries
  .flatMap((geometry) => (geometry === null ? [] : ringsOf(geometry)))
  .map(roundRing)
  .filter((ring) => ring.length >= 3);

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify({ polygons }), 'utf8');

console.log(`Wrote ${polygons.length} polygon rings to ${OUTPUT_PATH}`);
