import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore } from '../ports.js';

export interface SearchDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

export interface SearchInput {
  query: string;
  limit: number;
  offset: number;
}

export interface SearchResult {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  description: string | null;
  snippet: string;
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
    results.push({
      fingerprint: row.fingerprint,
      fileName: row.fileName,
      finalName: row.finalName,
      description: row.description,
      snippet: row.snippet,
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
