import { ok, type AppError, type LibrarySelectionScope, type Result } from '@core/domain/index.js';

import type { LibrarySelectionDeps } from './library-selection.js';
import { resolveLibrarySelection } from './library-selection.js';

export interface LibraryHideOutput {
  requested: number;
  changed: number;
  unchanged: number;
  videos: number;
  photos: number;
}

export const libraryHide = async (
  deps: LibrarySelectionDeps,
  input: { scope: LibrarySelectionScope },
): Promise<Result<LibraryHideOutput, AppError>> =>
  setLibraryHidden(deps, input.scope, Date.now());

export const libraryUnhide = async (
  deps: LibrarySelectionDeps,
  input: { scope: LibrarySelectionScope },
): Promise<Result<LibraryHideOutput, AppError>> =>
  setLibraryHidden(deps, input.scope, null);

const setLibraryHidden = async (
  deps: LibrarySelectionDeps,
  scope: LibrarySelectionScope,
  hiddenAt: number | null,
): Promise<Result<LibraryHideOutput, AppError>> => {
  const entries = await resolveLibrarySelection(deps, scope);
  if (!entries.ok) return entries;
  const videoFingerprints = entries.value.filter((entry) => entry.media === 'video').map((entry) => entry.fingerprint);
  const photoFingerprints = entries.value.filter((entry) => entry.media === 'photo').map((entry) => entry.fingerprint);
  const videos = await deps.globalCatalog.setHidden(videoFingerprints, hiddenAt);
  if (!videos.ok) return videos;
  const photos = await deps.photos.setPhotosHidden(photoFingerprints, hiddenAt);
  if (!photos.ok) return photos;
  const changed = videos.value.changed + photos.value.changed;
  return ok({
    requested: entries.value.length,
    changed,
    unchanged: videos.value.unchanged + photos.value.unchanged,
    videos: videos.value.changed,
    photos: photos.value.changed,
  });
};
