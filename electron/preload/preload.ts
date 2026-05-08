import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Types for JSON events from CLI
export interface JsonEvent {
  type: 'started' | 'progress' | 'completed' | 'error';
  timestamp: string;
  message?: string;
  step?: string;
  percentage?: number;
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

// Spawn options for CLI commands
export interface CLISpawnOptions {
  cwd?: string;
  json?: boolean;
}

// Result from spawning a CLI process
export interface CLISpawnResult {
  spawnId: string;
  pid: number | undefined;
}

// Callback types for CLI events
export type CLIStdoutCallback = (spawnId: string, line: string) => void;
export type CLIStderrCallback = (spawnId: string, error: string) => void;
export type CLIJsonCallback = (spawnId: string, event: JsonEvent) => void;
export type CLIExitCallback = (spawnId: string, code: number | null, signal: string | null) => void;

// Expose protected methods that allow the renderer process to use
// IPC without exposing the entire electron API
const electronAPI = {
  // Platform information
  platform: process.platform,

  // Window controls
  closeWindow: (): void => {
    ipcRenderer.send('window:close');
  },
  minimizeWindow: (): void => {
    ipcRenderer.send('window:minimize');
  },
  maximizeWindow: (): void => {
    ipcRenderer.send('window:maximize');
  },

  // App info
  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion');
  },

  // Folder operations
  folder: {
    /**
     * Show native folder picker dialog.
     * @returns Promise with selected folder path or null if cancelled
     */
    showPicker: (): Promise<string | null> => {
      return ipcRenderer.invoke('folder:showPicker');
    },

    /**
     * Get the currently selected folder.
     */
    getCurrent: (): Promise<string | null> => {
      return ipcRenderer.invoke('folder:getCurrent');
    },

    /**
     * Set the current folder and add to recent list.
     */
    setCurrent: (folderPath: string): Promise<void> => {
      return ipcRenderer.invoke('folder:setCurrent', folderPath);
    },

    /**
     * Get list of recent folders (max 10).
     */
    getRecent: (): Promise<string[]> => {
      return ipcRenderer.invoke('folder:getRecent');
    },

    /**
     * Remove a folder from the recent list.
     */
    removeRecent: (folderPath: string): Promise<void> => {
      return ipcRenderer.invoke('folder:removeRecent', folderPath);
    },

    /**
     * Clear all recent folders.
     */
    clearRecent: (): Promise<void> => {
      return ipcRenderer.invoke('folder:clearRecent');
    },
  },

  // File operations
  file: {
    /**
     * Read a file and return it as a data URL (for images, thumbnails, etc.)
     * @param filePath - Absolute path to the file
     * @returns Promise with data URL or null if file doesn't exist
     */
    readAsDataUrl: (filePath: string): Promise<string | null> => {
      return ipcRenderer.invoke('file:readAsDataUrl', filePath);
    },

    /**
     * Check if a file exists.
     * @param filePath - Absolute path to the file
     * @returns Promise with boolean indicating if file exists
     */
    exists: (filePath: string): Promise<boolean> => {
      return ipcRenderer.invoke('file:exists', filePath);
    },

    /**
     * Read a text file.
     * @param filePath - Absolute path to the file
     * @returns Promise with text content or null if file doesn't exist
     */
    readText: (filePath: string): Promise<string | null> => {
      return ipcRenderer.invoke('file:readText', filePath);
    },

    /**
     * Read directory contents.
     * @param dirPath - Absolute path to the directory
     * @returns Promise with array of filenames (empty if directory doesn't exist)
     */
    readDir: (dirPath: string): Promise<string[]> => {
      return ipcRenderer.invoke('file:readDir', dirPath);
    },
  },

  // CLI Spawner
  cli: {
    /**
     * Spawn a CLI command.
     * @param args - Command arguments to pass to the CLI
     * @param options - Spawn options (cwd, json mode)
     * @returns Promise with spawn ID and PID
     */
    spawn: (args: string[], options: CLISpawnOptions = {}): Promise<CLISpawnResult> => {
      return ipcRenderer.invoke('cli:spawn', args, options);
    },

    /**
     * Kill a spawned CLI process by its spawn ID.
     * @param spawnId - The spawn ID returned from spawn()
     * @returns Promise<boolean> - true if killed, false if not found
     */
    kill: (spawnId: string): Promise<boolean> => {
      return ipcRenderer.invoke('cli:kill', spawnId);
    },

    /**
     * Kill a process by its PID.
     * @param pid - The process ID
     * @returns Promise<boolean> - true if killed, false if not found
     */
    killByPid: (pid: number): Promise<boolean> => {
      return ipcRenderer.invoke('cli:killByPid', pid);
    },

    /**
     * Kill all active CLI processes.
     */
    killAll: (): Promise<void> => {
      return ipcRenderer.invoke('cli:killAll');
    },

    /**
     * Get the count of active CLI processes.
     */
    getActiveCount: (): Promise<number> => {
      return ipcRenderer.invoke('cli:getActiveCount');
    },

    /**
     * Listen for stdout lines from CLI processes.
     * @param callback - Called with (spawnId, line) for each line
     * @returns Cleanup function to remove the listener
     */
    onStdout: (callback: CLIStdoutCallback): (() => void) => {
      const handler = (_event: IpcRendererEvent, spawnId: string, line: string): void => {
        callback(spawnId, line);
      };
      ipcRenderer.on('cli:stdout', handler);
      return () => {
        ipcRenderer.removeListener('cli:stdout', handler);
      };
    },

    /**
     * Listen for stderr lines from CLI processes.
     * @param callback - Called with (spawnId, error) for each line
     * @returns Cleanup function to remove the listener
     */
    onStderr: (callback: CLIStderrCallback): (() => void) => {
      const handler = (_event: IpcRendererEvent, spawnId: string, error: string): void => {
        callback(spawnId, error);
      };
      ipcRenderer.on('cli:stderr', handler);
      return () => {
        ipcRenderer.removeListener('cli:stderr', handler);
      };
    },

    /**
     * Listen for JSON events from CLI processes (when using json mode).
     * @param callback - Called with (spawnId, event) for each JSON event
     * @returns Cleanup function to remove the listener
     */
    onJson: (callback: CLIJsonCallback): (() => void) => {
      const handler = (_event: IpcRendererEvent, spawnId: string, jsonEvent: JsonEvent): void => {
        callback(spawnId, jsonEvent);
      };
      ipcRenderer.on('cli:json', handler);
      return () => {
        ipcRenderer.removeListener('cli:json', handler);
      };
    },

    /**
     * Listen for process exit events.
     * @param callback - Called with (spawnId, code, signal) when a process exits
     * @returns Cleanup function to remove the listener
     */
    onExit: (callback: CLIExitCallback): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        spawnId: string,
        code: number | null,
        signal: string | null
      ): void => {
        callback(spawnId, code, signal);
      };
      ipcRenderer.on('cli:exit', handler);
      return () => {
        ipcRenderer.removeListener('cli:exit', handler);
      };
    },
  },
};

// Menu event callback types
export type MenuCallback = () => void;
export type MenuFolderCallback = (folderPath: string) => void;

// Menu API for listening to menu events from main process
const menuAPI = {
  /**
   * Listen for "Open Folder" menu action.
   * @returns Cleanup function to remove the listener
   */
  onOpenFolder: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:openFolder', handler);
    return () => ipcRenderer.removeListener('menu:openFolder', handler);
  },

  /**
   * Listen for "Open Recent Folder" menu action.
   * @returns Cleanup function to remove the listener
   */
  onOpenRecentFolder: (callback: MenuFolderCallback): (() => void) => {
    const handler = (_event: IpcRendererEvent, folderPath: string): void => callback(folderPath);
    ipcRenderer.on('menu:openRecentFolder', handler);
    return () => ipcRenderer.removeListener('menu:openRecentFolder', handler);
  },

  /**
   * Listen for "Clear Recent Folders" menu action.
   * @returns Cleanup function to remove the listener
   */
  onClearRecentFolders: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:clearRecentFolders', handler);
    return () => ipcRenderer.removeListener('menu:clearRecentFolders', handler);
  },

  /**
   * Listen for "Toggle Terminal" menu action.
   * @returns Cleanup function to remove the listener
   */
  onToggleTerminal: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:toggleTerminal', handler);
    return () => ipcRenderer.removeListener('menu:toggleTerminal', handler);
  },

  /**
   * Listen for "Toggle Sidebar" menu action.
   * @returns Cleanup function to remove the listener
   */
  onToggleSidebar: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:toggleSidebar', handler);
    return () => ipcRenderer.removeListener('menu:toggleSidebar', handler);
  },

  /**
   * Listen for "Show Settings" menu action.
   * @returns Cleanup function to remove the listener
   */
  onShowSettings: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:showSettings', handler);
    return () => ipcRenderer.removeListener('menu:showSettings', handler);
  },

  /**
   * Listen for "Show Prerequisites" menu action.
   * @returns Cleanup function to remove the listener
   */
  onShowPrerequisites: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:showPrerequisites', handler);
    return () => ipcRenderer.removeListener('menu:showPrerequisites', handler);
  },

  /**
   * Listen for "Show Model Manager" menu action.
   * @returns Cleanup function to remove the listener
   */
  onShowModelManager: (callback: MenuCallback): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('menu:showModelManager', handler);
    return () => ipcRenderer.removeListener('menu:showModelManager', handler);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('menuAPI', menuAPI);

// Type declarations for the exposed API
export type ElectronAPI = typeof electronAPI;
export type MenuAPI = typeof menuAPI;
