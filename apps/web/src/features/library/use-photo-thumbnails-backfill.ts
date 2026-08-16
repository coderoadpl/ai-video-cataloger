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
    let cancelled = false;
    void (async () => {
      const accepted = await runBackfill({ force: false });
      const final = await pollJobUntilTerminal(accepted.jobId, {
        delay: sleep,
        fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
        isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
        shouldStop: () => cancelled,
      });
      if (cancelled || final.status !== 'completed') return;
      await Promise.all([
        invalidateCollectionQueries(queryClient),
        invalidatePhotosQueries(queryClient),
      ]);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, hasRoots, queryClient, runBackfill]);
};
