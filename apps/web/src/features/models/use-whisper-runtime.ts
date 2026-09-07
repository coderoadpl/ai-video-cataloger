import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';

import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';

export interface WhisperRuntimeState {
  available: boolean;
  source: 'configured' | 'managed' | 'system' | null;
  path: string | null;
  buildToolsAvailable: boolean;
  missingBuildTools: string[];
  isLoading: boolean;
  isInstalling: boolean;
  error: string | null;
  install: () => void;
}

interface UseWhisperRuntimeOptions {
  open: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useWhisperRuntime = ({
  open,
  addLine,
  intervalMs = 1000,
}: UseWhisperRuntimeOptions): WhisperRuntimeState => {
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const status = useQuery({ ...actions.whisperRuntime, enabled: open });
  const mutation = useMutation(actions.installWhisperRuntime);
  const [isInstalling, setIsInstalling] = useState(false);
  const refetch = status.refetch;

  const install = useCallback(() => {
    if (isInstalling) return;
    setIsInstalling(true);
    log(dictionary.models.terminal.buildingWhisperRuntime, 'info');
    void (async () => {
      try {
        const accepted = await mutation.mutateAsync(undefined);
        const final = await pollJobUntilTerminal(accepted.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          shouldStop: () => !guard.isMounted(),
          signal: guard.signal(),
        });
        if (final.status === 'completed') {
          if (!guard.isMounted()) return;
          log(dictionary.models.terminal.whisperRuntimeReady, 'success');
          await refetch();
        } else {
          log(
            dictionary.models.terminal.failedWhisperRuntimeInstall(
              final.error?.message ?? dictionary.models.terminal.unknownError,
            ),
            'error',
          );
        }
      } catch (error) {
        log(dictionary.models.terminal.failedWhisperRuntimeInstall(messageOf(error)), 'error');
      } finally {
        if (guard.isMounted()) setIsInstalling(false);
      }
    })();
  }, [isInstalling, log, mutation, intervalMs, queryClient, refetch, dictionary, guard]);

  return {
    available: status.data?.available ?? false,
    source: status.data?.source ?? null,
    path: status.data?.path ?? null,
    buildToolsAvailable: status.data?.buildToolsAvailable ?? false,
    missingBuildTools: status.data?.missingBuildTools ?? [],
    isLoading: open && status.isLoading,
    isInstalling,
    error: status.error === null ? null : messageOf(status.error),
    install,
  };
};
