import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type z } from 'zod';

import type { scanOutputSchema } from '@core/contract/index.js';
import { actions } from '../../api.js';
import { type CatalogVideo } from './core/index.js';

const EMPTY: readonly CatalogVideo[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
const FOREGROUND_THUMBNAIL_COUNT = 12;
type ScanOutput = z.output<typeof scanOutputSchema>;

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
  priority: 'viewport-first' | 'background' = 'viewport-first',
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
      const failures: string[] = [];
      const recoveries: string[] = [];
      await Promise.all(missing.map(async (video, index) => {
        if (cancelled || runId !== runIdRef.current) return;
        attemptedRef.current.set(video.path, attemptPhase(video));
        try {
          const result = await runThumbnail({
            videoPath: video.path,
            force: false,
            priority: priority === 'viewport-first' && index < FOREGROUND_THUMBNAIL_COUNT
              ? 'foreground'
              : 'background',
          });
          if (result.generated) {
            recoveries.push(video.path);
            for (const cached of [true, false]) {
              const queryKey = actions.scan({ folder, cached }).queryKey;
              queryClient.setQueryData<ScanOutput>(queryKey, (current) => current === undefined
                ? undefined
                : {
                    ...current,
                    videos: current.videos.map((entry) => entry.path === video.path
                      ? {
                          ...entry,
                          artifacts: {
                            ...entry.artifacts,
                            thumbnailPath: result.thumbnailPath,
                            thumbnailMtime: Date.now(),
                          },
                        }
                      : entry),
                  });
            }
          } else failures.push(video.path);
        } catch {
          failures.push(video.path);
        }
      }));
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
    })();

    return () => {
      cancelled = true;
    };
  }, [folder, videos, priority, runThumbnail, queryClient]);

  return { isGenerating, failedPaths };
};
