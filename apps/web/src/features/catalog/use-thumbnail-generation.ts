import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type CatalogVideo } from './catalog-video.js';

const EMPTY: readonly CatalogVideo[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

export interface ThumbnailGenerationState {
  isGenerating: boolean;
  failedPaths: ReadonlySet<string>;
}

export const useThumbnailGeneration = (
  folder: string | null,
  videos: readonly CatalogVideo[] = EMPTY,
): ThumbnailGenerationState => {
  const queryClient = useQueryClient();
  const generate = useMutation(actions.generateThumbnail);
  const runThumbnail = generate.mutateAsync;

  const [isGenerating, setIsGenerating] = useState(false);
  const [failedPaths, setFailedPaths] = useState<ReadonlySet<string>>(EMPTY_SET);
  const attemptedRef = useRef<Set<string>>(new Set());
  const runIdRef = useRef(0);

  useEffect(() => {
    attemptedRef.current = new Set();
    setFailedPaths(EMPTY_SET);
  }, [folder]);

  useEffect(() => {
    if (folder === null) return;
    const missing = videos.filter(
      (video) => video.artifacts.thumbnailPath === null && !attemptedRef.current.has(video.path),
    );
    if (missing.length === 0) {
      setIsGenerating(false);
      return;
    }

    const runId = (runIdRef.current += 1);
    let cancelled = false;
    setIsGenerating(true);

    void (async () => {
      let generatedAny = false;
      const failures: string[] = [];
      for (const video of missing) {
        if (cancelled || runId !== runIdRef.current) break;
        attemptedRef.current.add(video.path);
        try {
          const result = await runThumbnail({ videoPath: video.path, force: false });
          if (result.generated) generatedAny = true;
          else failures.push(video.path);
        } catch {
          failures.push(video.path);
        }
      }
      if (cancelled || runId !== runIdRef.current) return;
      if (failures.length > 0) {
        setFailedPaths((current) => {
          const next = new Set(current);
          for (const path of failures) next.add(path);
          return next;
        });
      }
      setIsGenerating(false);
      if (generatedAny) void queryClient.invalidateQueries();
    })();

    return () => {
      cancelled = true;
    };
  }, [folder, videos, runThumbnail, queryClient]);

  return { isGenerating, failedPaths };
};
