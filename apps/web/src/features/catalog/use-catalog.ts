import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type CatalogVideo, keyOf } from './core/index.js';
import { useThumbnailGeneration } from './use-thumbnail-generation.js';

const EMPTY: readonly CatalogVideo[] = [];

// The disabled query still validates its input, so it needs a non-empty folder sentinel.
const SCAN_DISABLED_FOLDER = '\u0000';

export interface CatalogState {
  videos: readonly CatalogVideo[];
  selectedVideo: CatalogVideo | null;
  selectedKey: string | null;
  select: (video: CatalogVideo) => void;
  selectKey: (key: string) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isGeneratingThumbnails: boolean;
  thumbnailFailedPaths: ReadonlySet<string>;
}

export const useCatalog = (folder: string | null): CatalogState => {
  const scan = useQuery({
    ...actions.scan({ folder: folder ?? SCAN_DISABLED_FOLDER }),
    enabled: folder !== null,
  });
  const videos = scan.data?.videos ?? EMPTY;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    setSelectedKey(null);
  }, [folder]);

  const selectedVideo = useMemo(
    () => videos.find((video) => keyOf(video) === selectedKey) ?? null,
    [videos, selectedKey],
  );

  const select = useCallback((video: CatalogVideo) => {
    setSelectedKey(keyOf(video));
  }, []);

  const selectKey = useCallback((key: string) => {
    setSelectedKey(key);
  }, []);

  const { isGenerating, failedPaths } = useThumbnailGeneration(folder, videos);

  return {
    videos,
    selectedVideo,
    selectedKey,
    select,
    selectKey,
    isLoading: scan.isLoading,
    isError: scan.isError,
    error: scan.error,
    isGeneratingThumbnails: isGenerating,
    thumbnailFailedPaths: failedPaths,
  };
};
