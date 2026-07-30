import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { CatalogLocationsOutput } from '@core/client/index.js';

import { actions } from '../../api.js';
import { filterByMedia, type MapMediaFilter } from './core/index.js';

export type CatalogLocation = CatalogLocationsOutput['locations'][number];

export interface CatalogLocationsState {
  isLoading: boolean;
  error: string | null;
  totalFiles: number;
  locatedFiles: number;
  totalPhotos: number;
  locatedPhotos: number;
  locations: CatalogLocation[];
  filteredLocations: CatalogLocation[];
  mediaFilter: MapMediaFilter;
  setMediaFilter: (filter: MapMediaFilter) => void;
  byFingerprint: (fingerprint: string) => CatalogLocation | null;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useCatalogLocations = (options: { enabled: boolean }): CatalogLocationsState => {
  const query = useQuery({ ...actions.catalogLocations, enabled: options.enabled });
  const [mediaFilter, setMediaFilter] = useState<MapMediaFilter>('all');

  const locations = useMemo(() => query.data?.locations ?? [], [query.data]);

  const byFingerprintMap = useMemo(
    () => new Map(locations.map((location) => [location.fingerprint, location] as const)),
    [locations],
  );

  const filteredLocations = useMemo(() => filterByMedia(locations, mediaFilter), [locations, mediaFilter]);

  return {
    isLoading: query.isLoading,
    error: query.error === null || query.error === undefined ? null : messageOf(query.error),
    totalFiles: query.data?.totalFiles ?? 0,
    locatedFiles: query.data?.locatedFiles ?? 0,
    totalPhotos: query.data?.totalPhotos ?? 0,
    locatedPhotos: query.data?.locatedPhotos ?? 0,
    locations,
    filteredLocations,
    mediaFilter,
    setMediaFilter,
    byFingerprint: (fingerprint) => byFingerprintMap.get(fingerprint) ?? null,
  };
};
