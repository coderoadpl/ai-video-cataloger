import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { facesPeopleOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';

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

export const usePeople = ({
  active,
  folder,
  addLine,
  intervalMs = 1000,
}: UsePeopleOptions): PeopleState => {
  const queryClient = useQueryClient();
  const config = useQuery({ ...actions.config({}), enabled: active });
  const facesEnabled = enabledValue(config.data !== undefined && 'effective' in config.data
    ? config.data.effective.faces_enabled
    : undefined);
  const artifacts = useQuery({ ...actions.faceArtifacts, enabled: active && facesEnabled === true });
  const status = useQuery({ ...actions.facesStatus, enabled: active && facesEnabled === true });
  const people = useQuery({
    ...actions.facesPeople,
    enabled: active && facesEnabled === true && artifacts.data?.ready === true,
  });

  const installMutation = useMutation(actions.installFaceArtifacts);
  const indexMutation = useMutation(actions.facesIndex);
  const renameMutation = useMutation(actions.facesName);
  const mergeMutation = useMutation(actions.facesMerge);
  const forgetMutation = useMutation(actions.facesForget);
  const purgeMutation = useMutation(actions.facesPurge);

  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const isBusy = activeJobLabel !== null
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
      'Installing face grouping models...',
      'Face grouping models are installed',
      'Failed to install face grouping models',
    );
  }, [installMutation, runJob]);

  const indexFaces = useCallback(() => {
    if (folder === null) return;
    runJob(
      indexMutation.mutateAsync({ root: folder }),
      'Indexing faces in the current folder...',
      'Face grouping index is updated',
      'Failed to index faces',
    );
  }, [folder, indexMutation, runJob]);

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
        `Renamed grouping to ${displayName}`,
        'Failed to rename grouping',
      );
    },
    [mutateAndRefresh, renameMutation],
  );

  const merge = useCallback(
    (fromPersonId: string, toPersonId: string) => {
      mutateAndRefresh(
        mergeMutation.mutateAsync({ fromPersonId, toPersonId }),
        'Merged face groupings',
        'Failed to merge face groupings',
      );
    },
    [mergeMutation, mutateAndRefresh],
  );

  const forget = useCallback(
    (personId: string) => {
      mutateAndRefresh(
        forgetMutation.mutateAsync({ personId, force: true }),
        'Deleted face grouping',
        'Failed to delete face grouping',
      );
    },
    [forgetMutation, mutateAndRefresh],
  );

  const purge = useCallback(() => {
    mutateAndRefresh(
      purgeMutation.mutateAsync({ force: true }),
      'Deleted all face data',
      'Failed to delete all face data',
    );
  }, [mutateAndRefresh, purgeMutation]);

  const toggleSelected = useCallback((personId: string) => {
    setSelectedPersonIds((current) =>
      current.includes(personId)
        ? current.filter((selected) => selected !== personId)
        : current.length >= 2 ? [current[1] ?? personId, personId] : [...current, personId]);
  }, []);

  const error = useMemo(() => {
    for (const query of [config, artifacts, status, people]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return null;
  }, [artifacts, config, people, status]);

  return {
    facesEnabled,
    artifactsReady: artifacts.data?.ready ?? null,
    isLoading: active && (
      config.isLoading
      || (facesEnabled === true && artifacts.isLoading)
      || (facesEnabled === true && artifacts.data?.ready === true && (status.isLoading || people.isLoading))
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
    indexFaces,
    rename,
    merge,
    forget,
    purge,
  };
};
