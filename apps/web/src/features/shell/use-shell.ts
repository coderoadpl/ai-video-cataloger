import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { actions, bridge } from '../../api.js';

export interface NestedDbState {
  open: boolean;
  paths: string[];
}

export interface ShellState {
  appVersion: string;
  currentFolder: string | null;
  recentFolders: string[];
  isCheckingFolder: boolean;
  folderError: string | null;
  openFolder: () => void;
  selectRecentFolder: (folderPath: string) => void;
  nestedDb: NestedDbState;
  closeNestedDb: () => void;
  closeFolderError: () => void;
  folderAcceptedToken: number;
}

export const useShell = (): ShellState => {
  const queryClient = useQueryClient();
  const [appVersion, setAppVersion] = useState('');
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);
  const [nestedDb, setNestedDb] = useState<NestedDbState>({ open: false, paths: [] });
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderAcceptedToken, setFolderAcceptedToken] = useState(0);

  const refreshFolders = useCallback(async () => {
    const [current, recent] = await Promise.all([
      bridge.folder.getCurrent(),
      bridge.folder.getRecent(),
    ]);
    setCurrentFolder(current);
    setRecentFolders(recent);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const version = await bridge.getAppVersion();
      if (active) setAppVersion(version);
      await refreshFolders();
    })();
    return () => {
      active = false;
    };
  }, [refreshFolders]);

  const acceptFolder = useCallback(
    async (folderPath: string) => {
      setIsCheckingFolder(true);
      setFolderError(null);
      try {
        try {
          const check = await queryClient.fetchQuery(actions.check({ folder: folderPath }));
          if (check.hasNestedDatabases) {
            setNestedDb({ open: true, paths: check.nestedPaths });
            return;
          }
        } catch (error) {
          setFolderError(error instanceof Error ? error.message : String(error));
          return;
        }
        await bridge.folder.setCurrent(folderPath);
        await refreshFolders();
        setFolderAcceptedToken((token) => token + 1);
      } finally {
        setIsCheckingFolder(false);
      }
    },
    [refreshFolders, queryClient],
  );

  const closeNestedDb = useCallback(() => {
    setNestedDb((current) => ({ ...current, open: false }));
  }, []);

  const closeFolderError = useCallback(() => setFolderError(null), []);

  const openFolder = useCallback(() => {
    void (async () => {
      const picked = await bridge.folder.showPicker();
      if (picked !== null) await acceptFolder(picked);
    })();
  }, [acceptFolder]);

  const selectRecentFolder = useCallback(
    (folderPath: string) => {
      void acceptFolder(folderPath);
    },
    [acceptFolder],
  );

  const clearRecentFolders = useCallback(() => {
    void (async () => {
      await bridge.folder.clearRecent();
      await refreshFolders();
    })();
  }, [refreshFolders]);

  useEffect(() => {
    const unsubscribers = [
      bridge.menu.on('openFolder', openFolder),
      bridge.menu.on('openRecentFolder', ({ folderPath }) => selectRecentFolder(folderPath)),
      bridge.menu.on('clearRecentFolders', clearRecentFolders),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [openFolder, selectRecentFolder, clearRecentFolders]);

  return {
    appVersion,
    currentFolder,
    recentFolders,
    isCheckingFolder,
    folderError,
    openFolder,
    selectRecentFolder,
    nestedDb,
    closeNestedDb,
    closeFolderError,
    folderAcceptedToken,
  };
};
