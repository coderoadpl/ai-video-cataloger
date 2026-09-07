import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { WhisperModelName } from '@core/domain/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';

import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatMb, whisperDiskUsageMb, type WhisperModelEntry } from './models-model.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { savedToastStore } from '../../lib/saved-toast.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';

export interface WhisperDownloadProgress {
  modelName: WhisperModelName;
  percentage: number;
}

export interface WhisperModelsState {
  isLoading: boolean;
  error: string | null;
  actionError: string | null;
  models: WhisperModelEntry[];
  diskUsageLabel: string;
  isBusy: boolean;
  downloadProgress: WhisperDownloadProgress | null;
  deletingModel: WhisperModelName | null;
  activatingModel: WhisperModelName | null;
  download: (modelName: WhisperModelName) => void;
  activate: (modelName: WhisperModelName) => void;
  remove: (modelName: WhisperModelName) => void;
  retry: () => void;
}

export interface UseWhisperModelsOptions {
  open: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useWhisperModels = ({
  open,
  addLine,
  intervalMs = 1000,
}: UseWhisperModelsOptions): WhisperModelsState => {
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const listQuery = useQuery({ ...actions.modelsWhisper, enabled: open });
  const downloadMutation = useMutation(actions.downloadWhisperModel);
  const activateMutation = useMutation(actions.useWhisperModel);
  const deleteMutation = useMutation(actions.deleteWhisperModel);

  const [downloadProgress, setDownloadProgress] = useState<WhisperDownloadProgress | null>(null);
  const [deletingModel, setDeletingModel] = useState<WhisperModelName | null>(null);
  const [activatingModel, setActivatingModel] = useState<WhisperModelName | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isBusy = downloadProgress !== null || deletingModel !== null || activatingModel !== null;
  const refetch = listQuery.refetch;

  const download = useCallback(
    (modelName: WhisperModelName) => {
      if (isBusy) return;
      setActionError(null);
      setDownloadProgress({ modelName, percentage: 0 });
      log(dictionary.models.terminal.downloadingWhisper(modelName), 'info');
      void (async () => {
        try {
          const accepted = await downloadMutation.mutateAsync({ modelName });
          const final = await pollJobUntilTerminal(accepted.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (id) => queryClient.fetchQuery(actions.job({ jobId: id })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            shouldStop: () => !guard.isMounted(),
            signal: guard.signal(),
            onSnapshot: (job) => {
              if (guard.isMounted() && job.progress !== null) {
                setDownloadProgress({ modelName, percentage: Math.round(job.progress.percentage ?? 0) });
              }
            },
          });
          if (final.status === 'completed') {
            if (!guard.isMounted()) return;
            log(dictionary.models.terminal.whisperDownloaded(modelName), 'success');
            await refetch();
            await queryClient.invalidateQueries();
            savedToastStore.show(dictionary.models.terminal.downloadedToast(modelName));
          } else if (guard.isMounted()) {
            const message = dictionary.models.terminal.failedDownload(
              modelName,
              final.error?.message ?? dictionary.models.terminal.unknownError,
            );
            log(message, 'error');
            setActionError(message);
          }
        } catch (error) {
          if (guard.isMounted()) {
            const message = dictionary.models.terminal.failedDownload(modelName, messageOf(error));
            log(message, 'error');
            setActionError(message);
          }
        } finally {
          if (guard.isMounted()) setDownloadProgress(null);
        }
      })();
    },
    [isBusy, log, downloadMutation, intervalMs, queryClient, refetch, dictionary, guard],
  );

  const activate = useCallback(
    (modelName: WhisperModelName) => {
      if (isBusy) return;
      setActionError(null);
      setActivatingModel(modelName);
      log(dictionary.models.terminal.settingActive(modelName), 'info');
      void (async () => {
        try {
          await activateMutation.mutateAsync({ modelName });
          if (!guard.isMounted()) return;
          log(dictionary.models.terminal.modelActive(modelName), 'success');
          await refetch();
          await queryClient.invalidateQueries();
          savedToastStore.show(dictionary.wizard.controller.whisperModelActive(modelName));
        } catch (error) {
          if (guard.isMounted()) {
            const message = dictionary.models.terminal.failedActivate(modelName, messageOf(error));
            log(message, 'error');
            setActionError(message);
          }
        } finally {
          if (guard.isMounted()) setActivatingModel(null);
        }
      })();
    },
    [isBusy, log, activateMutation, queryClient, refetch, dictionary, guard],
  );

  const remove = useCallback(
    (modelName: WhisperModelName) => {
      if (isBusy) return;
      setActionError(null);
      setDeletingModel(modelName);
      log(dictionary.models.terminal.deletingModel(modelName), 'info');
      void (async () => {
        try {
          await deleteMutation.mutateAsync({ modelName, force: true });
          if (!guard.isMounted()) return;
          log(dictionary.models.terminal.modelDeleted(modelName), 'success');
          await refetch();
          await queryClient.invalidateQueries();
          savedToastStore.show(dictionary.models.terminal.deletedToast(modelName));
        } catch (error) {
          if (guard.isMounted()) {
            const message = dictionary.models.terminal.failedDelete(modelName, messageOf(error));
            log(message, 'error');
            setActionError(message);
          }
        } finally {
          if (guard.isMounted()) setDeletingModel(null);
        }
      })();
    },
    [isBusy, log, deleteMutation, queryClient, refetch, dictionary, guard],
  );

  const models = listQuery.data?.models ?? [];

  return {
    isLoading: open && listQuery.isLoading,
    error: listQuery.error === null ? null : messageOf(listQuery.error),
    actionError,
    models,
    diskUsageLabel: formatMb(whisperDiskUsageMb(models)),
    isBusy,
    downloadProgress,
    deletingModel,
    activatingModel,
    download,
    activate,
    remove,
    retry: () => void refetch(),
  };
};
