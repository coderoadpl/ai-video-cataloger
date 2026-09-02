import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidateBackupQueries, type BackupStatusOutput } from '@core/client/index.js';
import { backupPhaseSchema, isBackupErrorCode, type AppError, type BackupTier } from '@core/domain/index.js';

import { actions, bridge } from '../../api.js';
import { apiErrorMessage } from '../../i18n/api-error-message.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { backupErrorMessage, type RemoteBackupView } from './backup-model.js';

export interface BackupSectionState {
  status: BackupStatusOutput | undefined;
  isLoading: boolean;
  error: string | null;
  backups: readonly RemoteBackupView[];
  isListLoading: boolean;
  tierFilter: BackupTier | null;
  setTierFilter: (tier: BackupTier | null) => void;
  runNow: () => void;
  isRunning: boolean;
  setIncludeOptional: (include: boolean) => void;
  setRetention: (key: 'backup_keep_last' | 'backup_keep_weekly', value: number) => void;
  disable: () => void;
  restore: (remoteId: string, recoveryKey: string | undefined) => void;
  restorePhase: string | null;
  isRestoring: boolean;
  restoreError: string | null;
}

export const useBackupStatus = (options: { enabled?: boolean } = {}) =>
  useQuery({ ...actions.backupStatus, enabled: options.enabled ?? true });

export const useBackupSection = (open: boolean): BackupSectionState => {
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const [tierFilter, setTierFilter] = useState<BackupTier | null>(null);
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const statusQuery = useBackupStatus({ enabled: open });
  const enabled = statusQuery.data?.enabled === true;
  const listQuery = useQuery({ ...actions.backupList({ tier: tierFilter }), enabled: open && enabled });
  const run = useMutation(actions.backupRun);
  const disableBackup = useMutation(actions.backupDisable);
  const setConfig = useMutation(actions.setConfig);
  const restoreBackup = useMutation(actions.backupRestore);
  const restoreJob = useQuery({
    ...actions.job({ jobId: restoreJobId ?? 'pending' }),
    enabled: restoreJobId !== null,
  });
  const restoreStatus = restoreJob.data?.status;

  const refreshStatus = useCallback(() => {
    void invalidateBackupQueries(queryClient);
  }, [queryClient]);

  useEffect(() => {
    if (restoreStatus === 'completed') void bridge.app.relaunch();
  }, [restoreStatus]);

  const jobError = restoreJob.data?.error ?? null;
  const restoreFailure = restoreBackup.error ?? null;

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    error: firstErrorMessage(
      [statusQuery.error, listQuery.error, run.error, disableBackup.error, setConfig.error],
      dictionary,
    ),
    backups: listQuery.data?.backups ?? [],
    isListLoading: listQuery.isLoading,
    tierFilter,
    setTierFilter,
    runNow: () => {
      run.mutate({ tier: 'critical' }, { onSuccess: refreshStatus });
    },
    isRunning: run.isPending || statusQuery.data?.indicator === 'running',
    setIncludeOptional: (include) => {
      setConfig.mutate({ key: 'backup_include_optional', value: String(include) }, { onSuccess: refreshStatus });
    },
    setRetention: (key, value) => {
      setConfig.mutate({ key, value: String(value) }, { onSuccess: refreshStatus });
    },
    disable: () => {
      disableBackup.mutate({ purgeCredentials: false }, { onSuccess: refreshStatus });
    },
    restore: (remoteId, recoveryKey) => {
      restoreBackup.mutate({ remoteId, ...(recoveryKey === undefined ? {} : { recoveryKey }) }, {
        onSuccess: (accepted) => {
          setRestoreJobId(accepted.jobId);
        },
      });
    },
    restorePhase: phaseLabel(restoreJob.data?.progress?.step ?? null, dictionary),
    isRestoring: restoreBackup.isPending || (restoreJobId !== null && restoreStatus !== 'failed'),
    restoreError: restoreFailure === null
      ? appErrorMessage(jobError, dictionary)
      : describeError(restoreFailure, dictionary),
  };
};

export const appErrorMessage = (error: AppError | null, dictionary: Dictionary): string | null => {
  if (error === null) return null;
  return isBackupErrorCode(error.code) ? dictionary.backup.errorMessages[error.code] : error.message;
};

export const phaseLabel = (step: string | null, dictionary: Dictionary): string | null => {
  if (step === null) return null;
  const phase = backupPhaseSchema.safeParse(step);
  return phase.success ? dictionary.backup.phases[phase.data] : null;
};

const firstErrorMessage = (errors: readonly unknown[], dictionary: Dictionary): string | null => {
  const failure = errors.find((error) => error !== null && error !== undefined);
  return failure === undefined ? null : describeError(failure, dictionary);
};

const describeError = (error: unknown, dictionary: Dictionary): string =>
  backupErrorMessage(error, dictionary.backup.errorMessages) ?? apiErrorMessage(error, dictionary);
