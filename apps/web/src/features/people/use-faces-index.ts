import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

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
    addLine(dictionary.people.indexingFacesLog, 'info');
    void (async () => {
      try {
        const job = await indexMutation.mutateAsync({ root: folder });
        const final = await pollJobUntilTerminal(job.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          onSnapshot: () => undefined,
        });
        if (final.status === 'completed') {
          addLine(dictionary.people.indexUpdatedLog, 'success');
          await queryClient.invalidateQueries();
        } else {
          const message = `${dictionary.people.indexFacesFailedLog}: ${final.error?.message ?? 'unknown error'}`;
          addLine(message, 'error');
          setActionError(message);
        }
      } catch (error) {
        const message = `${dictionary.people.indexFacesFailedLog}: ${messageOf(error)}`;
        addLine(message, 'error');
        setActionError(message);
      } finally {
        setActiveJobLabel(null);
      }
    })();
  }, [activeJobLabel, addLine, dictionary, folder, indexMutation, intervalMs, queryClient]);

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
