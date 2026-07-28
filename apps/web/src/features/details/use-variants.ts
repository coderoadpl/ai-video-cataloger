import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

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
  selecting: boolean;
  settingFolderDefault: boolean;
  comparing: boolean;
  previewConfig: (configId: string) => void;
  showComparison: () => void;
  hideComparison: () => void;
  useAsSelected: (configId: string) => void;
  usePreviewAsSelected: () => void;
  useCurrentAsFolderDefault: () => void;
}

export const useVariants = (video: DetailsVideo): VariantsState => {
  const [previewConfigId, setPreviewConfigId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const query = useQuery(variants({ videoPath: video.path }));
  const selection = useMutation(selectVariant);
  const folderDefault = useMutation(setFolderDefaultVariant);
  const data = query.data ?? null;
  const previewVariant = data === null ? null : resolvedPreviewVariant(data, previewConfigId);
  const preview = previewVariant === null ? null : variantPreview(video, previewVariant);
  const plan = data === null ? null : analysisPlan(data);

  const selectConfig = useCallback((configId: string) => {
    selection.mutate({ videoPath: video.path, configId });
  }, [selection, video.path]);

  const usePreviewAsSelected = useCallback(() => {
    if (previewVariant === null || previewVariant.selected) return;
    selectConfig(previewVariant.configId);
  }, [previewVariant, selectConfig]);

  const showComparison = useCallback(() => setComparing(true), []);
  const hideComparison = useCallback(() => setComparing(false), []);

  const useCurrentAsFolderDefault = useCallback(() => {
    if (data === null || data.folderDefaultConfigId === data.currentConfig.configId) return;
    folderDefault.mutate({ folderPath: data.folderPath, configId: data.currentConfig.configId });
  }, [data, folderDefault]);

  return {
    data,
    previewVariant,
    preview,
    plan,
    loading: query.isLoading,
    loadError: query.error,
    actionError: selection.error ?? folderDefault.error,
    selecting: selection.isPending,
    settingFolderDefault: folderDefault.isPending,
    comparing,
    previewConfig: setPreviewConfigId,
    showComparison,
    hideComparison,
    useAsSelected: selectConfig,
    usePreviewAsSelected,
    useCurrentAsFolderDefault,
  };
};
