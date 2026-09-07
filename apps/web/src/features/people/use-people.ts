import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import { facesReclusterOutputSchema, type facesPeopleOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';
import { useFacesIndex } from './use-faces-index.js';

export type FacePerson = z.output<typeof facesPeopleOutputSchema>['people'][number];
export type FacesReclusterReport = z.output<typeof facesReclusterOutputSchema>;

export interface PeopleState {
  facesEnabled: boolean | null;
  artifactsReady: boolean | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  mutationError: string | null;
  dismissMutationError: () => void;
  mergeError: string | null;
  clearMergeError: () => void;
  people: FacePerson[];
  observations: number;
  selectedPersonIds: string[];
  activeJobLabel: string | null;
  toggleSelected: (personId: string) => void;
  clearSelected: () => void;
  refresh: () => void;
  installArtifacts: () => void;
  indexFaces: () => void;
  rename: (personId: string, displayName: string) => void;
  merge: (input: { toPersonId: string; fromPersonIds: readonly string[] }) => Promise<boolean>;
  forget: (personId: string) => Promise<boolean>;
  purge: () => Promise<boolean>;
  reclusterDryRunReport: FacesReclusterReport | null;
  startReclusterDryRun: () => void;
  confirmRecluster: () => void;
  clearReclusterReport: () => void;
}

interface UsePeopleOptions {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  intervalMs?: number;
}

const FACES_JOB_KINDS = ['faces_index', 'faces_recluster', 'faces_exemplars'] as const;

const isFacesJobKind = (kind: string): boolean => FACES_JOB_KINDS.some((known) => known === kind);

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
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const facesIndex = useFacesIndex({ active, folder, addLine, intervalMs });
  const facesEnabled = facesIndex.facesEnabled;
  const artifactsReady = facesIndex.artifactsReady;
  const jobs = useQuery({
    ...actions.jobs,
    enabled: active && facesEnabled === true,
    refetchInterval: intervalMs,
  });
  const facesJobRunning = (jobs.data?.jobs ?? []).some(
    (job) => isFacesJobKind(job.kind) && !isTerminalJobStatus(job.status),
  );
  const status = useQuery({
    ...actions.facesStatus,
    enabled: active && facesEnabled === true,
    refetchInterval: facesJobRunning ? intervalMs : false,
  });
  const people = useQuery({
    ...actions.facesPeople,
    enabled: active && facesEnabled === true && artifactsReady === true,
    refetchInterval: facesJobRunning ? intervalMs : false,
  });

  const installMutation = useMutation(actions.installFaceArtifacts);
  const renameMutation = useMutation(actions.facesName);
  const mergeMutation = useMutation(actions.facesMerge);
  const forgetMutation = useMutation(actions.facesForget);
  const purgeMutation = useMutation(actions.facesPurge);
  const reclusterMutation = useMutation(actions.facesRecluster);

  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [reclusterDryRunReport, setReclusterDryRunReport] = useState<FacesReclusterReport | null>(null);
  const isBusy = activeJobLabel !== null
    || facesIndex.isBusy
    || renameMutation.isPending
    || mergeMutation.isPending
    || forgetMutation.isPending
    || purgeMutation.isPending
    || reclusterMutation.isPending;

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const facesJobWasRunning = useRef(false);
  useEffect(() => {
    const finished = facesJobWasRunning.current && !facesJobRunning;
    facesJobWasRunning.current = facesJobRunning;
    if (finished) void invalidate();
  }, [facesJobRunning, invalidate]);

  const runJob = useCallback(
    (accepted: Promise<{ jobId: string }>, label: string, success: string, failure: string) => {
      if (activeJobLabel !== null) return;
      setActiveJobLabel(label);
      setMutationError(null);
      log(label, 'info');
      void (async () => {
        try {
          const job = await accepted;
          const final = await pollJobUntilTerminal(job.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            shouldStop: () => !guard.isMounted(),
            signal: guard.signal(),
          });
          if (!guard.isMounted()) return;
          if (final.status === 'completed') {
            log(success, 'success');
            await invalidate();
          } else {
            const message = `${failure}: ${final.error?.message ?? 'unknown error'}`;
            log(message, 'error');
            setMutationError(message);
          }
        } catch (error) {
          if (guard.isMounted()) {
            const message = `${failure}: ${messageOf(error)}`;
            log(message, 'error');
            setMutationError(message);
          }
        } finally {
          if (guard.isMounted()) setActiveJobLabel(null);
        }
      })();
    },
    [activeJobLabel, log, intervalMs, invalidate, queryClient, guard],
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
    async (operation: Promise<unknown>, success: string, failure: string): Promise<boolean> => {
      setMutationError(null);
      try {
        await operation;
        if (!guard.isMounted()) return false;
        log(success, 'success');
        setSelectedPersonIds([]);
        return true;
      } catch (error) {
        if (!guard.isMounted()) return false;
        const applied = error instanceof ApiError && z.object({ applied: z.literal(true) }).safeParse(error.appError.details).success;
        const message = applied ? `${success}. ${messageOf(error)}` : messageOf(error);
        if (applied) setSelectedPersonIds([]);
        log(`${failure}: ${message}`, 'error');
        setMutationError(`${failure}: ${message}`);
        return false;
      } finally {
        await invalidate();
      }
    },
    [log, invalidate, guard],
  );

  const rename = useCallback(
    (personId: string, displayName: string) => {
      void mutateAndRefresh(
        renameMutation.mutateAsync({ personId, displayName }),
        dictionary.people.renamedGroupingLog(displayName),
        dictionary.people.renameGroupingFailedLog,
      );
    },
    [dictionary, mutateAndRefresh, renameMutation],
  );

  const merge = useCallback(
    async ({ toPersonId, fromPersonIds }: { toPersonId: string; fromPersonIds: readonly string[] }): Promise<boolean> => {
      setMergeError(null);
      for (const fromPersonId of fromPersonIds) {
        try {
          await mergeMutation.mutateAsync({ fromPersonId, toPersonId });
        } catch (error) {
          if (!guard.isMounted()) return false;
          const message = `${dictionary.people.mergeGroupingsFailedLog}: ${messageOf(error)}`;
          log(message, 'error');
          setMergeError(message);
          await invalidate();
          return false;
        }
      }
      if (!guard.isMounted()) return false;
      log(dictionary.people.mergedGroupingsLog, 'success');
      setSelectedPersonIds([]);
      await invalidate();
      return true;
    },
    [log, dictionary, invalidate, mergeMutation, guard],
  );

  const forget = useCallback(
    (personId: string) => mutateAndRefresh(
      forgetMutation.mutateAsync({ personId, force: true }),
      dictionary.people.deletedGroupingLog,
      dictionary.people.deleteGroupingFailedLog,
    ),
    [dictionary, forgetMutation, mutateAndRefresh],
  );

  const purge = useCallback(() => mutateAndRefresh(
    purgeMutation.mutateAsync({ force: true }),
    dictionary.people.deletedAllFaceDataLog,
    dictionary.people.deleteAllFaceDataFailedLog,
  ), [dictionary, mutateAndRefresh, purgeMutation]);

  const startReclusterDryRun = useCallback(() => {
    if (activeJobLabel !== null) return;
    const label = dictionary.people.reclusterDryRunLog;
    setActiveJobLabel(label);
    setMutationError(null);
    setReclusterDryRunReport(null);
    log(label, 'info');
    void (async () => {
      try {
        const job = await reclusterMutation.mutateAsync({ dryRun: true });
        const final = await pollJobUntilTerminal(job.jobId, {
          intervalMs,
          delay: sleep,
          fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
          isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
          shouldStop: () => !guard.isMounted(),
          signal: guard.signal(),
        });
        if (!guard.isMounted()) return;
        if (final.status !== 'completed') {
          const message = `${dictionary.people.reclusterDryRunFailedLog}: ${final.error?.message ?? 'unknown error'}`;
          log(message, 'error');
          setMutationError(message);
          return;
        }
        const parsed = facesReclusterOutputSchema.safeParse(final.result);
        if (!parsed.success) {
          const message = `${dictionary.people.reclusterDryRunFailedLog}: ${dictionary.people.reclusterReportUnavailable}`;
          log(message, 'error');
          setMutationError(message);
          return;
        }
        setReclusterDryRunReport(parsed.data);
        log(dictionary.people.reclusterDryRunReadyLog, 'success');
        await invalidate();
      } catch (error) {
        if (guard.isMounted()) {
          const message = `${dictionary.people.reclusterDryRunFailedLog}: ${messageOf(error)}`;
          log(message, 'error');
          setMutationError(message);
        }
      } finally {
        if (guard.isMounted()) setActiveJobLabel(null);
      }
    })();
  }, [activeJobLabel, log, dictionary, intervalMs, invalidate, queryClient, reclusterMutation, guard]);

  const confirmRecluster = useCallback(() => {
    setReclusterDryRunReport(null);
    runJob(
      reclusterMutation.mutateAsync({ dryRun: false }),
      dictionary.people.reclusterLog,
      dictionary.people.reclusteredLog,
      dictionary.people.reclusterFailedLog,
    );
  }, [dictionary, reclusterMutation, runJob]);

  const toggleSelected = useCallback((personId: string) => {
    setSelectedPersonIds((current) =>
      current.includes(personId)
        ? current.filter((selected) => selected !== personId)
        : [...current, personId]);
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
    mutationError,
    dismissMutationError: () => setMutationError(null),
    mergeError,
    clearMergeError: () => setMergeError(null),
    people: people.data?.people ?? [],
    observations: status.data?.observations ?? 0,
    selectedPersonIds,
    activeJobLabel: activeJobLabel ?? (facesJobRunning ? dictionary.people.indexingFacesLog : null),
    toggleSelected,
    clearSelected: () => setSelectedPersonIds([]),
    refresh: () => {
      void status.refetch();
      void people.refetch();
    },
    installArtifacts,
    indexFaces: facesIndex.indexFaces,
    rename,
    merge,
    forget,
    purge,
    reclusterDryRunReport,
    startReclusterDryRun,
    confirmRecluster,
    clearReclusterReport: () => setReclusterDryRunReport(null),
  };
};
