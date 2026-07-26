import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type CatalogVideo } from './core/index.js';

const EMPTY: readonly CatalogVideo[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

// A read-only folder keeps its thumbnails in the home mirror, which the first analysis of the
// session creates: an attempt made before that has nowhere to write, so a completed analysis earns
// the file one more try instead of a placeholder that survives until the next launch.
const attemptPhase = (video: CatalogVideo): 'before-analysis' | 'after-analysis' =>
  video.status === 'completed' ? 'after-analysis' : 'before-analysis';

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
  const attemptedRef = useRef<Map<string, string>>(new Map());
  const runIdRef = useRef(0);

  useEffect(() => {
    attemptedRef.current = new Map();
    setFailedPaths(EMPTY_SET);
  }, [folder]);

  useEffect(() => {
    if (folder === null) return;
    const missing = videos.filter(
      (video) => video.artifacts.thumbnailPath === null
        && attemptedRef.current.get(video.path) !== attemptPhase(video),
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
      const recoveries: string[] = [];
      for (const video of missing) {
        if (cancelled || runId !== runIdRef.current) break;
        attemptedRef.current.set(video.path, attemptPhase(video));
        try {
          const result = await runThumbnail({ videoPath: video.path, force: false });
          if (result.generated) {
            generatedAny = true;
            recoveries.push(video.path);
          } else failures.push(video.path);
        } catch {
          failures.push(video.path);
        }
      }
      if (cancelled || runId !== runIdRef.current) return;
      if (failures.length > 0 || recoveries.length > 0) {
        setFailedPaths((current) => {
          const next = new Set(current);
          for (const path of recoveries) next.delete(path);
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
