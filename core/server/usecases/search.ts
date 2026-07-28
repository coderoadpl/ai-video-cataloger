import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { CatalogSearchRow, FileSystemPort, GlobalCatalogStore, MediaPort } from '../ports.js';
import { artifactPaths } from './shared.js';
import { discoverArtifactRoot } from './artifact-root.js';
import { generateThumbnail } from './thumbnail.js';

export interface SearchDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
  media: MediaPort;
}

export interface SearchInput {
  query: string;
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
  tags: string[];
  folder: {
    folderId: string;
    currentPath: string;
    displayName: string;
    online: boolean;
  };
  gps: { lat: number; lon: number } | null;
  missing: boolean;
}

export interface SearchOutput {
  query: string;
  limit: number;
  offset: number;
  count: number;
  results: SearchResult[];
}

export interface SanitizedSearchQuery {
  match: string;
  rankingTerms: string[];
}

export const search = async (
  deps: SearchDeps,
  input: SearchInput,
): Promise<Result<SearchOutput, AppError>> => {
  const sanitized = sanitizeSearchQuery(input.query);
  if (!sanitized.ok) return sanitized;
  const rows = await deps.globalCatalog.search({
    match: sanitized.value.match,
    rankingTerms: sanitized.value.rankingTerms,
    limit: input.limit,
    offset: input.offset,
  });
  if (!rows.ok) return rows;
  const results: SearchResult[] = [];
  for (const row of rows.value) {
    const online = await deps.fs.exists(row.folder.currentPath);
    if (!online.ok) return online;
    const thumbnailPath = await resolveThumbnailPath(deps, row, online.value);
    if (!thumbnailPath.ok) return thumbnailPath;
    results.push({
      fingerprint: row.fingerprint,
      variantCount: row.variantCount,
      fileName: row.fileName,
      finalName: row.finalName,
      description: row.description,
      snippet: row.snippet,
      thumbnailPath: thumbnailPath.value,
      tags: row.tags,
      folder: {
        folderId: row.folder.folderId,
        currentPath: row.folder.currentPath,
        displayName: row.folder.displayName,
        online: online.value,
      },
      gps: row.gps,
      missing: row.missing,
    });
  }
  return ok({
    query: input.query,
    limit: input.limit,
    offset: input.offset,
    count: results.length,
    results,
  });
};

const resolveThumbnailPath = async (
  deps: SearchDeps,
  row: CatalogSearchRow,
  online: boolean,
): Promise<Result<string | null, AppError>> => {
  if (!online) return ok(null);
  const videoPath = deps.fs.join(row.folder.currentPath, row.finalName ?? row.fileName);
  const root = await discoverArtifactRoot(deps.fs, row.folder.currentPath);
  if (!root.ok) return root;
  const { thumbnailPath } = artifactPaths(deps.fs, root.value, videoPath, row.finalName);
  const exists = await deps.fs.exists(thumbnailPath);
  if (!exists.ok) return exists;
  if (exists.value) return ok(thumbnailPath);
  if (row.missing) return ok(null);
  const analysis = await deps.globalCatalog.getAnalysis(row.fingerprint);
  if (!analysis.ok) return analysis;
  if (analysis.value === null) return ok(null);
  const generated = await generateThumbnail(deps, { videoPath, force: false });
  return ok(generated.ok ? generated.value.thumbnailPath : null);
};

export const sanitizeSearchQuery = (query: string): Result<SanitizedSearchQuery, AppError> => {
  const parts: string[] = [];
  const rankingTerms: string[] = [];
  for (const segment of parseQuerySegments(query)) {
    const tokens = tokenize(segment.value);
    if (tokens.length === 0) continue;
    rankingTerms.push(...tokens);
    if (segment.quoted) {
      parts.push(`"${tokens.join(' ')}"`);
      continue;
    }
    parts.push(...tokens.map((token) => `${token}*`));
  }
  const uniqueRankingTerms = [...new Set(rankingTerms)];
  if (parts.length === 0) {
    return { ok: false, error: appError('validation', 'Search query must contain at least one searchable term') };
  }
  return ok({ match: parts.join(' AND '), rankingTerms: uniqueRankingTerms });
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
