import { photoProcessSummarySchema, photoProxiesSummarySchema, type photosVariantRecordSchema } from '@core/contract/index.js';
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
  return [
    `Scope: ${scope}`,
    `Photos: ${data.counts.photos} (${data.counts.paths} paths, ${data.counts.duplicates} duplicated)`,
    `EXIF read: ${data.counts.exifRead} / failed: ${data.counts.exifFailed}`,
    `Proxies: ${data.counts.proxied} generated, ${data.counts.proxyFailed} failed`,
    `Analysed: ${data.counts.analysed}`,
    `Missing: ${data.counts.missing}`,
  ].join('\n');
};

export const photosForgetHuman = (data: PhotosForgetOutput): string =>
  `Forgot ${data.root}: ${data.pathsRemoved} paths removed, `
  + `${data.photosDeleted} photos deleted, ${data.photosRepointed} photos re-pointed`;

export const photosProxiesHuman = (data: unknown): string => {
  const summary = photoProxiesSummarySchema.parse(data);
  return `Proxies: ${summary.generated} generated, ${summary.failed} failed, `
    + `${summary.skippedExisting} already present (${summary.candidates} candidates)`;
};

export const photosProcessHuman = (data: unknown): string => {
  const summary = photoProcessSummarySchema.parse(data);
  return `Analysed: ${summary.analysed} of ${summary.candidates} candidates, ${summary.failed} failed, `
    + `${summary.skippedExisting} already analysed (${summary.configId}, batch ${summary.batchSize})`;
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
