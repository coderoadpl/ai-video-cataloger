import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { CatalogLocationsOutput } from '@core/client/index.js';

import { actions } from '../../api.js';

export type CatalogLocation = CatalogLocationsOutput['locations'][number];

export interface CatalogLocationsState {
  isLoading: boolean;
  error: string | null;
  totalFiles: number;
  locatedFiles: number;
  locations: CatalogLocation[];
  byFingerprint: (fingerprint: string) => CatalogLocation | null;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useCatalogLocations = (options: { enabled: boolean }): CatalogLocationsState => {
  const query = useQuery({ ...actions.catalogLocations, enabled: options.enabled });

  const byFingerprintMap = useMemo(
    () => new Map(query.data?.locations.map((location) => [location.fingerprint, location] as const) ?? []),
    [query.data],
  );

  return {
    isLoading: query.isLoading,
    error: query.error === null || query.error === undefined ? null : messageOf(query.error),
    totalFiles: query.data?.totalFiles ?? 0,
    locatedFiles: query.data?.locatedFiles ?? 0,
    locations: query.data?.locations ?? [],
    byFingerprint: (fingerprint) => byFingerprintMap.get(fingerprint) ?? null,
  };
};
