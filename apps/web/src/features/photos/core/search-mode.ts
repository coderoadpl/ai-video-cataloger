import type { z } from 'zod';

import type { photosSearchResultSchema } from '@core/contract/index.js';

import type { DaySection, PhotoListItem } from './day-groups.js';

export type PhotosSearchResult = z.output<typeof photosSearchResultSchema>;

export type PhotosViewMode = { kind: 'browse' } | { kind: 'search'; query: string };

export const searchResultsToItems = (results: readonly PhotosSearchResult[]): PhotoListItem[] =>
  results.map((result) => ({
    fingerprint: result.fingerprint,
    fileName: result.fileName,
    currentPath: result.currentPath,
    ext: result.ext,
    capturedAt: result.capturedAt,
    capturedAtSource: null,
    width: null,
    height: null,
    proxyState: result.proxyState,
    thumbState: result.thumbState,
    missingAt: result.missingAt,
    sightings: 1,
    thumbPath: result.thumbPath,
    proxyPath: result.proxyPath,
  }));

export const searchSections = (items: readonly PhotoListItem[], label: string): DaySection[] =>
  [{ day: null, label, items: [...items] }];
