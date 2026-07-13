import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';

import { actions } from '../../api.js';
import type { LocalAiTier, Machine } from './models-model.js';
import { runJobToTerminal, sleep } from './run-job.js';

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

/**
 * Local-AI (managed Ollama) requirements/pull/remove for the Model Manager
 * (parity-inventory §2/§6). Machine summary and hardware tiers come from the
 * bound `localAiRequirements` query; a pull runs as a job advancing a progress
 * bar, delete is a one-shot mutation. Read-only status never starts the runtime;
 * pull is the start point.
 */
export const useLocalAi = ({ open, addLine, intervalMs = 1000 }: UseLocalAiOptions): LocalAiState => {
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
      addLine(`Downloading local AI model ${tier.tag} (${tier.downloadGB} GB)…`, 'info');
      void (async () => {
        try {
          const accepted = await pullMutation.mutateAsync({ tag: tier.tag });
          const final = await runJobToTerminal(accepted.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
            onSnapshot: (job) => {
              if (job.progress !== null) {
                setPullProgress({ tag: tier.tag, percentage: Math.round(job.progress.percentage ?? 0) });
              }
            },
          });
          if (final.status === 'completed') {
            addLine(`Model ${tier.tag} is ready`, 'success');
            await refetch();
          } else {
            addLine(`Failed to download ${tier.tag}: ${final.error?.message ?? 'unknown error'}`, 'error');
          }
        } catch (error) {
          addLine(`Failed to download ${tier.tag}: ${messageOf(error)}`, 'error');
        } finally {
          setPullProgress(null);
        }
      })();
    },
    [isBusy, addLine, pullMutation, intervalMs, queryClient, refetch],
  );

  const remove = useCallback(
    (tier: LocalAiTier) => {
      if (isBusy) return;
      setRemovingTag(tier.tag);
      addLine(`Removing local AI model ${tier.tag}…`, 'info');
      void (async () => {
        try {
          await removeMutation.mutateAsync({ tag: tier.tag });
          addLine(`Removed ${tier.tag}`, 'success');
          await refetch();
        } catch (error) {
          addLine(`Failed to remove ${tier.tag}: ${messageOf(error)}`, 'error');
        } finally {
          setRemovingTag(null);
        }
      })();
    },
    [isBusy, addLine, removeMutation, refetch],
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
