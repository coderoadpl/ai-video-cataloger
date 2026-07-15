import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';

import { actions } from '../../api.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

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
  const queryClient = useQueryClient();
  const status = useQuery({ ...actions.whisperRuntime, enabled: open });
  const mutation = useMutation(actions.installWhisperRuntime);
  const [isInstalling, setIsInstalling] = useState(false);
  const refetch = status.refetch;

  const install = useCallback(() => {
    if (isInstalling) return;
    setIsInstalling(true);
    addLine('Building the managed whisper.cpp runtime…', 'info');
    void (async () => {
      try {
        const accepted = await mutation.mutateAsync(undefined);
        const final = await pollJobUntilTerminal(accepted.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          onSnapshot: () => undefined,
        });
        if (final.status === 'completed') {
          addLine('Managed whisper.cpp runtime is ready', 'success');
          await refetch();
        } else {
          addLine(`Failed to install whisper.cpp: ${final.error?.message ?? 'unknown error'}`, 'error');
        }
      } catch (error) {
        addLine(`Failed to install whisper.cpp: ${messageOf(error)}`, 'error');
      } finally {
        setIsInstalling(false);
      }
    })();
  }, [isInstalling, addLine, mutation, intervalMs, queryClient, refetch]);

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
