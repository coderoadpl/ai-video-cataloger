import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, invalidatePairReviewQueue, invalidatePeopleMergeConsumers } from '@core/client/index.js';
import type { facesPairsOutputSchema } from '@core/contract/index.js';
import { PAIR_REVIEW_DEFAULT_LIMIT, type PeoplePairDecisionKind } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { useMountGuard } from '../../components/ui/use-mount-guard.js';

export type FacesPairsOutput = z.output<typeof facesPairsOutputSchema>;
export type FacesPairCandidate = FacesPairsOutput['candidates'][number];
export type FacesPairPerson = FacesPairCandidate['a'];

export interface PeoplePairsState {
  pending: number;
  truncated: boolean;
  limit: number;
  current: FacesPairCandidate | null;
  queueLength: number;
  answeredThisSession: number;
  isLoading: boolean;
  isBusy: boolean;
  canUndo: boolean;
  notUndoable: boolean;
  error: string | null;
  openSession: () => void;
  decide: (decision: PeoplePairDecisionKind, survivorPersonId?: string) => void;
  undo: () => void;
}

interface UsePeoplePairsOptions {
  enabled: boolean;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const isSamePair = (candidate: FacesPairCandidate, personAId: string, personBId: string): boolean =>
  (candidate.a.personId === personAId && candidate.b.personId === personBId)
  || (candidate.a.personId === personBId && candidate.b.personId === personAId);

export const usePeoplePairs = ({ enabled }: UsePeoplePairsOptions): PeoplePairsState => {
  const guard = useMountGuard();
  const queryClient = useQueryClient();
  const pairs = useQuery({ ...actions.facesPairs(), enabled });
  const decideMutation = useMutation(actions.facesPairsDecide);
  const undoMutation = useMutation(actions.facesPairsUndo);

  const [answered, setAnswered] = useState<FacesPairCandidate[]>([]);
  const [restored, setRestored] = useState<FacesPairCandidate | null>(null);
  const [undoRefused, setUndoRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => pairs.data?.candidates ?? [], [pairs.data]);
  const queue = useMemo(
    () => restored === null || candidates.some((entry) => isSamePair(entry, restored.a.personId, restored.b.personId))
      ? candidates
      : [restored, ...candidates],
    [candidates, restored],
  );
  const inFlight = useRef(false);
  const isBusy = decideMutation.isPending || undoMutation.isPending;

  const openSession = useCallback(() => {
    setAnswered([]);
    setRestored(null);
    setUndoRefused(false);
    setError(null);
  }, []);

  const refreshQueue = useCallback(
    (merged: boolean) => merged ? invalidatePeopleMergeConsumers(queryClient) : invalidatePairReviewQueue(queryClient),
    [queryClient],
  );

  const decide = useCallback(
    (decision: PeoplePairDecisionKind, survivorPersonId?: string) => {
      const candidate = queue[0];
      if (candidate === undefined || inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        setError(null);
        try {
          await decideMutation.mutateAsync({
            personAId: candidate.a.personId,
            personBId: candidate.b.personId,
            decision,
            ...(survivorPersonId === undefined ? {} : { survivorPersonId }),
          });
          if (!guard.isMounted()) return;
          setAnswered((current) => [...current, candidate]);
          setRestored(null);
          setUndoRefused(false);
        } catch (caught) {
          if (guard.isMounted()) setError(messageOf(caught));
        } finally {
          inFlight.current = false;
          await refreshQueue(decision === 'same');
        }
      })();
    },
    [decideMutation, guard, queue, refreshQueue],
  );

  const undo = useCallback(() => {
    const last = answered[answered.length - 1];
    if (last === undefined || undoRefused || inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      setError(null);
      try {
        const output = await undoMutation.mutateAsync({});
        if (!guard.isMounted()) return;
        if (!output.undone) {
          if (output.reason === 'merge_not_undoable') setUndoRefused(true);
          return;
        }
        if (output.personAId === null || output.personBId === null) return;
        setAnswered((current) => current.slice(0, -1));
        if (isSamePair(last, output.personAId, output.personBId)) setRestored(last);
      } catch (caught) {
        if (guard.isMounted()) setError(messageOf(caught));
      } finally {
        inFlight.current = false;
        await refreshQueue(false);
      }
    })();
  }, [answered, guard, refreshQueue, undoMutation, undoRefused]);

  return {
    pending: pairs.data?.pending ?? 0,
    truncated: pairs.data?.truncated ?? false,
    limit: PAIR_REVIEW_DEFAULT_LIMIT,
    current: queue[0] ?? null,
    queueLength: queue.length,
    answeredThisSession: answered.length,
    isLoading: enabled && pairs.isLoading,
    isBusy,
    canUndo: answered.length > 0 && !undoRefused && !isBusy,
    notUndoable: undoRefused,
    error,
    openSession,
    decide,
    undo,
  };
};
