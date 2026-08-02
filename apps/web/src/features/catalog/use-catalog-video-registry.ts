import { useCallback, useMemo, useState } from 'react';

import { type CatalogVideo, keyOf } from './core/index.js';

export interface CatalogVideoRegistry {
  videosByKey: ReadonlyMap<string, CatalogVideo>;
  register: (videos: readonly CatalogVideo[]) => void;
  lookup: (key: string) => CatalogVideo | null;
}

export const useCatalogVideoRegistry = (): CatalogVideoRegistry => {
  const [videosByKey, setVideosByKey] = useState<ReadonlyMap<string, CatalogVideo>>(() => new Map());
  const register = useCallback((videos: readonly CatalogVideo[]) => {
    if (videos.length === 0) return;
    setVideosByKey((current) => {
      let next: Map<string, CatalogVideo> | null = null;
      for (const video of videos) {
        const key = keyOf(video);
        if (current.get(key) === video) continue;
        next ??= new Map(current);
        next.set(key, video);
      }
      if (next === null) return current;
      for (const video of videos) {
        if (video.contentHash === null) continue;
        for (const [existingKey, existingVideo] of next) {
          if (existingKey === keyOf(video)) continue;
          if (existingVideo.contentHash === video.contentHash) next.delete(existingKey);
        }
      }
      return next;
    });
  }, []);
  const lookup = useCallback((key: string) => videosByKey.get(key) ?? null, [videosByKey]);
  return useMemo(() => ({ videosByKey, register, lookup }), [videosByKey, register, lookup]);
};
