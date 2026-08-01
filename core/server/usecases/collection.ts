import { z } from 'zod';

import { appError, ok, type AppError, type CatalogPlace, type PhotoExtension, type Result } from '@core/domain/index.js';

import type {
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogSearchSort,
  FileSystemPort,
  GlobalCatalogStore,
  MediaPort,
  PhotoSearchRow,
  PhotosStore,
} from '../ports.js';
import { photoArtifactsRoot, photoGridThumbPath, photoProxyPath, photoThumbPath } from './photo-artifacts.js';
import { buildSearchMatch, resolveGridThumbnailPath, resolveThumbnailPath, sanitizeSearchQuery, type SearchDeps } from './search.js';

export interface CollectionDeps {
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  fs: FileSystemPort;
  media: MediaPort;
}

export interface CollectionFiltersInput {
  tags: string[];
  people: string[];
  place: string | null;
  from: string | null;
  to: string | null;
  hasGps: boolean | null;
  folderId: string | null;
}

export type CollectionMedia = 'all' | 'video' | 'photo';

export interface CollectionInput {
  query: string | null;
  filters: CollectionFiltersInput;
  sort: CatalogSearchSort | undefined;
  media: CollectionMedia;
  limit: number;
  cursor: string | null;
}

export interface CollectionVideoItem {
  media: 'video';
  fingerprint: string;
  variantCount: number;
  fileName: string;
  finalName: string | null;
  description: string | null;
  snippet: string;
  thumbnailPath: string | null;
  gridThumbnailPath: string | null;
  tags: string[];
  folder: { folderId: string; currentPath: string; displayName: string; online: boolean };
  gps: { lat: number; lon: number } | null;
  missing: boolean;
  capturedAt: string | null;
  place: CatalogPlace | null;
}

export interface CollectionPhotoItem {
  media: 'photo';
  fingerprint: string;
  fileName: string;
  currentPath: string;
  ext: PhotoExtension;
  capturedAt: string | null;
  description: string | null;
  snippet: string;
  tags: string[];
  variantCount: number;
  missingAt: number | null;
  thumbPath: string | null;
  gridThumbPath: string | null;
  proxyPath: string | null;
}

export type CollectionItem = CollectionVideoItem | CollectionPhotoItem;

export interface CollectionOutput {
  query: string | null;
  media: CollectionMedia;
  limit: number;
  total: number;
  videoTotal: number;
  photoTotal: number;
  count: number;
  items: CollectionItem[];
  nextCursor: string | null;
}

const collectionCursorSchema = z.object({
  v: z.literal(1),
  video: z.number().int().nonnegative(),
  photo: z.number().int().nonnegative(),
});

type CollectionCursor = z.output<typeof collectionCursorSchema>;

export const encodeCollectionCursor = (cursor: CollectionCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCollectionCursor = (encoded: string): Result<CollectionCursor, AppError> => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: appError('validation', 'Invalid collection cursor') };
  }
  const parsed = collectionCursorSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, error: appError('validation', 'Invalid collection cursor') };
  return ok(parsed.data);
};

export type CollectionSortKey = Exclude<CatalogSearchSort, 'relevance'>;

interface ComparableItem {
  media: 'video' | 'photo';
  capturedAt: string | null;
  displayName: string;
  fingerprint: string;
}

export const compareCollectionItems = (
  sort: CollectionSortKey,
  left: ComparableItem,
  right: ComparableItem,
): number => {
  const tieBreak = (): number => {
    if (left.media !== right.media) return left.media === 'video' ? -1 : 1;
    return left.fingerprint.localeCompare(right.fingerprint);
  };
  switch (sort) {
    case 'captured_desc':
      return capturedAtCompare(left.capturedAt, right.capturedAt, -1) || tieBreak();
    case 'captured_asc':
      return capturedAtCompare(left.capturedAt, right.capturedAt, 1) || tieBreak();
    case 'name_asc':
      return left.displayName.localeCompare(right.displayName) || tieBreak();
  }
};

const capturedAtCompare = (left: string | null, right: string | null, direction: 1 | -1): number => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * left.localeCompare(right);
};

const resolveSort = (requested: CatalogSearchSort | undefined, hasQuery: boolean): CatalogSearchSort =>
  requested ?? (hasQuery ? 'relevance' : 'captured_desc');

const videoOnlyFiltersActive = (filters: CollectionFiltersInput): boolean =>
  filters.people.length > 0 || filters.place !== null || filters.hasGps !== null || filters.folderId !== null;

export const libraryCollection = async (
  deps: CollectionDeps,
  input: CollectionInput,
): Promise<Result<CollectionOutput, AppError>> => {
  const sort = resolveSort(input.sort, input.query !== null);
  if (sort === 'relevance' && input.query === null) {
    return { ok: false, error: appError('validation', "Sort 'relevance' requires a query") };
  }

  const cursor: Result<CollectionCursor, AppError> = input.cursor === null
    ? ok({ v: 1, video: 0, photo: 0 })
    : decodeCollectionCursor(input.cursor);
  if (!cursor.ok) return cursor;

  const videoEnabled = input.media !== 'photo';
  const photoEnabled = input.media !== 'video' && !videoOnlyFiltersActive(input.filters);

  let videoMatch: string | null = null;
  let videoRankingTerms: string[] = [];
  let photoMatch: string | null = null;
  let photoRankingTerms: string[] = [];

  if (input.query !== null) {
    const sanitized = sanitizeSearchQuery(input.query);
    if (!sanitized.ok) return sanitized;

    if (videoEnabled) {
      const videoExpansions = await deps.globalCatalog.expandTagTerms([...sanitized.value.rankingTerms, ...input.filters.tags]);
      if (!videoExpansions.ok) return videoExpansions;
      const videoEquivalents = new Map(videoExpansions.value.map((entry) => [entry.term, entry.equivalents]));
      videoMatch = buildSearchMatch(sanitized.value.parts, videoEquivalents);
      videoRankingTerms = sanitized.value.rankingTerms;
    }
    if (photoEnabled) {
      const photoExpansions = await deps.photos.expandPhotoTagTerms([...sanitized.value.rankingTerms, ...input.filters.tags]);
      if (!photoExpansions.ok) return photoExpansions;
      const photoEquivalents = new Map(photoExpansions.value.map((entry) => [entry.term, entry.equivalents]));
      photoMatch = buildSearchMatch(sanitized.value.parts, photoEquivalents);
      photoRankingTerms = sanitized.value.rankingTerms;
    }
  }

  const videoTagTermSets = await tagTermSetsFor(deps, 'video', input.filters.tags, videoEnabled);
  if (!videoTagTermSets.ok) return videoTagTermSets;
  const photoTagTermSets = await tagTermSetsFor(deps, 'photo', input.filters.tags, photoEnabled);
  if (!photoTagTermSets.ok) return photoTagTermSets;

  const emptyVideoPage: { total: number; rows: CatalogSearchRow[] } = { total: 0, rows: [] };
  const videoPage = videoEnabled
    ? await fetchVideoPage(deps, {
      match: videoMatch,
      rankingTerms: videoRankingTerms,
      filters: input.filters,
      tagTermSets: videoTagTermSets.value,
      sort,
      limit: input.limit,
      offset: cursor.value.video,
    })
    : ok(emptyVideoPage);
  if (!videoPage.ok) return videoPage;

  const emptyPhotoPage: { total: number; rows: PhotoSearchRow[] } = { total: 0, rows: [] };
  const photoPage = photoEnabled
    ? await deps.photos.collectionPage({
      match: photoMatch,
      rankingTerms: photoRankingTerms,
      from: input.filters.from,
      to: input.filters.to,
      tagTermSets: photoTagTermSets.value,
      sort,
      limit: input.limit,
      offset: cursor.value.photo,
    })
    : ok(emptyPhotoPage);
  if (!photoPage.ok) return photoPage;

  const merged = await mergePage(deps, {
    videoRows: videoPage.value.rows,
    photoRows: photoPage.value.rows,
    limit: input.limit,
    sort,
    videoOffset: cursor.value.video,
    photoOffset: cursor.value.photo,
  });
  if (!merged.ok) return merged;

  const nextVideoOffset = cursor.value.video + merged.value.videoConsumed;
  const nextPhotoOffset = cursor.value.photo + merged.value.photoConsumed;
  const videoExhausted = !videoEnabled || nextVideoOffset >= videoPage.value.total;
  const photoExhausted = !photoEnabled || nextPhotoOffset >= photoPage.value.total;
  const nextCursor = videoExhausted && photoExhausted
    ? null
    : encodeCollectionCursor({ v: 1, video: nextVideoOffset, photo: nextPhotoOffset });

  return ok({
    query: input.query,
    media: input.media,
    limit: input.limit,
    total: videoPage.value.total + photoPage.value.total,
    videoTotal: videoPage.value.total,
    photoTotal: photoPage.value.total,
    count: merged.value.items.length,
    items: merged.value.items,
    nextCursor,
  });
};

const tagTermSetsFor = async (
  deps: CollectionDeps,
  media: 'video' | 'photo',
  tags: readonly string[],
  enabled: boolean,
): Promise<Result<string[][], AppError>> => {
  if (!enabled || tags.length === 0) return ok([]);
  const expansions = media === 'video'
    ? await deps.globalCatalog.expandTagTerms(tags)
    : await deps.photos.expandPhotoTagTerms(tags);
  if (!expansions.ok) return expansions;
  const equivalents = new Map(expansions.value.map((entry) => [entry.term, entry.equivalents]));
  return ok(tags.map((tag) => [tag, ...(equivalents.get(tag) ?? [])]));
};

const fetchVideoPage = async (
  deps: CollectionDeps,
  input: {
    match: string | null;
    rankingTerms: string[];
    filters: CollectionFiltersInput;
    tagTermSets: string[][];
    sort: CatalogSearchSort;
    limit: number;
    offset: number;
  },
): Promise<Result<{ total: number; rows: CatalogSearchRow[] }, AppError>> => {
  const searched: CatalogSearchInput = {
    match: input.match,
    rankingTerms: input.rankingTerms,
    filters: {
      tagTermSets: input.tagTermSets,
      personIds: input.filters.people,
      place: input.filters.place,
      capturedFrom: input.filters.from,
      capturedTo: input.filters.to,
      hasGps: input.filters.hasGps,
      folderId: input.filters.folderId,
    },
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
  };
  return deps.globalCatalog.search(searched);
};

const mergePage = async (
  deps: CollectionDeps,
  input: {
    videoRows: CatalogSearchRow[];
    photoRows: PhotoSearchRow[];
    limit: number;
    sort: CatalogSearchSort;
    videoOffset: number;
    photoOffset: number;
  },
): Promise<Result<{ items: CollectionItem[]; videoConsumed: number; photoConsumed: number }, AppError>> => {
  let videoIndex = 0;
  let photoIndex = 0;
  const items: CollectionItem[] = [];

  while (items.length < input.limit && (videoIndex < input.videoRows.length || photoIndex < input.photoRows.length)) {
    const videoRow = input.videoRows[videoIndex];
    const photoRow = input.photoRows[photoIndex];
    const pickVideo = videoRow !== undefined && (
      photoRow === undefined
      || (input.sort === 'relevance'
        ? (input.videoOffset + videoIndex) <= (input.photoOffset + photoIndex)
        : compareCollectionItems(
          input.sort,
          { media: 'video', capturedAt: videoRow.capturedAt, displayName: videoRow.finalName ?? videoRow.fileName, fingerprint: videoRow.fingerprint },
          { media: 'photo', capturedAt: photoRow.capturedAt, displayName: photoRow.fileName, fingerprint: photoRow.fingerprint },
        ) <= 0)
    );
    if (pickVideo && videoRow !== undefined) {
      const item = await videoItemFrom(deps, videoRow);
      if (!item.ok) return item;
      items.push(item.value);
      videoIndex += 1;
      continue;
    }
    if (photoRow !== undefined) {
      const item = await photoItemFrom(deps, photoRow);
      if (!item.ok) return item;
      items.push(item.value);
      photoIndex += 1;
    }
  }

  return ok({ items, videoConsumed: videoIndex, photoConsumed: photoIndex });
};

const searchDepsFrom = (deps: CollectionDeps): SearchDeps => ({ globalCatalog: deps.globalCatalog, fs: deps.fs, media: deps.media });

const videoItemFrom = async (deps: CollectionDeps, row: CatalogSearchRow): Promise<Result<CollectionVideoItem, AppError>> => {
  const searchDeps = searchDepsFrom(deps);
  const online = await deps.fs.exists(row.folder.currentPath);
  if (!online.ok) return online;
  const thumbnailPath = await resolveThumbnailPath(searchDeps, row, online.value, 'existing');
  if (!thumbnailPath.ok) return thumbnailPath;
  const gridThumbnailPath = await resolveGridThumbnailPath(searchDeps, row, online.value, 'existing');
  if (!gridThumbnailPath.ok) return gridThumbnailPath;
  return ok({
    media: 'video',
    fingerprint: row.fingerprint,
    variantCount: row.variantCount,
    fileName: row.fileName,
    finalName: row.finalName,
    description: row.description,
    snippet: row.snippet,
    thumbnailPath: thumbnailPath.value,
    gridThumbnailPath: gridThumbnailPath.value,
    tags: row.tags,
    folder: {
      folderId: row.folder.folderId,
      currentPath: row.folder.currentPath,
      displayName: row.folder.displayName,
      online: online.value,
    },
    gps: row.gps,
    missing: row.missing,
    capturedAt: row.capturedAt,
    place: row.place,
  });
};

const photoItemFrom = async (deps: CollectionDeps, row: PhotoSearchRow): Promise<Result<CollectionPhotoItem, AppError>> => {
  const artifactsRoot = photoArtifactsRoot(deps.fs, deps.photos);
  const gridThumbPath = photoGridThumbPath(deps.fs, artifactsRoot, row.fingerprint);
  const gridExists = await deps.fs.exists(gridThumbPath);
  if (!gridExists.ok) return gridExists;
  return ok({
    media: 'photo',
    fingerprint: row.fingerprint,
    fileName: row.fileName,
    currentPath: row.currentPath,
    ext: row.ext,
    capturedAt: row.capturedAt,
    description: row.description,
    snippet: row.snippet,
    tags: row.tags,
    variantCount: row.variantCount,
    missingAt: row.missingAt,
    thumbPath: row.thumbState === 'done' ? photoThumbPath(deps.fs, artifactsRoot, row.fingerprint) : null,
    gridThumbPath: gridExists.value ? gridThumbPath : null,
    proxyPath: row.proxyState === 'done' ? photoProxyPath(deps.fs, artifactsRoot, row.fingerprint) : null,
  });
};
