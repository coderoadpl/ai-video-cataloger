import type { CatalogVideo } from './catalog-video.js';

type RenameCandidate = Pick<CatalogVideo, 'path' | 'contentHash'>;

export const followRenamedKey = (
  previous: RenameCandidate | null,
  freshVideos: readonly RenameCandidate[],
): string | null => {
  if (previous === null) return null;
  if (freshVideos.some((video) => video.path === previous.path)) return previous.path;
  if (previous.contentHash === null) return previous.path;
  const match = freshVideos.find((video) => video.contentHash === previous.contentHash);
  return match?.path ?? previous.path;
};
