import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { bridge } from '../../api.js';

interface FolderWatchOptions {
  photosActive: boolean;
  photosBusy: boolean;
  scanPhotos: () => void;
}

export const useFolderWatch = (
  folder: string | null,
  { photosActive, photosBusy, scanPhotos }: FolderWatchOptions,
): void => {
  const queryClient = useQueryClient();
  const pendingPhotoRescan = useRef(false);

  useEffect(() => {
    pendingPhotoRescan.current = false;
  }, [folder]);

  useEffect(() => {
    if (!photosActive) {
      pendingPhotoRescan.current = false;
      return;
    }
    if (photosBusy || !pendingPhotoRescan.current) return;
    pendingPhotoRescan.current = false;
    scanPhotos();
  }, [photosActive, photosBusy, scanPhotos]);

  useEffect(() => {
    if (folder === null) return;
    return bridge.folder.onChanged(({ folderPath }) => {
      if (folderPath !== folder) return;
      void queryClient.invalidateQueries();
      if (!photosActive) return;
      if (photosBusy) {
        pendingPhotoRescan.current = true;
        return;
      }
      scanPhotos();
    });
  }, [folder, photosActive, photosBusy, queryClient, scanPhotos]);
};
