import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type CatalogVideo } from './catalog-video.js';

const EMPTY: readonly CatalogVideo[] = [];

export const useThumbnailGeneration = (
  folder: string | null,
  videos: readonly CatalogVideo[] = EMPTY,
): boolean => {
  const queryClient = useQueryClient();
  const generate = useMutation(actions.generateThumbnail);
  const runThumbnail = generate.mutateAsync;

  const [isGenerating, setIsGenerating] = useState(false);
  const attemptedRef = useRef<Set<string>>(new Set());
  const runIdRef = useRef(0);

  useEffect(() => {
    attemptedRef.current = new Set();
  }, [folder]);

  useEffect(() => {
    if (folder === null) return;
    const missing = videos.filter(
      (video) => video.artifacts.thumbnailPath === null && !attemptedRef.current.has(video.path),
    );
    if (missing.length === 0) return;

    const runId = (runIdRef.current += 1);
    let cancelled = false;
    setIsGenerating(true);

    void (async () => {
      let generatedAny = false;
      for (const video of missing) {
        if (cancelled || runId !== runIdRef.current) break;
        attemptedRef.current.add(video.path);
        try {
          const result = await runThumbnail({ videoPath: video.path, force: false });
          if (result.generated) generatedAny = true;
        } catch {
          continue;
        }
      }
      if (cancelled || runId !== runIdRef.current) return;
      setIsGenerating(false);
      if (generatedAny) void queryClient.invalidateQueries();
    })();

    return () => {
      cancelled = true;
    };
  }, [folder, videos, runThumbnail, queryClient]);

  return isGenerating;
};
