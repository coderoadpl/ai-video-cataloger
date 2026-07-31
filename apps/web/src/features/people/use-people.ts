import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { facesPeopleOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useFacesIndex } from './use-faces-index.js';

export type FacePerson = z.output<typeof facesPeopleOutputSchema>['people'][number];

export interface PeopleState {
  facesEnabled: boolean | null;
  artifactsReady: boolean | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  people: FacePerson[];
  observations: number;
  selectedPersonIds: string[];
  activeJobLabel: string | null;
  toggleSelected: (personId: string) => void;
  clearSelected: () => void;
  installArtifacts: () => void;
  indexFaces: () => void;
  rename: (personId: string, displayName: string) => void;
  merge: (fromPersonId: string, toPersonId: string) => void;
  forget: (personId: string) => void;
  purge: () => void;
}

interface UsePeopleOptions {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  intervalMs?: number;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePeople = ({
  active,
  folder,
  addLine,
  intervalMs = 1000,
}: UsePeopleOptions): PeopleState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const facesIndex = useFacesIndex({ active, folder, addLine, intervalMs });
  const facesEnabled = facesIndex.facesEnabled;
  const artifactsReady = facesIndex.artifactsReady;
  const status = useQuery({ ...actions.facesStatus, enabled: active && facesEnabled === true });
  const people = useQuery({
    ...actions.facesPeople,
    enabled: active && facesEnabled === true && artifactsReady === true,
  });

  const installMutation = useMutation(actions.installFaceArtifacts);
  const renameMutation = useMutation(actions.facesName);
  const mergeMutation = useMutation(actions.facesMerge);
  const forgetMutation = useMutation(actions.facesForget);
  const purgeMutation = useMutation(actions.facesPurge);

  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const isBusy = activeJobLabel !== null
    || facesIndex.isBusy
    || renameMutation.isPending
    || mergeMutation.isPending
    || forgetMutation.isPending
    || purgeMutation.isPending;

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const runJob = useCallback(
    (accepted: Promise<{ jobId: string }>, label: string, success: string, failure: string) => {
      if (activeJobLabel !== null) return;
      setActiveJobLabel(label);
      addLine(label, 'info');
      void (async () => {
        try {
          const job = await accepted;
          const final = await pollJobUntilTerminal(job.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            onSnapshot: () => undefined,
          });
          if (final.status === 'completed') {
            addLine(success, 'success');
            await invalidate();
          } else {
            addLine(`${failure}: ${final.error?.message ?? 'unknown error'}`, 'error');
          }
        } catch (error) {
          addLine(`${failure}: ${messageOf(error)}`, 'error');
        } finally {
          setActiveJobLabel(null);
        }
      })();
    },
    [activeJobLabel, addLine, intervalMs, invalidate, queryClient],
  );

  const installArtifacts = useCallback(() => {
    runJob(
      installMutation.mutateAsync({ force: false }),
      dictionary.people.installingModelsLog,
      dictionary.people.modelsInstalledLog,
      dictionary.people.installModelsFailedLog,
    );
  }, [dictionary, installMutation, runJob]);

  const mutateAndRefresh = useCallback(
    (operation: Promise<unknown>, success: string, failure: string) => {
      void (async () => {
        try {
          await operation;
          addLine(success, 'success');
          setSelectedPersonIds([]);
          await invalidate();
        } catch (error) {
          addLine(`${failure}: ${messageOf(error)}`, 'error');
        }
      })();
    },
    [addLine, invalidate],
  );

  const rename = useCallback(
    (personId: string, displayName: string) => {
      mutateAndRefresh(
        renameMutation.mutateAsync({ personId, displayName }),
        dictionary.people.renamedGroupingLog(displayName),
        dictionary.people.renameGroupingFailedLog,
      );
    },
    [dictionary, mutateAndRefresh, renameMutation],
  );

  const merge = useCallback(
    (fromPersonId: string, toPersonId: string) => {
      mutateAndRefresh(
        mergeMutation.mutateAsync({ fromPersonId, toPersonId }),
        dictionary.people.mergedGroupingsLog,
        dictionary.people.mergeGroupingsFailedLog,
      );
    },
    [dictionary, mergeMutation, mutateAndRefresh],
  );

  const forget = useCallback(
    (personId: string) => {
      mutateAndRefresh(
        forgetMutation.mutateAsync({ personId, force: true }),
        dictionary.people.deletedGroupingLog,
        dictionary.people.deleteGroupingFailedLog,
      );
    },
    [dictionary, forgetMutation, mutateAndRefresh],
  );

  const purge = useCallback(() => {
    mutateAndRefresh(
      purgeMutation.mutateAsync({ force: true }),
      dictionary.people.deletedAllFaceDataLog,
      dictionary.people.deleteAllFaceDataFailedLog,
    );
  }, [dictionary, mutateAndRefresh, purgeMutation]);

  const toggleSelected = useCallback((personId: string) => {
    setSelectedPersonIds((current) =>
      current.includes(personId)
        ? current.filter((selected) => selected !== personId)
        : current.length >= 2 ? [current[1] ?? personId, personId] : [...current, personId]);
  }, []);

  const error = useMemo(() => {
    if (facesIndex.error !== null) return facesIndex.error;
    for (const query of [status, people]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return null;
  }, [facesIndex.error, people, status]);

  return {
    facesEnabled,
    artifactsReady,
    isLoading: active && (
      facesIndex.isLoading
      || (facesEnabled === true && artifactsReady === true && (status.isLoading || people.isLoading))
    ),
    isBusy,
    error,
    people: people.data?.people ?? [],
    observations: status.data?.observations ?? 0,
    selectedPersonIds,
    activeJobLabel,
    toggleSelected,
    clearSelected: () => setSelectedPersonIds([]),
    installArtifacts,
    indexFaces: facesIndex.indexFaces,
    rename,
    merge,
    forget,
    purge,
  };
};
