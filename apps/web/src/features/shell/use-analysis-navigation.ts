import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnalysisMedia } from '../../components/ui/AnalysisMediaToggle.js';
import type { AppMode } from '../../components/ui/ModeSwitcher.js';
import type { ShellState } from './use-shell.js';

interface Options {
  currentFolder: string | null;
  selectRecentFolder: (folder: string) => void;
  selectKey: (key: string) => void;
  photosSelectFingerprint: (fingerprint: string) => void;
  setMode: (mode: AppMode) => void;
  mode: AppMode;
  setAnalysisMedia: (media: AnalysisMedia) => void;
  folderAcceptedToken: ShellState['folderAcceptedToken'];
}

export const useAnalysisNavigation = ({ currentFolder, selectRecentFolder, selectKey,
  photosSelectFingerprint, setMode, mode, setAnalysisMedia, folderAcceptedToken }: Options) => {
  const [pendingSelection, setPendingSelection] = useState<{ folderPath: string; videoPath: string } | null>(null);
  const openInAnalysis = useCallback(
    (folderPath: string, videoPath: string) => {
      setMode('analysis');
      setAnalysisMedia('videos');
      if (currentFolder === folderPath) {
        selectKey(videoPath);
        return;
      }
      setPendingSelection({ folderPath, videoPath });
      selectRecentFolder(folderPath);
    },
    [currentFolder, selectKey, selectRecentFolder, setAnalysisMedia, setMode],
  );
  useEffect(() => {
    if (pendingSelection === null || currentFolder !== pendingSelection.folderPath) return;
    selectKey(pendingSelection.videoPath);
    setPendingSelection(null);
  }, [pendingSelection, currentFolder, selectKey]);
  const openPhotoInAnalysis = useCallback(
    (root: string, fingerprint: string) => {
      setMode('analysis');
      setAnalysisMedia('photos');
      selectRecentFolder(root);
      photosSelectFingerprint(fingerprint);
    },
    [photosSelectFingerprint, selectRecentFolder, setAnalysisMedia, setMode],
  );
  const previousFolderAcceptedTokenRef = useRef(folderAcceptedToken);
  useEffect(() => {
    if (folderAcceptedToken === previousFolderAcceptedTokenRef.current) return;
    previousFolderAcceptedTokenRef.current = folderAcceptedToken;
    if (mode === 'library') setMode('analysis');
  }, [folderAcceptedToken, mode, setMode]);
  return { openInAnalysis, openPhotoInAnalysis };
};
