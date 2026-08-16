import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { bridge } from '../../api.js';

interface FolderWatchOptions {
  photosActive: boolean;
  photosBusy: boolean;
  scanPhotos: () => Promise<boolean>;
}

interface RescanState {
  folder: string | null;
  photosActive: boolean;
  photosBusy: boolean;
  scanPhotos: () => Promise<boolean>;
}

export const useFolderWatch = (
  folder: string | null,
  { photosActive, photosBusy, scanPhotos }: FolderWatchOptions,
): void => {
  const queryClient = useQueryClient();
  const pendingPhotoRescan = useRef(false);
  const retryAttempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanInFlight = useRef(false);
  const generation = useRef(0);
  const state = useRef<RescanState>({ folder, photosActive, photosBusy, scanPhotos });
  const attemptScan = useRef<() => void>(() => undefined);
  state.current = { folder, photosActive, photosBusy, scanPhotos };

  attemptScan.current = () => {
    const current = state.current;
    if (!current.photosActive || current.photosBusy || !pendingPhotoRescan.current
      || scanInFlight.current || retryTimer.current !== null) return;
    pendingPhotoRescan.current = false;
    scanInFlight.current = true;
    const startedGeneration = generation.current;
    const settle = (succeeded: boolean): void => {
      if (startedGeneration !== generation.current) return;
      scanInFlight.current = false;
      if (!state.current.photosActive) return;
      if (succeeded) {
        retryAttempt.current = 0;
        attemptScan.current();
        return;
      }
      pendingPhotoRescan.current = true;
      const delayMs = Math.min(500 * (2 ** retryAttempt.current), 5000);
      retryAttempt.current += 1;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        attemptScan.current();
      }, delayMs);
    };
    void current.scanPhotos().then(settle, () => settle(false));
  };

  useEffect(() => {
    generation.current += 1;
    pendingPhotoRescan.current = false;
    retryAttempt.current = 0;
    scanInFlight.current = false;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, [folder]);

  useEffect(() => {
    if (!photosActive) {
      pendingPhotoRescan.current = false;
      retryAttempt.current = 0;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      return;
    }
    attemptScan.current();
  }, [photosActive, photosBusy, scanPhotos]);

  useEffect(() => () => {
    generation.current += 1;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    if (folder === null) return;
    return bridge.folder.onChanged(({ folderPath }) => {
      if (folderPath !== folder) return;
      void queryClient.invalidateQueries();
      if (!photosActive) return;
      pendingPhotoRescan.current = true;
      retryAttempt.current = 0;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      attemptScan.current();
    });
  }, [folder, photosActive, queryClient]);
};
