import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { type DetailsVideo } from './details-video.js';
import {
  analysisPlan,
  resolvedPreviewVariant,
  selectVariant,
  setFolderDefaultVariant,
  variantPreview,
  variants,
  type AnalysisPlan,
  type VariantData,
  type VariantPreview,
  type VariantsData,
} from './index.web.js';

export interface VariantsState {
  data: VariantsData | null;
  previewVariant: VariantData | null;
  preview: VariantPreview | null;
  plan: AnalysisPlan | null;
  loading: boolean;
  loadError: unknown;
  actionError: unknown;
  selectingConfigId: string | null;
  settingFolderDefault: boolean;
  comparing: boolean;
  retryLoad: () => void;
  previewConfig: (configId: string) => void;
  showComparison: () => void;
  hideComparison: () => void;
  useAsSelected: (configId: string) => void;
  usePreviewAsSelected: () => void;
  useCurrentAsFolderDefault: () => void;
}

const variantLocator = (video: DetailsVideo): { fingerprint: string } | { videoPath: string } =>
  video.contentHash === null ? { videoPath: video.path } : { fingerprint: video.contentHash };

const isNeverAnalyzedError = (error: unknown): boolean =>
  error instanceof ApiError
  && (error.appError.code === 'video_not_found' || error.appError.code === 'folder_not_found');

export const useVariants = (video: DetailsVideo): VariantsState => {
  const [previewConfigId, setPreviewConfigId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const locator = variantLocator(video);
  const query = useQuery(variants(locator));
  const selection = useMutation(selectVariant);
  const folderDefault = useMutation(setFolderDefaultVariant);
  const data = query.data ?? null;
  const previewVariant = data === null ? null : resolvedPreviewVariant(data, previewConfigId);
  const preview = previewVariant === null ? null : variantPreview(video, previewVariant);
  const plan = data === null ? null : analysisPlan(data);

  const selectConfig = useCallback((configId: string, onSuccess?: () => void) => {
    setPreviewConfigId(configId);
    selection.mutate(
      { ...locator, configId, deferProjection: true },
      onSuccess === undefined ? undefined : { onSuccess },
    );
  }, [locator, selection]);

  const usePreviewAsSelected = useCallback(() => {
    if (previewVariant === null || previewVariant.selected) return;
    selectConfig(previewVariant.configId);
  }, [previewVariant, selectConfig]);

  const showComparison = useCallback(() => setComparing(true), []);
  const hideComparison = useCallback(() => setComparing(false), []);
  const selectFromComparison = useCallback((configId: string) => {
    selectConfig(configId, hideComparison);
  }, [hideComparison, selectConfig]);

  const useCurrentAsFolderDefault = useCallback(() => {
    const selected = data?.variants.find((variant) => variant.selected);
    if (data === null || selected === undefined || data.folderDefaultConfigId === selected.configId) return;
    folderDefault.mutate({ folderPath: data.folderPath, configId: selected.configId });
  }, [data, folderDefault]);

  return {
    data,
    previewVariant,
    preview,
    plan,
    loading: query.isLoading,
    loadError: isNeverAnalyzedError(query.error) ? null : query.error,
    actionError: selection.error ?? folderDefault.error,
    selectingConfigId: selection.isPending ? selection.variables?.configId ?? null : null,
    settingFolderDefault: folderDefault.isPending,
    comparing,
    retryLoad: () => { void query.refetch(); },
    previewConfig: setPreviewConfigId,
    showComparison,
    hideComparison,
    useAsSelected: selectFromComparison,
    usePreviewAsSelected,
    useCurrentAsFolderDefault,
  };
};
