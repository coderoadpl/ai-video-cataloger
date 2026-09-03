import { photoGpsBackfillSummarySchema, photoGridThumbsSummarySchema, photoImportLibraSummarySchema, photoProcessSummarySchema, photoProxiesSummarySchema, type photosVariantRecordSchema } from '@core/contract/index.js';
import type { z } from 'zod';
import type { ApiClient } from '@core/client/index.js';
import type { AppError, Result } from '@core/domain/index.js';

type PhotosStatusOutput = Awaited<ReturnType<ApiClient['photosStatus']>> extends Result<infer T, AppError> ? T : never;
type PhotosForgetOutput = Awaited<ReturnType<ApiClient['photosForget']>> extends Result<infer T, AppError> ? T : never;
type PhotosSearchOutput = Awaited<ReturnType<ApiClient['photosSearch']>> extends Result<infer T, AppError> ? T : never;
type PhotosVariantsListOutput = Awaited<ReturnType<ApiClient['photosVariantsList']>> extends Result<infer T, AppError> ? T : never;
type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

export const photosStatusHuman = (data: PhotosStatusOutput): string => {
  const scope = data.root === null ? 'all photos' : data.root;
  const durability = data.durability.degraded || data.durability.pendingWrites
    ? [`Durability: degraded=${String(data.durability.degraded)} pendingWrites=${String(data.durability.pendingWrites)} lastError=${data.durability.lastErrorCode ?? '-'}`]
    : [];
  return [
    `Scope: ${scope}`,
    ...durability,
    `Photos: ${data.counts.photos} (${data.counts.paths} paths, ${data.counts.duplicates} duplicated)`,
    `EXIF read: ${data.counts.exifRead} / failed: ${data.counts.exifFailed}`,
    `Proxies: ${data.counts.proxied} generated, ${data.counts.proxyFailed} failed`,
    `Analysed: ${data.counts.analysed}`,
    `Faces indexed: ${data.counts.facesIndexed}`,
    `Missing: ${data.counts.missing}`,
  ].join('\n');
};

export const photosForgetHuman = (data: PhotosForgetOutput): string =>
  `Forgot ${data.root}: ${data.pathsRemoved} paths removed, `
  + `${data.photosDeleted} photos deleted, ${data.photosRepointed} photos re-pointed`;

export const photosProxiesHuman = (data: unknown): string => {
  const summary = photoProxiesSummarySchema.parse(data);
  return `Proxies: ${summary.generated} generated, ${summary.failed} failed, `
    + `${summary.skippedExisting} already present (${summary.candidates} candidates), `
    + `grid: ${summary.gridFailed} failed`;
};

export const photosGridThumbsHuman = (data: unknown): string => {
  const summary = photoGridThumbsSummarySchema.parse(data);
  return `Grid thumbnails: ${summary.generated} generated, ${summary.failed} failed, `
    + `${summary.skipped} already present (${summary.candidates} candidates)`;
};

export const photosProcessHuman = (data: unknown): string => {
  const summary = photoProcessSummarySchema.parse(data);
  return `Analysed: ${summary.analysed} of ${summary.candidates} candidates, ${summary.failed} failed, `
    + `${summary.skippedExisting} already analysed (${summary.configId}, batch ${summary.batchSize})`;
};

export const photosGpsBackfillHuman = (data: unknown): string => {
  const parsed = photoGpsBackfillSummarySchema.safeParse(data);
  if (!parsed.success) return 'Photo GPS backfill complete';
  const summary = parsed.data;
  return [
    summary.dryRun ? 'Photo GPS backfill (dry run):' : 'Photo GPS backfill:',
    `Photos considered: ${summary.photosConsidered} of ${summary.photosTotal} (camera-protected: ${summary.skipped.cameraGps}, manual-protected: ${summary.skipped.manualGps})`,
    `Matched: visit=${summary.matched.visit} activity=${summary.matched.activity} path=${summary.matched.path} unmatched=${summary.unmatched}`,
    `Assumed-timezone widened matches: ${summary.assumedWidened}`,
    `Accuracy median=${summary.accuracy.medianM ?? '-'}m p90=${summary.accuracy.p90M ?? '-'}m`,
    `Written: ${summary.written}, unchanged: ${summary.unchanged}`,
    `Skipped: noCapturedAt=${summary.skipped.noCapturedAt}`,
    `Places: resolved=${summary.places.resolved} unresolved=${summary.places.unresolved} skippedNoDataset=${summary.places.skippedNoDataset}`,
  ].join('\n');
};

export const photosImportLibraHuman = (data: unknown): string => {
  const parsed = photoImportLibraSummarySchema.safeParse(data);
  if (!parsed.success) return 'Photo LIBRA import complete';
  const summary = parsed.data;
  return [
    summary.dryRun ? 'Photo LIBRA import (dry run):' : 'Photo LIBRA import:',
    `Manifest: ${summary.manifest.matched} matched, ${summary.manifest.unmatched} unmatched (${summary.manifest.invalidLines} invalid lines)`,
    `Descriptions: ${summary.descriptions.imported} imported, ${summary.descriptions.unmatched} unmatched`,
    `Faces: ${summary.faces.imported} imported across ${summary.faces.photosCompleted} photos, `
      + `${summary.faces.skippedIncomplete} skipped incomplete, ${summary.faces.unmatched} unmatched`,
    `Geo: ${summary.geo.written} written, ${summary.geo.unchanged} unchanged, `
      + `${summary.geo.skippedPrecedence} skipped (precedence), ${summary.geo.skippedUnsupportedSource} skipped (unsupported source), `
      + `${summary.geo.unmatched} unmatched`,
  ].join('\n');
};

export const photosSearchHuman = (data: PhotosSearchOutput): string => {
  if (data.results.length === 0) return 'No results found';
  const rows = data.results.map((result) =>
    `${result.fileName} — ${result.snippet.replace(/<\/?mark>/g, '')} (${result.tags.join(', ')})`);
  return [...rows, `${data.count} result(s)`].join('\n');
};

export const photosVariantNdjsonRow = (variant: PhotoVariantRecord) => ({
  configId: variant.configId,
  label: variant.label,
  selected: variant.selected,
  explicit: variant.explicit,
  createdAt: variant.createdAt,
  analyzer: variant.analyzer,
  model: variant.model,
});

export const photosVariantsListHuman = (data: PhotosVariantsListOutput): string => {
  if (data.variants.length === 0) return 'No analysis variants found';
  const rows = data.variants.map((variant) => [
    variant.selected ? '*' : '',
    variant.configId,
    variant.label,
    variant.explicit ? 'explicit' : 'resolved',
    variant.createdAt,
  ].join('\t'));
  return [
    'SELECTED\tCONFIG\tLABEL\tEXPLICIT\tCREATED',
    ...rows,
  ].join('\n');
};
