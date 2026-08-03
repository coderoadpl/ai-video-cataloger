import { useEffect, useRef } from 'react';

import type { PhotosFolderState } from './use-photos-analysis.js';

export interface UsePhotosAutoScanInput {
  active: boolean;
  folder: string | null;
  folderState: PhotosFolderState;
  isRootsReady: boolean;
  isBusy: boolean;
  scanFolder: () => void;
}

export const usePhotosAutoScan = ({ active, folder, folderState, isRootsReady, isBusy, scanFolder }: UsePhotosAutoScanInput): void => {
  const scannedFoldersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active || !isRootsReady || isBusy || folder === null || folderState !== 'unscanned') return;
    if (scannedFoldersRef.current.has(folder)) return;
    scannedFoldersRef.current.add(folder);
    scanFolder();
  }, [active, folder, folderState, isBusy, isRootsReady, scanFolder]);
};
