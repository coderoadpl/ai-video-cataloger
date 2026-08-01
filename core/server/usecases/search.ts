import { appError, ok, type AppError, type CatalogPlace, type Result } from '@core/domain/index.js';

import type { CatalogSearchInput, CatalogSearchRow, CatalogSearchSort, FileSystemPort, GlobalCatalogStore, MediaPort } from '../ports.js';
import { artifactPaths } from './shared.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { generateGridThumbnail, generateThumbnail, storedAnalysisFramePath } from './thumbnail.js';

export interface SearchDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
  media: MediaPort;
}

export interface SearchFiltersInput {
  tags: string[];
  people: string[];
  place: string | null;
  from: string | null;
  to: string | null;
  hasGps: boolean | null;
  folderId: string | null;
}

export type ThumbnailsMode = 'ensure' | 'existing';

export interface SearchInput {
  query: string | null;
  filters: SearchFiltersInput;
  sort: CatalogSearchSort | undefined;
  thumbnails: ThumbnailsMode;
  limit: number;
  offset: number;
}

export interface SearchResult {
  fingerprint: string;
  variantCount: number;
  fileName: string;
  finalName: string | null;
  description: string | null;
  snippet: string;
  thumbnailPath: string | null;
  gridThumbnailPath: string | null;
  tags: string[];
  folder: {
    folderId: string;
    currentPath: string;
    displayName: string;
    online: boolean;
  };
  gps: { lat: number; lon: number } | null;
  missing: boolean;
  capturedAt: string | null;
  place: CatalogPlace | null;
}

export interface SearchOutput {
  query: string | null;
  limit: number;
  offset: number;
  count: number;
  total: number;
  results: SearchResult[];
}

export type SearchMatchPart =
  | { kind: 'phrase'; tokens: string[] }
  | { kind: 'term'; token: string };

export interface SanitizedSearchQuery {
  parts: SearchMatchPart[];
  rankingTerms: string[];
}

const filtersAreEmpty = (filters: SearchFiltersInput): boolean =>
  filters.tags.length === 0
  && filters.people.length === 0
  && filters.place === null
  && filters.from === null
  && filters.to === null
  && filters.hasGps === null
  && filters.folderId === null;

const resolveSort = (requested: CatalogSearchSort | undefined, hasQuery: boolean): CatalogSearchSort =>
  requested ?? (hasQuery ? 'relevance' : 'captured_desc');

export const search = async (
  deps: SearchDeps,
  input: SearchInput,
): Promise<Result<SearchOutput, AppError>> => {
  // Library browses the whole catalog with neither a query nor a filter, but an accidental bare
  // CLI/API invocation looks identical apart from one thing: Library always states its sort
  // explicitly (see use-library.ts), so an unset sort is the signal that nothing was intended here.
  if (input.query === null && input.sort === undefined && filtersAreEmpty(input.filters)) {
    return { ok: false, error: appError('validation', 'Provide a query or at least one filter') };
  }

  const sort = resolveSort(input.sort, input.query !== null);
  if (sort === 'relevance' && input.query === null) {
    return { ok: false, error: appError('validation', "Sort 'relevance' requires a query") };
  }

  let parts: SearchMatchPart[] = [];
  let rankingTerms: string[] = [];
  if (input.query !== null) {
    const sanitized = sanitizeSearchQuery(input.query);
    if (!sanitized.ok) return sanitized;
    parts = sanitized.value.parts;
    rankingTerms = sanitized.value.rankingTerms;
  }

  const expansions = await deps.globalCatalog.expandTagTerms([...rankingTerms, ...input.filters.tags]);
  if (!expansions.ok) return expansions;
  const equivalents = new Map(expansions.value.map((entry) => [entry.term, entry.equivalents]));

  const match = input.query === null ? null : buildSearchMatch(parts, equivalents);
  const tagTermSets = input.filters.tags.map((tag) => [tag, ...(equivalents.get(tag) ?? [])]);

  const searched: CatalogSearchInput = {
    match,
    rankingTerms,
    filters: {
      tagTermSets,
      personIds: input.filters.people,
      place: input.filters.place,
      capturedFrom: input.filters.from,
      capturedTo: input.filters.to,
      hasGps: input.filters.hasGps,
      folderId: input.filters.folderId,
    },
    sort,
    limit: input.limit,
    offset: input.offset,
  };
  const searchResult = await deps.globalCatalog.search(searched);
  if (!searchResult.ok) return searchResult;

  const results: SearchResult[] = [];
  for (const row of searchResult.value.rows) {
    const online = await deps.fs.exists(row.folder.currentPath);
    if (!online.ok) return online;
    const thumbnailPath = await resolveThumbnailPath(deps, row, online.value, input.thumbnails);
    if (!thumbnailPath.ok) return thumbnailPath;
    const gridThumbnailPath = await resolveGridThumbnailPath(deps, row, online.value, input.thumbnails);
    if (!gridThumbnailPath.ok) return gridThumbnailPath;
    results.push({
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
  }
  return ok({
    query: input.query,
    limit: input.limit,
    offset: input.offset,
    count: results.length,
    total: searchResult.value.total,
    results,
  });
};

export const resolveThumbnailPath = async (
  deps: SearchDeps,
  row: CatalogSearchRow,
  online: boolean,
  thumbnails: ThumbnailsMode,
): Promise<Result<string | null, AppError>> => {
  if (!online) return ok(null);
  const videoPath = deps.fs.join(row.folder.currentPath, row.finalName ?? row.fileName);
  const root = await discoverArtifactRoot(deps.fs, row.folder.currentPath);
  if (!root.ok) return root;
  const { thumbnailPath } = artifactPaths(deps.fs, root.value, videoPath, row.finalName);
  const exists = await deps.fs.exists(thumbnailPath);
  if (!exists.ok) return exists;
  if (exists.value) return ok(thumbnailPath);
  if (thumbnails === 'existing') return ok(null);
  if (row.missing) return ok(null);
  const analysis = await deps.globalCatalog.getAnalysis(row.fingerprint);
  if (!analysis.ok) return analysis;
  if (analysis.value === null) return ok(null);
  const generated = await generateThumbnail(deps, { videoPath, force: false });
  return ok(generated.ok ? generated.value.thumbnailPath : null);
};

export const resolveGridThumbnailPath = async (
  deps: SearchDeps,
  row: CatalogSearchRow,
  online: boolean,
  thumbnails: ThumbnailsMode,
): Promise<Result<string | null, AppError>> => {
  if (!online) return ok(null);
  const videoPath = deps.fs.join(row.folder.currentPath, row.finalName ?? row.fileName);
  const root = await discoverArtifactRoot(deps.fs, row.folder.currentPath);
  if (!root.ok) return root;
  const { gridThumbnailPath, framesDir } = artifactPaths(deps.fs, root.value, videoPath, row.finalName);
  const exists = await deps.fs.exists(gridThumbnailPath);
  if (!exists.ok) return exists;
  if (exists.value) return ok(gridThumbnailPath);
  if (thumbnails === 'existing') return ok(null);
  const framePath = await storedAnalysisFramePath(deps.fs, framesDir);
  if (!framePath.ok) return framePath;
  if (framePath.value === null) return ok(null);
  const generated = await generateGridThumbnail(deps, {
    framePath: framePath.value,
    gridThumbnailPath,
    force: false,
  });
  return ok(generated.ok ? generated.value.path : null);
};

export const sanitizeSearchQuery = (query: string): Result<SanitizedSearchQuery, AppError> => {
  const parts: SearchMatchPart[] = [];
  const rankingTerms: string[] = [];
  for (const segment of parseQuerySegments(query)) {
    const tokens = tokenize(segment.value);
    if (tokens.length === 0) continue;
    rankingTerms.push(...tokens);
    if (segment.quoted) {
      parts.push({ kind: 'phrase', tokens });
      continue;
    }
    for (const token of tokens) parts.push({ kind: 'term', token });
  }
  const uniqueRankingTerms = [...new Set(rankingTerms)];
  if (parts.length === 0) {
    return { ok: false, error: appError('validation', 'Search query must contain at least one searchable term') };
  }
  return ok({ parts, rankingTerms: uniqueRankingTerms });
};

export const buildSearchMatch = (
  parts: readonly SearchMatchPart[],
  equivalents: ReadonlyMap<string, readonly string[]>,
): string =>
  parts
    .map((part) => {
      if (part.kind === 'phrase') return `"${part.tokens.join(' ')}"`;
      const alternatives = (equivalents.get(part.token) ?? []).map(renderEquivalent).filter((value) => value !== null);
      return alternatives.length === 0 ? `${part.token}*` : `(${part.token}* OR ${alternatives.join(' OR ')})`;
    })
    .join(' AND ');

const renderEquivalent = (equivalent: string): string | null => {
  const tokens = tokenize(equivalent);
  if (tokens.length === 0) return null;
  return tokens.length === 1 ? tokens[0] ?? null : `"${tokens.join(' ')}"`;
};

interface QuerySegment {
  value: string;
  quoted: boolean;
}

const parseQuerySegments = (query: string): QuerySegment[] => {
  const segments: QuerySegment[] = [];
  let current = '';
  let quoted = false;
  for (const character of query) {
    if (character === '"') {
      if (current.length > 0) segments.push({ value: current, quoted });
      current = '';
      quoted = !quoted;
      continue;
    }
    current += character;
  }
  if (current.length > 0) segments.push({ value: current, quoted });
  return segments;
};

const tokenize = (value: string): string[] =>
  Array.from(value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]);
