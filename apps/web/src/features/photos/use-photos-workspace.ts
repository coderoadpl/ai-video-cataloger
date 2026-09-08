import { usePhotosAnalysis } from './use-photos-analysis.js';
import { usePhotosAutoScan } from './use-photos-auto-scan.js';

export const usePhotosWorkspace = (options: Parameters<typeof usePhotosAnalysis>[0]) => {
  const state = usePhotosAnalysis(options);
  usePhotosAutoScan({
    active: options.active, folder: state.folder, folderState: state.folderState,
    isRootsReady: !state.isLoading, isBusy: state.isBusy,
    scanFolder: () => { void state.scanFolder(); },
  });
  return state;
};
