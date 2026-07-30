import { photoProcessSummarySchema, photoProxiesSummarySchema } from '@core/contract/index.js';
import type { ApiClient } from '@core/client/index.js';
import type { AppError, Result } from '@core/domain/index.js';

type PhotosStatusOutput = Awaited<ReturnType<ApiClient['photosStatus']>> extends Result<infer T, AppError> ? T : never;
type PhotosForgetOutput = Awaited<ReturnType<ApiClient['photosForget']>> extends Result<infer T, AppError> ? T : never;

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
