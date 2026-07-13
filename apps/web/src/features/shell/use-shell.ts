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
  openFolder: () => void;
  selectRecentFolder: (folderPath: string) => void;
  nestedDb: NestedDbState;
  closeNestedDb: () => void;
}

/**
 * Local platform state sourced from the desktop bridge (app version, current
 * and recent folders). This is not HTTP server state, so it lives in component
 * state fed by the bridge rather than TanStack Query; the on-disk catalog
 * (scan/status) is the part that flows through bound `actions`.
 */
export const useShell = (): ShellState => {
  const queryClient = useQueryClient();
  const [appVersion, setAppVersion] = useState('');
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);
  const [nestedDb, setNestedDb] = useState<NestedDbState>({ open: false, paths: [] });

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
      try {
        let nestedPaths: string[] | null = null;
        try {
          const check = await queryClient.fetchQuery(actions.check({ folder: folderPath }));
          if (check.hasNestedDatabases) nestedPaths = check.nestedPaths;
        } catch {
          nestedPaths = null;
        }
        if (nestedPaths !== null) {
          setNestedDb({ open: true, paths: nestedPaths });
          return;
        }
        await bridge.folder.setCurrent(folderPath);
        await refreshFolders();
      } finally {
        setIsCheckingFolder(false);
      }
    },
    [refreshFolders, queryClient],
  );

  const closeNestedDb = useCallback(() => {
    setNestedDb((current) => ({ ...current, open: false }));
  }, []);

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
    openFolder,
    selectRecentFolder,
    nestedDb,
    closeNestedDb,
  };
};
