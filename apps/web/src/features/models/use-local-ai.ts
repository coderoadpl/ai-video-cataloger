import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';

import { invalidateAffected } from '../../api-invalidation.js';
import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { LocalAiTier, Machine } from './models-model.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useSavedToast } from '../../components/ui/SavedToastProvider.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';

export interface LocalAiPullProgress {
  tag: string;
  percentage: number;
}

export interface LocalAiState {
  isLoading: boolean;
  error: string | null;
  machine: Machine | null;
  tiers: LocalAiTier[] | null;
  recommendedTag: string | null;
  isBusy: boolean;
  pullProgress: LocalAiPullProgress | null;
  removingTag: string | null;
  pull: (tier: LocalAiTier) => void;
  remove: (tier: LocalAiTier) => void;
}

export interface UseLocalAiOptions {
  open: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useLocalAi = ({ open, addLine, intervalMs = 1000 }: UseLocalAiOptions): LocalAiState => {
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const dictionary = useDictionary();
  const showSavedToast = useSavedToast();
  const queryClient = useQueryClient();
  const requirementsQuery = useQuery({ ...actions.localAiRequirements, enabled: open });
  const pullMutation = useMutation(actions.pullLocalAiModel);
  const removeMutation = useMutation(actions.removeLocalAiModel);

  const [pullProgress, setPullProgress] = useState<LocalAiPullProgress | null>(null);
  const [removingTag, setRemovingTag] = useState<string | null>(null);

  const isBusy = pullProgress !== null || removingTag !== null;
  const refetch = requirementsQuery.refetch;

  const pull = useCallback(
    (tier: LocalAiTier) => {
      if (isBusy) return;
      setPullProgress({ tag: tier.tag, percentage: 0 });
      log(dictionary.models.terminal.downloadingLocalAi(tier.tag, tier.downloadGB), 'info');
      void (async () => {
        try {
          const accepted = await pullMutation.mutateAsync({ tag: tier.tag });
          const final = await pollJobUntilTerminal(accepted.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            shouldStop: () => !guard.isMounted(),
            signal: guard.signal(),
            onSnapshot: (job) => {
              if (guard.isMounted() && job.progress !== null) {
                setPullProgress({ tag: tier.tag, percentage: Math.round(job.progress.percentage ?? 0) });
              }
            },
          });
          if (final.status === 'completed') {
            if (!guard.isMounted()) return;
            log(dictionary.models.terminal.localAiReady(tier.tag), 'success');
            await refetch();
            await invalidateAffected(queryClient, 'localAi');
            showSavedToast(dictionary.models.terminal.downloadedToast(tier.tag));
          } else {
            log(
              dictionary.models.terminal.failedLocalAiDownload(
                tier.tag,
                final.error?.message ?? dictionary.models.terminal.unknownError,
              ),
              'error',
            );
          }
        } catch (error) {
          log(dictionary.models.terminal.failedLocalAiDownload(tier.tag, messageOf(error)), 'error');
        } finally {
          if (guard.isMounted()) setPullProgress(null);
        }
      })();
    },
    [showSavedToast, isBusy, log, pullMutation, intervalMs, queryClient, refetch, dictionary, guard],
  );

  const remove = useCallback(
    (tier: LocalAiTier) => {
      if (isBusy) return;
      setRemovingTag(tier.tag);
      log(dictionary.models.terminal.removingLocalAi(tier.tag), 'info');
      void (async () => {
        try {
          await removeMutation.mutateAsync({ tag: tier.tag });
          if (!guard.isMounted()) return;
          log(dictionary.models.terminal.removedLocalAi(tier.tag), 'success');
          await refetch();
          await invalidateAffected(queryClient, 'localAi');
          showSavedToast(dictionary.models.terminal.removedLocalAi(tier.tag));
        } catch (error) {
          log(dictionary.models.terminal.failedLocalAiRemove(tier.tag, messageOf(error)), 'error');
        } finally {
          if (guard.isMounted()) setRemovingTag(null);
        }
      })();
    },
    [showSavedToast, isBusy, log, removeMutation, queryClient, refetch, dictionary, guard],
  );

  const tiers = requirementsQuery.data?.tiers ?? null;
  const recommendedTag = tiers?.find((tier) => tier.recommended)?.tag ?? null;

  return {
    isLoading: open && requirementsQuery.isLoading,
    error: requirementsQuery.error === null ? null : messageOf(requirementsQuery.error),
    machine: requirementsQuery.data?.machine ?? null,
    tiers,
    recommendedTag,
    isBusy,
    pullProgress,
    removingTag,
    pull,
    remove,
  };
};
