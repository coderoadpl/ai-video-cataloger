import { z } from 'zod';

import { appError, compareUtf8Bytes, derivedFolderId, ok, type AppError, type CatalogPlace, type PhotoExtension, type Result } from '@core/domain/index.js';

import type {
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogSearchSort,
  CollectionRowAnchor,
  FileSystemPort,
  GlobalCatalogStore,
  MediaPort,
  PhotoSearchRow,
  PhotosStore,
} from '../ports.js';
import { photoArtifactsRoot, photoGridThumbPath, photoProxyPath, photoThumbPath } from './photo-artifacts.js';
import { buildSearchMatch, resolveGridThumbnailPath, resolveOfflineReason, resolveThumbnailPath, sanitizeSearchQuery, type SearchDeps } from './search.js';
import type { OfflineReason } from './shared.js';

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
  hideUnavailable: boolean;
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
  folder: { folderId: string; currentPath: string; displayName: string; online: boolean; offlineReason: OfflineReason | null };
  gps: { lat: number; lon: number } | null;
  missing: boolean;
  capturedAt: string | null;
  place: CatalogPlace | null;
  width: number | null;
  height: number | null;
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
  mediaTotals: { all: number; video: number; photo: number };
  count: number;
  items: CollectionItem[];
  nextCursor: string | null;
}

const collectionAnchorSchema = z.object({
  capturedAt: z.string().nullable(),
  fileName: z.string(),
  displayName: z.string(),
  fingerprint: z.string(),
}).strict();

const collectionCursorSchema = z.object({
  v: z.literal(2),
  video: z.number().int().nonnegative(),
  photo: z.number().int().nonnegative(),
  videoAfter: collectionAnchorSchema.nullable(),
  photoAfter: collectionAnchorSchema.nullable(),
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
  fileName: string;
  fingerprint: string;
}

export const compareCollectionItems = (
  sort: CollectionSortKey,
  left: ComparableItem,
  right: ComparableItem,
): number => {
  const tieBreak = (): number => {
    if (left.media !== right.media) return left.media === 'video' ? -1 : 1;
    return compareUtf8Bytes(left.fingerprint, right.fingerprint);
  };
  const nameTieBreak = (): number => compareUtf8Bytes(left.fileName, right.fileName) || tieBreak();
  switch (sort) {
    case 'captured_desc':
      return capturedAtCompare(left.capturedAt, right.capturedAt, -1) || nameTieBreak();
    case 'captured_asc':
      return capturedAtCompare(left.capturedAt, right.capturedAt, 1) || nameTieBreak();
    case 'name_asc':
      return compareUtf8Bytes(left.displayName, right.displayName) || nameTieBreak();
  }
};

const capturedAtCompare = (left: string | null, right: string | null, direction: 1 | -1): number => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * compareUtf8Bytes(left, right);
};

const resolveSort = (requested: CatalogSearchSort | undefined, hasQuery: boolean): CatalogSearchSort =>
  requested ?? (hasQuery ? 'relevance' : 'captured_desc');

const photoUnsupportedFiltersActive = (filters: CollectionFiltersInput): boolean =>
  filters.place !== null || filters.hasGps !== null;

export const libraryCollection = async (
  deps: CollectionDeps,
  input: CollectionInput,
): Promise<Result<CollectionOutput, AppError>> => {
  const sort = resolveSort(input.sort, input.query !== null);
  if (sort === 'relevance' && input.query === null) {
    return { ok: false, error: appError('validation', "Sort 'relevance' requires a query") };
  }

  const cursor: Result<CollectionCursor, AppError> = input.cursor === null
    ? ok({ v: 2, video: 0, photo: 0, videoAfter: null, photoAfter: null })
    : decodeCollectionCursor(input.cursor);
  if (!cursor.ok) return cursor;

  const videoEnabled = input.media !== 'photo';
  const photosMatchFilters = !photoUnsupportedFiltersActive(input.filters);
  const photoEnabled = input.media !== 'video' && photosMatchFilters;
  let photoFolderId = input.filters.folderId;
  if (photoFolderId !== null) {
    const folder = await deps.globalCatalog.getFolder(photoFolderId);
    if (!folder.ok) return folder;
    if (folder.value !== null) photoFolderId = derivedFolderId(folder.value.currentPath);
  }

  const offlineFolderIds = await resolveOfflineFolderIds(deps, input.filters.hideUnavailable);
  if (!offlineFolderIds.ok) return offlineFolderIds;

  let photoFingerprints: string[] | null = null;
  if (photosMatchFilters && input.filters.people.length > 0) {
    const matched = await deps.globalCatalog.listFingerprintsForPeople({
      personIds: input.filters.people,
      media: 'photo',
    });
    if (!matched.ok) return matched;
    photoFingerprints = matched.value;
  }

  let videoMatch: string | null = null;
  let videoRankingTerms: string[] = [];
  let photoMatch: string | null = null;
  let photoRankingTerms: string[] = [];

  if (input.query !== null) {
    const sanitized = sanitizeSearchQuery(input.query);
    if (!sanitized.ok) return sanitized;

    const videoExpansions = await deps.globalCatalog.expandTagTerms([...sanitized.value.rankingTerms, ...input.filters.tags]);
    if (!videoExpansions.ok) return videoExpansions;
    const videoEquivalents = new Map(videoExpansions.value.map((entry) => [entry.term, entry.equivalents]));
    videoMatch = buildSearchMatch(sanitized.value.parts, videoEquivalents);
    videoRankingTerms = sanitized.value.rankingTerms;
    if (photosMatchFilters) {
      const photoExpansions = await deps.photos.expandPhotoTagTerms([...sanitized.value.rankingTerms, ...input.filters.tags]);
      if (!photoExpansions.ok) return photoExpansions;
      const photoEquivalents = new Map(photoExpansions.value.map((entry) => [entry.term, entry.equivalents]));
      photoMatch = buildSearchMatch(sanitized.value.parts, photoEquivalents);
      photoRankingTerms = sanitized.value.rankingTerms;
    }
  }

  const videoTagTermSets = await tagTermSetsFor(deps, 'video', input.filters.tags, true);
  if (!videoTagTermSets.ok) return videoTagTermSets;
  const photoTagTermSets = await tagTermSetsFor(deps, 'photo', input.filters.tags, photosMatchFilters);
  if (!photoTagTermSets.ok) return photoTagTermSets;

  const emptyVideoPage: { total: number; rows: CatalogSearchRow[] } = { total: 0, rows: [] };
  const videoPage = videoEnabled
    ? await fetchVideoPage(deps, {
      match: videoMatch,
      rankingTerms: videoRankingTerms,
      filters: input.filters,
      excludeFolderIds: offlineFolderIds.value,
      tagTermSets: videoTagTermSets.value,
      sort,
      limit: input.limit,
      offset: cursor.value.video,
      after: cursor.value.videoAfter,
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
      folderId: photoFolderId,
      fingerprints: photoFingerprints,
      tagTermSets: photoTagTermSets.value,
      excludeMissing: input.filters.hideUnavailable,
      sort,
      limit: input.limit,
      offset: cursor.value.photo,
      after: cursor.value.photoAfter,
    })
    : ok(emptyPhotoPage);
  if (!photoPage.ok) return photoPage;

  const videoTotalsPage = videoEnabled
    ? videoPage
    : await fetchVideoPage(deps, {
      match: videoMatch,
      rankingTerms: videoRankingTerms,
      filters: input.filters,
      excludeFolderIds: offlineFolderIds.value,
      tagTermSets: videoTagTermSets.value,
      sort,
      limit: 0,
      offset: 0,
    });
  if (!videoTotalsPage.ok) return videoTotalsPage;

  const photoTotalsPage = !photosMatchFilters
    ? ok(emptyPhotoPage)
    : photoEnabled
      ? photoPage
      : await deps.photos.collectionPage({
        match: photoMatch,
        rankingTerms: photoRankingTerms,
        from: input.filters.from,
        to: input.filters.to,
        folderId: photoFolderId,
        fingerprints: photoFingerprints,
        tagTermSets: photoTagTermSets.value,
        excludeMissing: input.filters.hideUnavailable,
        sort,
        limit: 0,
        offset: 0,
      });
  if (!photoTotalsPage.ok) return photoTotalsPage;

  const merged = await mergePage(deps, {
    videoRows: videoPage.value.rows,
    photoRows: photoPage.value.rows,
    limit: input.limit,
    sort,
    videoOffset: cursor.value.video,
    photoOffset: cursor.value.photo,
  });
  if (!merged.ok) return merged;

  const keyset = sort !== 'relevance';
  const nextVideoOffset = cursor.value.video + merged.value.videoConsumed;
  const nextPhotoOffset = cursor.value.photo + merged.value.photoConsumed;
  const videoExhausted = !videoEnabled
    || (keyset
      ? sourceExhausted(videoPage.value.rows.length, merged.value.videoConsumed, input.limit)
      : nextVideoOffset >= videoPage.value.total);
  const photoExhausted = !photoEnabled
    || (keyset
      ? sourceExhausted(photoPage.value.rows.length, merged.value.photoConsumed, input.limit)
      : nextPhotoOffset >= photoPage.value.total);
  const nextCursor = videoExhausted && photoExhausted
    ? null
    : encodeCollectionCursor({
      v: 2,
      video: keyset ? 0 : nextVideoOffset,
      photo: keyset ? 0 : nextPhotoOffset,
      videoAfter: keyset
        ? videoAnchor(videoPage.value.rows[merged.value.videoConsumed - 1]) ?? cursor.value.videoAfter
        : null,
      photoAfter: keyset
        ? photoAnchor(photoPage.value.rows[merged.value.photoConsumed - 1]) ?? cursor.value.photoAfter
        : null,
    });

  return ok({
    query: input.query,
    media: input.media,
    limit: input.limit,
    total: videoPage.value.total + photoPage.value.total,
    videoTotal: videoPage.value.total,
    photoTotal: photoPage.value.total,
    mediaTotals: {
      all: videoTotalsPage.value.total + photoTotalsPage.value.total,
      video: videoTotalsPage.value.total,
      photo: photoTotalsPage.value.total,
    },
    count: merged.value.items.length,
    items: merged.value.items,
    nextCursor,
  });
};

const sourceExhausted = (fetched: number, consumed: number, limit: number): boolean =>
  fetched < limit && consumed === fetched;

const videoAnchor = (row: CatalogSearchRow | undefined): CollectionRowAnchor | null =>
  row === undefined
    ? null
    : {
      capturedAt: row.capturedAt,
      fileName: row.fileName,
      displayName: row.finalName !== null && row.finalName.length > 0 ? row.finalName : row.fileName,
      fingerprint: row.fingerprint,
    };

const photoAnchor = (row: PhotoSearchRow | undefined): CollectionRowAnchor | null =>
  row === undefined
    ? null
    : {
      capturedAt: row.capturedAt,
      fileName: row.fileName,
      displayName: row.fileName,
      fingerprint: row.fingerprint,
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

const resolveOfflineFolderIds = async (
  deps: CollectionDeps,
  hideUnavailable: boolean,
): Promise<Result<string[], AppError>> => {
  if (!hideUnavailable) return ok([]);
  const folders = await deps.globalCatalog.listFolders();
  if (!folders.ok) return folders;
  const offline: string[] = [];
  for (const folder of folders.value) {
    const exists = await deps.fs.exists(folder.currentPath);
    if (!exists.ok) return exists;
    if (!exists.value) offline.push(folder.folderId);
  }
  return ok(offline);
};

const fetchVideoPage = async (
  deps: CollectionDeps,
  input: {
    match: string | null;
    rankingTerms: string[];
    filters: CollectionFiltersInput;
    excludeFolderIds: string[];
    tagTermSets: string[][];
    sort: CatalogSearchSort;
    limit: number;
    offset: number;
    after?: CollectionRowAnchor | null | undefined;
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
      excludeFolderIds: input.excludeFolderIds,
      excludeMissing: input.filters.hideUnavailable,
    },
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
    after: input.after ?? null,
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
          { media: 'video', capturedAt: videoRow.capturedAt, displayName: videoRow.finalName ?? videoRow.fileName, fileName: videoRow.fileName, fingerprint: videoRow.fingerprint },
          { media: 'photo', capturedAt: photoRow.capturedAt, displayName: photoRow.fileName, fileName: photoRow.fileName, fingerprint: photoRow.fingerprint },
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
  const offlineReason = await resolveOfflineReason(deps.fs, row.folder.currentPath, online.value);
  if (!offlineReason.ok) return offlineReason;
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
      offlineReason: offlineReason.value,
    },
    gps: row.gps,
    missing: row.missing,
    capturedAt: row.capturedAt,
    place: row.place,
    width: row.width,
    height: row.height,
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
