/**
 * useFolder - current/recent folder state and the nested-database check flow
 * (CLI `check` command), extracted from App.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RunCli } from '@/hooks/use-cli-command';
import type { LogLine } from '@/hooks/use-terminal-log';

export interface NestedDbError {
  open: boolean;
  paths: string[];
}

export interface UseFolderOptions {
  runCli: RunCli;
  addLogLine: (content: string, type?: LogLine['type']) => void;
  /** Called after a folder has been validated and set as current. */
  onFolderOpened: (folderPath: string) => Promise<void> | void;
}

export interface UseFolderResult {
  currentFolder: string | null;
  recentFolders: string[];
  isCheckingFolder: boolean;
  nestedDbError: NestedDbError;
  /** Show the system folder picker, validate and open the selection. */
  openFolder: () => Promise<void>;
  /** Validate and open a folder from the recent-folders list. */
  selectRecentFolder: (folderPath: string) => Promise<void>;
  closeNestedDbError: () => void;
  /** Clear recent folders and the current folder (menu action). */
  clearFolders: () => void;
}

export function useFolder({ runCli, addLogLine, onFolderOpened }: UseFolderOptions): UseFolderResult {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [nestedDbError, setNestedDbError] = useState<NestedDbError>({ open: false, paths: [] });
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);

  // Load initial state
  useEffect(() => {
    window.electronAPI?.folder.getRecent().then(setRecentFolders).catch(console.error);
    window.electronAPI?.folder.getCurrent().then(setCurrentFolder).catch(console.error);
  }, []);

  // Check folder for nested databases using CLI
  const checkFolderForNestedDbs = useCallback(
    async (folderPath: string): Promise<{ valid: boolean; nestedPaths: string[] }> => {
      setIsCheckingFolder(true);
      addLogLine(`\x1b[36mChecking folder for nested databases...\x1b[0m`, 'info');

      try {
        const { code, events } = await runCli(['check', folderPath], {
          onJson: (event) => {
            if (event.type === 'error') {
              addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
            }
          },
          onLine: (line, source) => addLogLine(line, source),
        });

        const completed = events.find((event) => event.type === 'completed' && event.data);
        const paths = completed?.data?.nestedDatabases;
        const nestedPaths = Array.isArray(paths) ? (paths as string[]) : [];
        const hasError = events.some((event) => event.type === 'error');

        if (hasError || code !== 0) {
          return { valid: false, nestedPaths };
        }
        return { valid: true, nestedPaths: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLogLine(`\x1b[31mError:\x1b[0m Failed to run check: ${message}`, 'error');
        return { valid: false, nestedPaths: [] };
      } finally {
        setIsCheckingFolder(false);
      }
    },
    [addLogLine, runCli]
  );

  // Shared flow: validate a folder, set it as current, notify the caller
  const validateAndOpen = useCallback(
    async (folderPath: string): Promise<void> => {
      // Check for nested databases
      const result = await checkFolderForNestedDbs(folderPath);

      if (!result.valid && result.nestedPaths.length > 0) {
        // Show error modal with nested paths
        setNestedDbError({ open: true, paths: result.nestedPaths });
        return;
      }

      if (!result.valid) {
        // Check failed for other reasons
        addLogLine(`\x1b[31mFailed to validate folder.\x1b[0m`, 'error');
        return;
      }

      // Folder is valid, set it as current
      await window.electronAPI?.folder.setCurrent(folderPath);
      setCurrentFolder(folderPath);
      setRecentFolders(await window.electronAPI?.folder.getRecent() || []);
      addLogLine(`\x1b[32m✓\x1b[0m Opened folder: ${folderPath}`, 'success');

      // Load videos for the folder
      await onFolderOpened(folderPath);
    },
    [checkFolderForNestedDbs, addLogLine, onFolderOpened]
  );

  // Handle folder selection via the system picker
  const openFolder = useCallback(async () => {
    const selectedPath = await window.electronAPI?.folder.showPicker();
    if (!selectedPath) return;
    await validateAndOpen(selectedPath);
  }, [validateAndOpen]);

  // Handle selecting a recent folder
  const selectRecentFolder = useCallback(
    async (folderPath: string) => {
      await validateAndOpen(folderPath);
    },
    [validateAndOpen]
  );

  // Close nested DB error dialog
  const closeNestedDbError = useCallback(() => {
    setNestedDbError({ open: false, paths: [] });
  }, []);

  // Clear recent folders and the current folder (used by the menu action)
  const clearFolders = useCallback(() => {
    setRecentFolders([]);
    setCurrentFolder(null);
  }, []);

  return {
    currentFolder,
    recentFolders,
    isCheckingFolder,
    nestedDbError,
    openFolder,
    selectRecentFolder,
    closeNestedDbError,
    clearFolders,
  };
}
