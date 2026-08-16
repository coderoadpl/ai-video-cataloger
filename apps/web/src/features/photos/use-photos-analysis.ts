import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError, invalidatePhotosQueries, isTerminalJobStatus, type JobOutput } from '@core/client/index.js';
import type { photosDetailOutputSchema, photosVariantRecordSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import type { CancelConfirmation } from '../../components/ui/dialogs/CancelConfirmationDialog.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import {
  buildPhotoTreeForRoot,
  ownerRootFor,
  photoScopePendingCount,
  type PhotoListItem,
  type PhotoRoot,
  type PhotoTreeNode,
} from './core/index.js';

const SCOPE_KEY = 'avc.photosScope';
const QUERY_DISABLED_FOLDER = ' ';

export type PhotosAnalysisScope = 'folder' | 'tree';
export type PhotosFolderState = 'no-folder' | 'unscanned' | 'scanned';
export type PhotoDetail = z.output<typeof photosDetailOutputSchema>;
export type PhotoVariantRecord = z.output<typeof photosVariantRecordSchema>;

const canUseStorage = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.localStorage?.getItem === 'function'
  && typeof window.localStorage?.setItem === 'function';

const readScope = (): PhotosAnalysisScope => {
  if (!canUseStorage()) return 'folder';
  const raw = window.localStorage.getItem(SCOPE_KEY);
  if (raw === 'tree' || raw === 'all') return 'tree';
  return 'folder';
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

const pendingFolderPaths = (root: PhotoTreeNode | null): string[] => {
  if (root === null) return [];
  const paths: string[] = [];
  const visit = (node: PhotoTreeNode): void => {
    if (node.directPhotoCount > node.directAnalysedCount) paths.push(node.path);
    node.children.forEach(visit);
  };
  visit(root);
  return paths;
};

const parentFolder = (path: string): string => {
  const separator = path.lastIndexOf('/');
  return separator <= 0 ? path : path.slice(0, separator);
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
  treeRoot: PhotoTreeNode | null;
  treeScopeAvailable: boolean;
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
  scanFolder: () => Promise<boolean>;
  detail: PhotoDetail | null;
  isDetailLoading: boolean;
  variants: PhotoVariantRecord[];
  selectVariant: (configId: string | null) => void;
  analyzePhotos: () => void;
  canAnalyze: boolean;
  pendingCount: number;
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
  const [scopePreference, setScopePreference] = useState<PhotosAnalysisScope>(() => readScope());
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [activeAnalyzeJobId, setActiveAnalyzeJobId] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number } | null>(null);
  const [processingFingerprints, setProcessingFingerprints] = useState<ReadonlySet<string>>(() => new Set());
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation>({ open: false, isBatch: false });
  const [jobError, setJobError] = useState<string | null>(null);
  const processingSetRef = useRef<Set<string>>(new Set());
  const lastAnalyzeSequenceRef = useRef(0);
  const analyzeJobIdRef = useRef<string | null>(null);
  const analysisFolderPathsRef = useRef<readonly string[]>([]);

  const tree = useQuery({ ...actions.photosTree, enabled: active });
  const treeRoots = tree.data?.roots;
  const roots = useMemo(() => treeRoots ?? [], [treeRoots]);

  const selectedRoot = useMemo(() => deriveSelectedRoot(folder, roots), [folder, roots]);
  const folderState = useMemo<PhotosFolderState>(() => {
    if (folder === null) return 'no-folder';
    return selectedRoot === null ? 'unscanned' : 'scanned';
  }, [folder, selectedRoot]);

  const folderTree = useQuery({
    ...actions.photosFolderTree,
    enabled: active && selectedRoot !== null,
  });
  const treeRoot = useMemo(
    () => selectedRoot === null ? null : buildPhotoTreeForRoot(folderTree.data?.folders ?? [], selectedRoot),
    [folderTree.data, selectedRoot],
  );
  const treeScopeAvailable = (treeRoot?.children.length ?? 0) > 0;
  const scope: PhotosAnalysisScope = treeScopeAvailable ? scopePreference : 'folder';

  const setScope = useCallback((next: PhotosAnalysisScope) => {
    setScopePreference(next);
    if (canUseStorage()) window.localStorage.setItem(SCOPE_KEY, next);
  }, []);

  const directPhotos = useQuery({
    ...actions.photosTreeFolder({ folder: selectedRoot ?? QUERY_DISABLED_FOLDER }),
    enabled: active && selectedRoot !== null,
  });
  const items = useMemo(() => directPhotos.data?.items ?? [], [directPhotos.data]);
  const loadMore = useCallback(() => undefined, []);

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
      submit: () => Promise<{ jobId: string }>,
      label: string,
      success: string,
      failure: string,
      onSnapshot?: (snapshot: JobOutput) => void,
      onJobAccepted?: (jobId: string) => void,
      onSettled?: () => void,
    ): Promise<boolean> => {
      if (activeJobLabel !== null) return Promise.resolve(false);
      setActiveJobLabel(label);
      setJobError(null);
      addLine(label, 'info');
      return (async () => {
        try {
          const job = await submit();
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
            return true;
          } else if (final.status === 'cancelled') {
            addLine(dictionary.photos.analysisCancelled, 'info');
            await invalidate();
            return false;
          } else {
            const message = `${failure}: ${final.error?.message ?? 'unknown error'}`;
            addLine(message, 'error');
            setJobError(message);
            return false;
          }
        } catch (error) {
          const message = `${failure}: ${messageOf(error)}`;
          addLine(message, 'error');
          setJobError(message);
          return false;
        } finally {
          setActiveJobLabel(null);
          onSettled?.();
        }
      })();
    },
    [activeJobLabel, addLine, dictionary, intervalMs, invalidate, queryClient],
  );

  const scanFolder = useCallback((): Promise<boolean> => {
    if (folder === null) return Promise.resolve(false);
    return runJob(
      () => scanMutation.mutateAsync({ root: folder }),
      dictionary.photos.scanStartedLog,
      dictionary.photos.scanCompletedLog,
      dictionary.photos.scanFailedLog,
    );
  }, [dictionary, folder, runJob, scanMutation]);

  const generateProxies = useCallback(() => {
    if (selectedRoot === null) return;
    void runJob(
      () => proxiesMutation.mutateAsync({ root: selectedRoot, force: false }),
      dictionary.photos.generateProxiesStartedLog,
      dictionary.photos.generateProxiesCompletedLog,
      dictionary.photos.generateProxiesFailedLog,
    );
  }, [dictionary, proxiesMutation, runJob, selectedRoot]);

  const selectedPhotoPath = useMemo(() => {
    const fromLoadedItems = items.find((candidate) => candidate.fingerprint === selectedFingerprint) ?? null;
    if (fromLoadedItems !== null) return fromLoadedItems.currentPath;
    return detail.data !== undefined && detail.data.photo.fingerprint === selectedFingerprint
      ? detail.data.ownerPath
      : null;
  }, [detail.data, items, selectedFingerprint]);
  const selectedItemRoot = useMemo(
    () => (selectedPhotoPath === null ? null : ownerRootFor(selectedPhotoPath, roots)),
    [selectedPhotoPath, roots],
  );

  const pendingCount = photoScopePendingCount(treeRoot, scope);
  const canAnalyze = selectedRoot !== null && pendingCount > 0;
  const canAnalyzeSelectedPhoto = selectedItemRoot !== null;

  const resetAnalyzeTracking = useCallback(() => {
    setAnalyzeProgress(null);
    setFolderProgress(null);
    processingSetRef.current = new Set();
    setProcessingFingerprints(new Set());
    lastAnalyzeSequenceRef.current = 0;
    analysisFolderPathsRef.current = [];
  }, []);

  const updateFolderProgress = useCallback((path: unknown) => {
    if (typeof path !== 'string') return;
    const folders = analysisFolderPathsRef.current;
    if (folders.length <= 1) return;
    const index = folders.indexOf(parentFolder(path));
    if (index >= 0) setFolderProgress({ current: index + 1, total: folders.length });
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
        updateFolderProgress(data?.['path']);
        const fingerprint = data?.['fingerprint'];
        if (typeof fingerprint === 'string' && processingSetRef.current.delete(fingerprint)) processingChanged = true;
        const current = data?.['current'];
        const total = data?.['total'];
        if (typeof current === 'number' && typeof total === 'number') setAnalyzeProgress({ current, total });
        sawCompletion = true;
        continue;
      }
      if (step === 'photo-analysis-failed') {
        updateFolderProgress(data?.['path']);
        const fingerprint = data?.['fingerprint'];
        if (typeof fingerprint === 'string' && processingSetRef.current.delete(fingerprint)) processingChanged = true;
        sawCompletion = true;
      }
    }
    if (processingChanged) setProcessingFingerprints(new Set(processingSetRef.current));
    if (sawCompletion) void invalidatePhotosQueries(queryClient);
  }, [queryClient, updateFolderProgress]);

  const analyzePhotos = useCallback(() => {
    if (!canAnalyze || selectedRoot === null) return;
    resetAnalyzeTracking();
    analysisFolderPathsRef.current = scope === 'tree' ? pendingFolderPaths(treeRoot) : [];
    const directFingerprints = items.filter((item) => !item.analysed).map((item) => item.fingerprint);
    void runJob(
      () => processMutation.mutateAsync(scope === 'folder'
        ? { root: selectedRoot, force: false, fingerprints: directFingerprints }
        : { root: selectedRoot, force: false }),
      dictionary.photos.analyzeProgress(0, pendingCount),
      dictionary.photos.analyzeCompletedLog,
      dictionary.photos.analyzeFailedLog,
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
  }, [canAnalyze, dictionary, handleAnalyzeSnapshot, items, pendingCount, processMutation, resetAnalyzeTracking, runJob, scope, selectedRoot, treeRoot]);

  const analyzeSelectedPhoto = useCallback(() => {
    if (selectedFingerprint === null || selectedItemRoot === null) return;
    resetAnalyzeTracking();
    void runJob(
      () => processMutation.mutateAsync({ root: selectedItemRoot, force: false, fingerprints: [selectedFingerprint] }),
      dictionary.photos.analyzeProgress(0, 1),
      dictionary.photos.analyzeCompletedLog,
      dictionary.photos.analyzeFailedLog,
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
    return folderProgress === null
      ? dictionary.photos.analyzeProgress(analyzeProgress.current, analyzeProgress.total)
      : dictionary.photos.analyzeProgressFolders(folderProgress.current, folderProgress.total, analyzeProgress.current, analyzeProgress.total);
  }, [activeJobLabel, analyzeProgress, dictionary, folderProgress]);

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
    for (const query of [tree, folderTree, directPhotos]) {
      if (query.error !== null) return messageOf(query.error);
    }
    return jobError;
  }, [directPhotos, folderTree, jobError, tree]);

  return {
    isLoading: active && (tree.isLoading || (selectedRoot !== null && (folderTree.isLoading || directPhotos.isLoading))),
    error,
    roots,
    scope,
    setScope,
    folder,
    folderState,
    selectedRoot,
    treeRoot,
    treeScopeAvailable,
    items,
    total: items.length,
    hasMore: false,
    isLoadingMore: false,
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
    pendingCount,
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
