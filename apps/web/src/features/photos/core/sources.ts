import type { PhotoExtension } from '@core/domain/index.js';

const ORIGINAL_RENDERABLE_EXTENSIONS: readonly PhotoExtension[] = ['jpg', 'jpeg', 'png'];

export const viewerSourceCandidates = (
  item: { ext: PhotoExtension; currentPath: string; missingAt: number | null },
  proxyPath: string | null,
): string[] => {
  const candidates: string[] = [];
  if (ORIGINAL_RENDERABLE_EXTENSIONS.includes(item.ext) && item.missingAt === null) {
    candidates.push(item.currentPath);
  }
  if (proxyPath !== null) candidates.push(proxyPath);
  return candidates;
};
