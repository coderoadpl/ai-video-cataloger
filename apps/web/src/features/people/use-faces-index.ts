import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';

import { invalidateAffected } from '../../api-invalidation.js';
import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';

const enabledValue = (value: string | undefined): boolean | null => {
  if (value === undefined) return null;
  const normalized = value.toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

interface UseFacesIndexOptions {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  intervalMs?: number;
}

export interface FacesIndexState {
  facesEnabled: boolean | null;
  artifactsReady: boolean | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  actionError: string | null;
  indexFaces: () => void;
}

export const useFacesIndex = ({
  active,
  folder,
  addLine,
  intervalMs = 1000,
}: UseFacesIndexOptions): FacesIndexState => {
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const config = useQuery({ ...actions.config({}), enabled: active });
  const facesEnabled = enabledValue(config.data !== undefined && 'effective' in config.data
    ? config.data.effective.faces_enabled
    : undefined);
  const artifacts = useQuery({ ...actions.faceArtifacts, enabled: active && facesEnabled === true });
  const indexMutation = useMutation(actions.facesIndex);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const indexFaces = useCallback(() => {
    if (folder === null || activeJobLabel !== null) return;
    setActiveJobLabel(dictionary.people.indexingFacesLog);
    setActionError(null);
    log(dictionary.people.indexingFacesLog, 'info');
    void (async () => {
      try {
        const job = await indexMutation.mutateAsync({ root: folder });
        const final = await pollJobUntilTerminal(job.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          shouldStop: () => !guard.isMounted(),
          signal: guard.signal(),
        });
        if (final.status === 'completed') {
          if (!guard.isMounted()) return;
          log(dictionary.people.indexUpdatedLog, 'success');
          await invalidateAffected(queryClient, 'faces');
        } else if (guard.isMounted()) {
          const failure = formatAnalyzerError(final.error?.message ?? '', dictionary.errors);
          const message = failure.length === 0
            ? dictionary.people.indexFacesFailedLog
            : `${dictionary.people.indexFacesFailedLog}: ${failure}`;
          log(message, 'error');
          setActionError(message);
        }
      } catch (error) {
        if (guard.isMounted()) {
          const failure = formatAnalyzerError(messageOf(error), dictionary.errors);
          const message = `${dictionary.people.indexFacesFailedLog}: ${failure}`;
          log(message, 'error');
          setActionError(message);
        }
      } finally {
        if (guard.isMounted()) setActiveJobLabel(null);
      }
    })();
  }, [activeJobLabel, log, dictionary, folder, indexMutation, intervalMs, queryClient, guard]);

  const error = config.error !== null
    ? messageOf(config.error)
    : artifacts.error !== null ? messageOf(artifacts.error) : null;

  return {
    facesEnabled,
    artifactsReady: artifacts.data?.ready ?? null,
    isLoading: active && (config.isLoading || (facesEnabled === true && artifacts.isLoading)),
    isBusy: activeJobLabel !== null,
    error,
    actionError,
    indexFaces,
  };
};
