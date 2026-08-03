import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, invalidatePhotosQueries, isTerminalJobStatus, type JobOutput } from '@core/client/index.js';
import type { photosDetailOutputSchema, photosVariantRecordSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import type { CancelConfirmation } from '../../components/ui/dialogs/CancelConfirmationDialog.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { ownerRootFor, type PhotoListItem, type PhotoRoot } from './core/index.js';

const PAGE_LIMIT = 200;
const SCOPE_KEY = 'avc.photosScope';

export type PhotosAnalysisScope = 'folder' | 'all';
export type PhotosFolderState = 'no-folder' | 'unscanned' | 'scanned';
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;
export type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

const isScope = (value: string | null): value is PhotosAnalysisScope => value === 'folder' || value === 'all';

const readScope = (): PhotosAnalysisScope => {
  if (!canUseStorage()) return 'folder';
  const raw = window.localStorage.getItem(SCOPE_KEY);
  return isScope(raw) ? raw : 'folder';
};

const deriveSelectedRoot = (folder: string | null, roots: readonly PhotoRoot[]): string | null => {
  if (folder === null) return null;
  return roots.find((root) => root.root === folder)?.root ?? null;
};

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

interface UsePhotosAnalysisOptions {
  active: boolean;
  addLine: AddLogLine;
  folder: string | null;
  intervalMs?: number;
}

export interface PhotosAnalysisState {
  isLoading: boolean;
  error: string | null;
  roots: PhotoRoot[];
  scope: PhotosAnalysisScope;
  setScope: (scope: PhotosAnalysisScope) => void;
  folder: string | null;
  folderState: PhotosFolderState;
  selectedRoot: string | null;
  items: PhotoListItem[];
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  counts: { photos: number; paths: number; proxied: number; proxyFailed: number } | null;
  selectedFingerprint: string | null;
  selectFingerprint: (fingerprint: string | null) => void;
  activeJobLabel: string | null;
  analyzeStatusLabel: string | null;
  isBusy: boolean;
  scanFolder: () => void;
  detail: PhotoDetail | null;
  isDetailLoading: boolean;
  variants: PhotoVariantRecord[];
  selectVariant: (configId: string | null) => void;
  analyzePhotos: () => void;
  canAnalyze: boolean;
  analyzeSelectedPhoto: () => void;
  canAnalyzeSelectedPhoto: boolean;
  analyzeProgress: { current: number; total: number } | null;
  processingFingerprints: ReadonlySet<string>;
  generateProxies: () => void;
  isCancellable: boolean;
  cancelConfirmation: CancelConfirmation;
  requestCancelAnalysis: () => void;
  confirmCancelAnalysis: () => void;
  closeCancelConfirmation: () => void;
}

export const usePhotosAnalysis = ({ active, addLine, folder, intervalMs = 1000 }: UsePhotosAnalysisOptions): PhotosAnalysisState => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const [scope, setScopeState] = useState<PhotosAnalysisScope>(() => readScope());
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [activeAnalyzeJobId, setActiveAnalyzeJobId] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);
  const [rootProgress, setRootProgress] = useState<{ current: number; total: number } | null>(null);
  const [processingFingerprints, setProcessingFingerprints] = useState<ReadonlySet<string>>(() => new Set());
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({ open: false, isBatch: false });
  const [jobError, setJobError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadedItems, setLoadedItems] = useState<PhotoListItem[]>([]);
  const processingSetRef = useRef<Set<string>>(new Set());
  const lastAnalyzeSequenceRef = useRef(0);
  const analyzeJobIdRef = useRef<string | null>(null);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const treeRoots = tree.data?.roots;
  const roots = useMemo(() => treeRoots ?? [], [treeRoots]);

  const selectedRoot = useMemo(() => deriveSelectedRoot(folder, roots), [folder, roots]);
  const folderState = useMemo<PhotosFolderState>(() => {
    if (folder === null) return 'no-folder';
    return selectedRoot === null ? 'unscanned' : 'scanned';
  }, [folder, selectedRoot]);

  const setScope = useCallback((next: PhotosAnalysisScope) => {
    setScopeState(next);
    if (canUseStorage()) window.localStorage.setItem(SCOPE_KEY, next);
  }, []);

  const listRoot = scope === 'folder' ? selectedRoot : null;

  useEffect(() => {
    setOffset(0);
  }, [listRoot]);

  const list = useQuery({
    ...actions.photosList({ ...(listRoot === null ? {} : { root: listRoot }), offset, limit: PAGE_LIMIT }),
    enabled: active,
  });

  const mergedOffsetRef = useRef(-1);
  useEffect(() => {
    if (list.data === undefined) return;
    if (offset === 0) {
      setLoadedItems(list.data.items);
      mergedOffsetRef.current = 0;
      return;
    }
    if (mergedOffsetRef.current === offset) return;
    setLoadedItems((current) => [...current, ...list.data.items]);
    mergedOffsetRef.current = offset;
  }, [list.data, offset]);

  const loadMore = useCallback(() => setOffset((current) => current + PAGE_LIMIT), []);

  const status = useQuery({
    ...actions.photosStatus(selectedRoot === null ? {} : { root: selectedRoot }),
    enabled: active && selectedRoot !== null,
  });

  const detail = useQuery({
    ...actions.photosDetail({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const variants = useQuery({
    ...actions.photosVariants({ fingerprint: selectedFingerprint ?? '' }),
    enabled: active && selectedFingerprint !== null,
  });

  const scanMutation = useMutation(actions.photosScan);
  const proxiesMutation = useMutation(actions.photosProxies);
  const processMutation = useMutation(actions.photosProcess);
  const selectVariantMutation = useMutation(actions.photosVariantsSelect);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const runJob = useCallback(
    (
      accepted: Promise<{ jobId: string }>,
      label: string,
      success: string,
      failure: string,
      onSnapshot?: (snapshot: JobOutput) => void,
      onJobAccepted?: (jobId: string) => void,
      onSettled?: () => void,
    ) => {
      if (activeJobLabel !== null) return;
      setActiveJobLabel(label);
      setJobError(null);
      addLine(label, 'info');
      void (async () => {
        try {
          const job = await accepted;
          onJobAccepted?.(job.jobId);
          const final = await pollJobUntilTerminal(job.jobId, {
            intervalMs,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            onSnapshot: onSnapshot ?? (() => undefined),
          });
          if (final.status === 'completed') {
            addLine(success, 'success');
            await invalidate();
          } else if (final.status === 'cancelled') {
            addLine(dictionary.photos.analysisCancelled, 'info');
            await invalidate();
          } else {
            const message = `${failure}: ${final.error?.message ?? 'unknown error'}`;
            addLine(message, 'error');
            setJobError(message);
          }
        } catch (error) {
          const message = `${failure}: ${messageOf(error)}`;
          addLine(message, 'error');
          setJobError(message);
        } finally {
          setActiveJobLabel(null);
          onSettled?.();
        }
      })();
    },
    [activeJobLabel, addLine, dictionary, intervalMs, invalidate, queryClient],
  );

  const scanFolder = useCallback(() => {
    if (activeJobLabel !== null || folder === null) return;
    runJob(
      scanMutation.mutateAsync({ root: folder }),
      dictionary.photos.title,
      dictionary.photos.title,
      dictionary.photos.title,
    );
  }, [activeJobLabel, dictionary, folder, runJob, scanMutation]);

  const generateProxies = useCallback(() => {
    if (selectedRoot === null) return;
    runJob(
      proxiesMutation.mutateAsync({ root: selectedRoot, force: false }),
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
      dictionary.photos.generateProxiesAction,
    );
  }, [dictionary, proxiesMutation, runJob, selectedRoot]);

  const selectedItem = useMemo(
    () => loadedItems.find((candidate) => candidate.fingerprint === selectedFingerprint) ?? null,
    [loadedItems, selectedFingerprint],
  );
  const selectedItemRoot = useMemo(
    () => (selectedItem === null ? null : ownerRootFor(selectedItem.currentPath, roots)),
    [selectedItem, roots],
  );

  const canAnalyze = scope === 'folder' ? selectedRoot !== null : roots.length > 0;
  const canAnalyzeSelectedPhoto = selectedItemRoot !== null;

  const resetAnalyzeTracking = useCallback(() => {
    setAnalyzeProgress(null);
    setRootProgress(null);
    processingSetRef.current = new Set();
    setProcessingFingerprints(new Set());
    lastAnalyzeSequenceRef.current = 0;
  }, []);

  const handleAnalyzeSnapshot = useCallback((snapshot: JobOutput) => {
    let processingChanged = false;
    let sawCompletion = false;
    for (const event of snapshot.progressEvents) {
      if (event.sequence <= lastAnalyzeSequenceRef.current) continue;
      lastAnalyzeSequenceRef.current = event.sequence;
      const { step, data } = event.progress;
      if (step === 'photo-analysis-scanning') {
        const candidates = data?.['candidates'];
        if (typeof candidates === 'number') setAnalyzeProgress({ current: 0, total: candidates });
        const rootIndex = data?.['rootIndex'];
        const rootsTotal = data?.['rootsTotal'];
        setRootProgress(
          typeof rootIndex === 'number' && typeof rootsTotal === 'number' && rootsTotal > 1
            ? { current: rootIndex, total: rootsTotal }
            : null,
        );
        continue;
      }
      if (step === 'photo-analysis-batch-started') {
        const fingerprints = data?.['fingerprints'];
        if (Array.isArray(fingerprints)) {
          for (const fingerprint of fingerprints) {
            if (typeof fingerprint === 'string') processingSetRef.current.add(fingerprint);
          }
          processingChanged = true;
        }
        continue;
      }
      if (step === 'photo-analysed') {
        const fingerprint = data?.['fingerprint'];
        if (typeof fingerprint === 'string' && processingSetRef.current.delete(fingerprint)) processingChanged = true;
        const current = data?.['current'];
        const total = data?.['total'];
        if (typeof current === 'number' && typeof total === 'number') setAnalyzeProgress({ current, total });
        sawCompletion = true;
        continue;
      }
      if (step === 'photo-analysis-failed') {
        const fingerprint = data?.['fingerprint'];
        if (typeof fingerprint === 'string' && processingSetRef.current.delete(fingerprint)) processingChanged = true;
        sawCompletion = true;
      }
    }
    if (processingChanged) setProcessingFingerprints(new Set(processingSetRef.current));
    if (sawCompletion) void invalidatePhotosQueries(queryClient);
  }, [queryClient]);

  const analyzePhotos = useCallback(() => {
    if (!canAnalyze) return;
    resetAnalyzeTracking();
    runJob(
      processMutation.mutateAsync(scope === 'folder' && selectedRoot !== null
        ? { root: selectedRoot, force: false }
        : { force: false }),
      dictionary.photos.analyzeProgress(0, 0),
      dictionary.photos.analyzeAction,
      dictionary.photos.analyzeAction,
      handleAnalyzeSnapshot,
      (jobId) => {
        analyzeJobIdRef.current = jobId;
        setActiveAnalyzeJobId(jobId);
      },
      () => {
        analyzeJobIdRef.current = null;
        setActiveAnalyzeJobId(null);
        resetAnalyzeTracking();
      },
    );
  }, [canAnalyze, dictionary, handleAnalyzeSnapshot, processMutation, resetAnalyzeTracking, runJob, scope, selectedRoot]);

  const analyzeSelectedPhoto = useCallback(() => {
    if (selectedFingerprint === null || selectedItemRoot === null) return;
    resetAnalyzeTracking();
    runJob(
      processMutation.mutateAsync({ root: selectedItemRoot, force: false, fingerprints: [selectedFingerprint] }),
      dictionary.photos.analyzeProgress(0, 1),
      dictionary.photos.analyzeAction,
      dictionary.photos.analyzeAction,
      handleAnalyzeSnapshot,
      (jobId) => {
        analyzeJobIdRef.current = jobId;
        setActiveAnalyzeJobId(jobId);
      },
      () => {
        analyzeJobIdRef.current = null;
        setActiveAnalyzeJobId(null);
        resetAnalyzeTracking();
      },
    );
  }, [dictionary, handleAnalyzeSnapshot, processMutation, resetAnalyzeTracking, runJob, selectedFingerprint, selectedItemRoot]);

  const cancelAnalysisMutation = useMutation(actions.cancelJob);

  const requestCancelAnalysis = useCallback(() => {
    if (activeAnalyzeJobId === null) return;
    setCancelConfirmation({ open: true, isBatch: false });
  }, [activeAnalyzeJobId]);

  const confirmCancelAnalysis = useCallback(() => {
    const jobId = analyzeJobIdRef.current;
    setCancelConfirmation({ open: false, isBatch: false });
    if (jobId === null) return;
    addLine(dictionary.photos.cancelAnalysisAction, 'info');
    void cancelAnalysisMutation.mutateAsync({ jobId });
  }, [addLine, cancelAnalysisMutation, dictionary]);

  const closeCancelConfirmation = useCallback(() => {
    setCancelConfirmation((current) => ({ ...current, open: false }));
  }, []);

  const analyzeStatusLabel = useMemo(() => {
    if (activeJobLabel === null) return null;
    if (analyzeProgress === null) return activeJobLabel;
    return rootProgress === null
      ? dictionary.photos.analyzeProgress(analyzeProgress.current, analyzeProgress.total)
      : dictionary.photos.analyzeProgressAllRoots(rootProgress.current, rootProgress.total, analyzeProgress.current, analyzeProgress.total);
  }, [activeJobLabel, analyzeProgress, dictionary, rootProgress]);

  const selectVariant = useCallback(
    (configId: string | null) => {
      if (selectedFingerprint === null) return;
      setJobError(null);
      void (async () => {
        try {
          await selectVariantMutation.mutateAsync({ fingerprint: selectedFingerprint, configId });
        } catch (error) {
          const message = `${dictionary.photos.variantPickerLabel}: ${messageOf(error)}`;
          addLine(message, 'error');
          setJobError(message);
        }
      })();
    },
    [addLine, dictionary, selectedFingerprint, selectVariantMutation],
  );

  const error = useMemo(() => {
    for (const query of [tree, list]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return jobError;
  }, [jobError, list, tree]);

  return {
    isLoading: active && (tree.isLoading || list.isLoading),
    error,
    roots,
    scope,
    setScope,
    folder,
    folderState,
    selectedRoot,
    items: loadedItems,
    total: list.data?.total ?? 0,
    hasMore: loadedItems.length < (list.data?.total ?? 0),
    isLoadingMore: offset > 0 && list.isFetching,
    loadMore,
    counts: status.data === undefined
      ? null
      : {
        photos: status.data.counts.photos,
        paths: status.data.counts.paths,
        proxied: status.data.counts.proxied,
        proxyFailed: status.data.counts.proxyFailed,
      },
    selectedFingerprint,
    selectFingerprint: setSelectedFingerprint,
    activeJobLabel,
    analyzeStatusLabel,
    isBusy: activeJobLabel !== null,
    scanFolder,
    detail: detail.data ?? null,
    isDetailLoading: detail.isLoading,
    variants: variants.data?.variants ?? [],
    selectVariant,
    analyzePhotos,
    canAnalyze,
    analyzeSelectedPhoto,
    canAnalyzeSelectedPhoto,
    analyzeProgress,
    processingFingerprints,
    generateProxies,
    isCancellable: activeAnalyzeJobId !== null,
    cancelConfirmation,
    requestCancelAnalysis,
    confirmCancelAnalysis,
    closeCancelConfirmation,
  };
};
