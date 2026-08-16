import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateCollectionQueries, invalidatePhotosQueries, isTerminalJobStatus } from '@core/client/index.js';

import { actions } from '../../api.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

export interface UsePhotoThumbnailsBackfillTriggerInput {
  active: boolean;
  hasRoots: boolean;
}

export const usePhotoThumbnailsBackfillTrigger = ({ active, hasRoots }: UsePhotoThumbnailsBackfillTriggerInput): void => {
  const queryClient = useQueryClient();
  const backfill = useMutation(actions.photosGridThumbs);
  const runBackfill = backfill.mutateAsync;
  const triggered = useRef(false);

  useEffect(() => {
    if (!active || !hasRoots || triggered.current) return;
    triggered.current = true;
    const controller = new AbortController();
    let jobId: string | null = null;
    void (async () => {
      try {
        const accepted = await runBackfill({ force: false });
        jobId = accepted.jobId;
        await pollJobUntilTerminal(accepted.jobId, {
          delay: sleep,
          fetchJob: (currentJobId) => queryClient.fetchQuery(actions.job({ jobId: currentJobId })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          signal: controller.signal,
        });
      } catch {
        return;
      } finally {
        if (!controller.signal.aborted) {
          await Promise.allSettled([
            invalidateCollectionQueries(queryClient),
            invalidatePhotosQueries(queryClient),
          ]);
        }
      }
    })();
    return () => {
      controller.abort();
      if (jobId !== null) void queryClient.cancelQueries(actions.job({ jobId }));
    };
  }, [active, hasRoots, queryClient, runBackfill]);
};
