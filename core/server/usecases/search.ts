import { appError, ok, type AppError, type CatalogPlace, type Result } from '@core/domain/index.js';

import type { CatalogFilePerson, CatalogSearchInput, CatalogSearchRow, CatalogSearchSort, FileSystemPort, GlobalCatalogStore, MediaPort } from '../ports.js';
import { artifactPaths, classifyOfflineFolder, formatDuration, formatSize, readRichSegments, variantProvenanceLabel, type OfflineReason } from './shared.js';
import { discoverArtifactRoot, type ArtifactRoot } from './artifact-root.js';
import { ensureGridThumbnail, generateThumbnail, storedAnalysisFramePath } from './thumbnail.js';
import { filterTranscript } from './transcript-hallucinations.js';

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
  hidden?: 'exclude' | 'only' | 'include' | undefined;
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
    offlineReason: OfflineReason | null;
  };
  gps: { lat: number; lon: number } | null;
  missing: boolean;
  capturedAt: string | null;
  place: CatalogPlace | null;
  width: number | null;
  height: number | null;
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
  && filters.folderId === null
  && (filters.hidden ?? 'exclude') === 'exclude';

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
      excludeFolderIds: [],
      excludeMissing: false,
      hidden: input.filters.hidden ?? 'exclude',
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
    const offlineReason = await resolveOfflineReason(deps.fs, row.folder.currentPath, online.value);
    if (!offlineReason.ok) return offlineReason;
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
        offlineReason: offlineReason.value,
      },
      gps: row.gps,
      missing: row.missing,
      capturedAt: row.capturedAt,
      place: row.place,
      width: row.width,
      height: row.height,
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

export const resolveOfflineReason = async (
  fs: FileSystemPort,
  currentPath: string,
  online: boolean,
): Promise<Result<OfflineReason | null, AppError>> => {
  if (online) return ok(null);
  return classifyOfflineFolder(fs, currentPath);
};

export const resolveThumbnailPath = async (
  deps: SearchDeps,
  row: CatalogSearchRow,
  online: boolean,
  thumbnails: ThumbnailsMode,
): Promise<Result<string | null, AppError>> => {
  if (!online) return ok(null);
  const videoPath = deps.fs.join(row.folder.currentPath, row.finalName ?? row.fileName);
  const root = await discoverArtifactRoot(deps.fs, row.folder.currentPath, row.folder.folderId);
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
  const root = await discoverArtifactRoot(deps.fs, row.folder.currentPath, row.folder.folderId);
  if (!root.ok) return root;
  const { gridThumbnailPath, framesDir } = artifactPaths(deps.fs, root.value, videoPath, row.finalName);
  const exists = await deps.fs.exists(gridThumbnailPath);
  if (!exists.ok) return exists;
  if (exists.value) return ok(gridThumbnailPath);
  if (thumbnails === 'existing') return ok(null);
  if (row.missing) return ok(null);
  const analysis = await deps.globalCatalog.getAnalysis(row.fingerprint);
  if (!analysis.ok) return analysis;
  if (analysis.value === null) return ok(null);
  const framePath = await storedAnalysisFramePath(deps.fs, framesDir);
  if (!framePath.ok) return framePath;
  const generated = await ensureGridThumbnail(deps, {
    videoPath,
    projectedFramePath: framePath.value,
    catalogDirectory: root.value.catalogDirectory,
    fingerprint: row.fingerprint,
    gridThumbnailPath,
    force: false,
  });
  if (!generated.ok || generated.value.source === null) return ok(null);
  return ok(generated.value.path);
};

export interface LibraryPreviewTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface LibraryPreviewDetail {
  fingerprint: string;
  path: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  durationS: number | null;
  durationFormatted: string | null;
  transcript: string | null;
  transcriptSegments: LibraryPreviewTranscriptSegment[] | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  people: CatalogFilePerson[];
  analysis: { label: string; createdAt: string } | null;
}

export const libraryPreviewDetail = async (
  deps: SearchDeps,
  input: { fingerprint: string },
): Promise<Result<LibraryPreviewDetail, AppError>> => {
  const file = await deps.globalCatalog.getFile(input.fingerprint);
  if (!file.ok) return file;
  if (file.value === null) {
    return { ok: false, error: appError('not_found', `Catalog file not found: ${input.fingerprint}`) };
  }
  const folder = await deps.globalCatalog.getFolder(file.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) {
    return { ok: false, error: appError('folder_not_found', `Catalog folder not found: ${file.value.folderId}`) };
  }
  const analysis = await deps.globalCatalog.getAnalysis(input.fingerprint);
  if (!analysis.ok) return analysis;
  const people = await deps.globalCatalog.listPeopleForFile(input.fingerprint);
  if (!people.ok) return people;
  const provenance = await selectedVariantProvenance(deps.globalCatalog, input.fingerprint);
  if (!provenance.ok) return provenance;

  const online = await deps.fs.exists(folder.value.currentPath);
  if (!online.ok) return online;
  const player = online.value
    ? await loadPreviewPlayerDetail(deps, {
      folderId: folder.value.folderId,
      folderPath: folder.value.currentPath,
      fileName: file.value.fileName,
      finalName: analysis.value?.finalName ?? null,
    })
    : { transcriptSegments: null, width: null, height: null, rotation: null };

  return ok({
    fingerprint: input.fingerprint,
    path: deps.fs.join(folder.value.currentPath, file.value.fileName),
    fileName: file.value.fileName,
    size: file.value.size,
    sizeFormatted: formatSize(file.value.size),
    durationS: file.value.durationS,
    durationFormatted: file.value.durationS === null ? null : formatDuration(file.value.durationS),
    transcript: analysis.value?.transcript ?? null,
    transcriptSegments: player.transcriptSegments,
    width: player.width,
    height: player.height,
    rotation: player.rotation,
    people: people.value,
    analysis: provenance.value,
  });
};

const selectedVariantProvenance = async (
  store: GlobalCatalogStore,
  fingerprint: string,
): Promise<Result<{ label: string; createdAt: string } | null, AppError>> => {
  const selectedConfigId = await store.getSelectedConfigId(fingerprint);
  if (!selectedConfigId.ok) return selectedConfigId;
  if (selectedConfigId.value === null) return ok(null);
  const variants = await store.listVariants(fingerprint);
  if (!variants.ok) return variants;
  const selected = variants.value.find((variant) => variant.configId === selectedConfigId.value);
  if (selected === undefined) return ok(null);
  return ok({ label: variantProvenanceLabel(selected), createdAt: selected.createdAt });
};

interface PreviewPlayerDetail {
  transcriptSegments: LibraryPreviewTranscriptSegment[] | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
}

// Segments are re-derived from the on-disk transcript artifacts rather than stored in the global
// catalog DB, mirroring how core/server/usecases/scan.ts derives them for the per-folder scan view
// — the two players stay in sync without a schema migration.
const loadPreviewPlayerDetail = async (
  deps: SearchDeps,
  input: { folderId: string; folderPath: string; fileName: string; finalName: string | null },
): Promise<PreviewPlayerDetail> => {
  const videoPath = deps.fs.join(input.folderPath, input.finalName ?? input.fileName);
  const root = await discoverArtifactRoot(deps.fs, input.folderPath, input.folderId);
  const transcriptSegments = root.ok
    ? await loadPreviewTranscriptSegments(deps.fs, root.value, videoPath, input.finalName)
    : null;
  const probe = await deps.media.probe({ videoPath });
  return {
    transcriptSegments,
    width: probe.ok ? probe.value.width : null,
    height: probe.ok ? probe.value.height : null,
    rotation: probe.ok ? probe.value.rotation : null,
  };
};

const loadPreviewTranscriptSegments = async (
  fs: FileSystemPort,
  root: ArtifactRoot,
  videoPath: string,
  finalName: string | null,
): Promise<LibraryPreviewTranscriptSegment[] | null> => {
  const paths = artifactPaths(fs, root, videoPath, finalName);
  const rawText = await fs.readTextFile(paths.transcriptPath);
  if (!rawText.ok || rawText.value === null) return null;
  const filtered = filterTranscript(rawText.value, await readRichSegments(fs, paths.transcriptJsonPath));
  if (filtered.segments.length === 0) return null;
  return filtered.segments.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text }));
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
