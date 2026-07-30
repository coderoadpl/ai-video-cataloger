import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, isTerminalJobStatus } from '@core/client/index.js';
import type { photosDetailOutputSchema, photosTreeOutputSchema } from '@core/contract/index.js';

import { actions, bridge } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import type { PhotoListItem } from './core/index.js';

export type PhotoRoot = z.output<typeof photosTreeOutputSchema>['roots'][number];
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;

const PAGE_LIMIT = 200;

interface UsePhotosOptions {
  active: boolean;
  addLine: AddLogLine;
  intervalMs?: number;
}

export interface PhotosState {
  isLoading: boolean;
  error: string | null;
  roots: PhotoRoot[];
  selectedRoot: string | null;
  selectRoot: (root: string | null) => void;
  items: PhotoListItem[];
  total: number;
  counts: { photos: number; paths: number; proxied: number; proxyFailed: number } | null;
  activeJobLabel: string | null;
  isBusy: boolean;
  scanFolder: () => void;
  generateProxies: () => void;
  selectedFingerprint: string | null;
  selectFingerprint: (fingerprint: string | null) => void;
  detail: PhotoDetail | null;
  isDetailLoading: boolean;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePhotos = ({ active, addLine, intervalMs = 1000 }: UsePhotosOptions): PhotosState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const status = useQuery({ ...actions.photosStatus(selectedRoot === null ? {} : { root: selectedRoot }), enabled: active });
  const list = useQuery({
    ...actions.photosList({ ...(selectedRoot === null ? {} : { root: selectedRoot }), offset: 0, limit: PAGE_LIMIT }),
    enabled: active,
  });
  const detail = useQuery({
    ...actions.photosDetail({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const scanMutation = useMutation(actions.photosScan);
  const proxiesMutation = useMutation(actions.photosProxies);

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

  const scanFolder = useCallback(() => {
    void (async () => {
      const picked = await bridge.folder.showPicker('photos');
      if (picked === null) return;
      runJob(
        scanMutation.mutateAsync({ root: picked }),
        dictionary.photos.scanProgress(0, 0),
        dictionary.photos.title,
        dictionary.photos.title,
      );
      setSelectedRoot(picked);
    })();
  }, [dictionary, runJob, scanMutation]);

  const generateProxies = useCallback(() => {
    if (selectedRoot === null) return;
    runJob(
      proxiesMutation.mutateAsync({ root: selectedRoot, force: false }),
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
    );
  }, [dictionary, proxiesMutation, runJob, selectedRoot]);

  const error = useMemo(() => {
    for (const query of [tree, status, list]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return null;
  }, [list, status, tree]);

  return {
    isLoading: active && (tree.isLoading || status.isLoading || list.isLoading),
    error,
    roots: tree.data?.roots ?? [],
    selectedRoot,
    selectRoot: setSelectedRoot,
    items: list.data?.items ?? [],
    total: list.data?.total ?? 0,
    counts: status.data === undefined
      ? null
      : {
        photos: status.data.counts.photos,
        paths: status.data.counts.paths,
        proxied: status.data.counts.proxied,
        proxyFailed: status.data.counts.proxyFailed,
      },
    activeJobLabel,
    isBusy: activeJobLabel !== null,
    scanFolder,
    generateProxies,
    selectedFingerprint,
    selectFingerprint: setSelectedFingerprint,
    detail: detail.data ?? null,
    isDetailLoading: detail.isLoading,
  };
};

export type { PhotoListItem };
