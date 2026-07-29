import { appError, haversineM, ok, type AppError, type Result } from '@core/domain/index.js';

import type { DependencyStatus, FileSystemPort, PlaceMatch, PlacesPort } from '@core/server/index.js';

interface PlacesRow {
  lat: number;
  lon: number;
  name: string;
  region: string | null;
  countryCode: string | null;
  country: string | null;
  population: number;
}

interface PlacesIndex {
  datasetId: string;
  rows: PlacesRow[];
  buckets: Map<string, number[]>;
}

const bucketKey = (lat: number, lon: number): string => `${Math.floor(lat)}|${Math.floor(lon)}`;

export interface GeoNamesPlacesAdapterDeps {
  fs: Pick<FileSystemPort, 'readTextFile' | 'exists'>;
  datasetPath: string | null;
}

export class GeoNamesPlacesAdapter implements PlacesPort {
  private index: PlacesIndex | null | undefined = undefined;

  constructor(private readonly deps: GeoNamesPlacesAdapterDeps) {}

  async dependency(): Promise<Result<DependencyStatus, AppError>> {
    const loaded = await this.loadIndex();
    if (!loaded.ok) return loaded;
    const index = loaded.value;
    const installed = index !== null;
    return ok({
      name: 'places',
      available: installed,
      version: index === null ? null : index.datasetId,
      source: installed ? 'configured' : null,
      path: this.deps.datasetPath,
      warning: installed ? undefined : 'Offline place names are not installed; run `avc models places install`.',
      installHint: 'avc models places install',
    });
  }

  async isReady(): Promise<Result<boolean, AppError>> {
    const loaded = await this.loadIndex();
    if (!loaded.ok) return loaded;
    return ok(loaded.value !== null);
  }

  async resolve(input: { lat: number; lon: number }): Promise<Result<PlaceMatch | null, AppError>> {
    const loaded = await this.loadIndex();
    if (!loaded.ok) return loaded;
    if (loaded.value === null) {
      return { ok: false, error: appError('model_not_installed', 'Offline place dataset is not installed') };
    }
    const match = nearestRow(loaded.value, input.lat, input.lon);
    if (match === null) return ok(null);
    return ok({
      name: match.name,
      region: match.region,
      country: match.country,
      countryCode: match.countryCode,
      distanceM: haversineM(input, match),
      dataset: loaded.value.datasetId,
    });
  }

  private async loadIndex(): Promise<Result<PlacesIndex | null, AppError>> {
    if (this.index !== undefined) return ok(this.index);
    if (this.deps.datasetPath === null) {
      this.index = null;
      return ok(null);
    }
    const content = await this.deps.fs.readTextFile(this.deps.datasetPath);
    if (!content.ok) return content;
    if (content.value === null) {
      this.index = null;
      return ok(null);
    }
    const parsed = parsePlacesFile(content.value);
    if (!parsed.ok) return parsed;
    this.index = parsed.value;
    return ok(parsed.value);
  }
}

const parsePlacesFile = (content: string): Result<PlacesIndex, AppError> => {
  const lines = content.split('\n').filter((line) => line.length > 0);
  const header = lines[0];
  if (header === undefined) {
    return { ok: false, error: appError('validation', 'Places dataset header is malformed') };
  }
  const headerParts = header.split('\t');
  if (headerParts.length !== 3 || headerParts[0] !== '#avc-places' || headerParts[1] !== '1') {
    return { ok: false, error: appError('validation', 'Places dataset header is malformed') };
  }
  const datasetId = headerParts[2];
  if (datasetId === undefined || datasetId.length === 0) {
    return { ok: false, error: appError('validation', 'Places dataset header is malformed') };
  }
  const rows: PlacesRow[] = [];
  const buckets = new Map<string, number[]>();
  for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    const [latText, lonText, name, regionName, countryCode, countryName, populationText] = columns;
    if (latText === undefined || lonText === undefined || name === undefined) continue;
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const row: PlacesRow = {
      lat,
      lon,
      name,
      region: regionName === undefined || regionName.length === 0 ? null : regionName,
      countryCode: countryCode === undefined || countryCode.length === 0 ? null : countryCode,
      country: countryName === undefined || countryName.length === 0 ? null : countryName,
      population: populationText === undefined ? 0 : Number(populationText) || 0,
    };
    const index = rows.length;
    rows.push(row);
    const key = bucketKey(lat, lon);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [index]);
    else bucket.push(index);
  }
  return ok({ datasetId, rows, buckets });
};

const MAX_RING_DEGREES = 5;

const nearestRow = (index: PlacesIndex, lat: number, lon: number): PlacesRow | null => {
  for (let ring = 1; ring <= MAX_RING_DEGREES; ring += 1) {
    const candidates = candidatesWithinRing(index, lat, lon, ring);
    if (candidates.length === 0) continue;
    return bestCandidate(candidates, lat, lon);
  }
  return null;
};

const candidatesWithinRing = (index: PlacesIndex, lat: number, lon: number, ring: number): PlacesRow[] => {
  const centerLat = Math.floor(lat);
  const centerLon = Math.floor(lon);
  const seen = new Set<number>();
  const result: PlacesRow[] = [];
  for (let dLat = -ring; dLat <= ring; dLat += 1) {
    for (let dLon = -ring; dLon <= ring; dLon += 1) {
      const key = `${centerLat + dLat}|${centerLon + dLon}`;
      const bucket = index.buckets.get(key);
      if (bucket === undefined) continue;
      for (const rowIndex of bucket) {
        if (seen.has(rowIndex)) continue;
        seen.add(rowIndex);
        const row = index.rows[rowIndex];
        if (row !== undefined) result.push(row);
      }
    }
  }
  return result;
};

const bestCandidate = (candidates: readonly PlacesRow[], lat: number, lon: number): PlacesRow => {
  let best = candidates[0];
  if (best === undefined) throw new Error('bestCandidate called with no candidates');
  let bestDistance = haversineM({ lat, lon }, best);
  for (const candidate of candidates.slice(1)) {
    const distance = haversineM({ lat, lon }, candidate);
    if (
      distance < bestDistance
      || (distance === bestDistance && candidate.population > best.population)
      || (distance === bestDistance && candidate.population === best.population && candidate.name.localeCompare(best.name) < 0)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};
