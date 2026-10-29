import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateCollectionQueries, isTerminalJobStatus } from '@core/client/index.js';

import { actions } from '../../api.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

export interface UseThumbnailsBackfillTriggerInput {
  active: boolean;
  folders: readonly string[];
}

export const useThumbnailsBackfillTrigger = ({ active, folders }: UseThumbnailsBackfillTriggerInput): void => {
  const queryClient = useQueryClient();
  const backfill = useMutation(actions.thumbnailsBackfill);
  const runBackfill = backfill.mutateAsync;
  const triggered = useRef<Set<string>>(new Set());
  const pending = useRef(new Set<{ controller: AbortController; jobId: string | null }>());

  useEffect(() => {
    const jobs = pending.current;
    return () => {
      for (const job of jobs) {
        job.controller.abort();
        if (job.jobId !== null) void queryClient.cancelQueries(actions.job({ jobId: job.jobId }));
      }
      jobs.clear();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!active) return;
    for (const folder of folders) {
      if (triggered.current.has(folder)) continue;
      triggered.current.add(folder);
      const job: { controller: AbortController; jobId: string | null } = {
        controller: new AbortController(),
        jobId: null,
      };
      pending.current.add(job);
      void (async () => {
        try {
          const accepted = await runBackfill({ root: folder, force: false });
          job.jobId = accepted.jobId;
          await pollJobUntilTerminal(accepted.jobId, {
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            signal: job.controller.signal,
          });
        } catch {
          return;
        } finally {
          pending.current.delete(job);
          if (!job.controller.signal.aborted) {
            await Promise.allSettled([invalidateCollectionQueries(queryClient)]);
          }
        }
      })();
    }
  }, [active, folders, queryClient, runBackfill]);
};
