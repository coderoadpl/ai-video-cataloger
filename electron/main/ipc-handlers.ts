import {
  ipcMain,
  app,
  BrowserWindow,
  dialog,
  IpcMainEvent,
  IpcMainInvokeEvent,
} from 'electron';
import {
  spawnCLI,
  spawnCLIWithJson,
  killProcess,
  killAllProcesses,
  getActiveProcessCount,
  CLIProcessHandle,
  JsonEvent,
} from './cli-spawner.js';
import {
  getCurrentFolder,
  setCurrentFolder,
  getRecentFolders,
  removeRecentFolder,
  clearRecentFolders,
} from './folder-store.js';
import { updateRecentFoldersMenu } from './menu.js';

// Store active spawned processes by their unique IDs
const spawnedProcesses = new Map<string, CLIProcessHandle>();
let nextSpawnId = 1;

/**
 * Check that an IPC event originates from the main window's webContents.
 * Requests from any other sender (e.g. an unexpected frame or window) are
 * considered untrusted and must be rejected by the caller.
 */
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  return (
    mainWindow !== undefined &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents
  );
}

/**
 * Register all IPC handlers for the main process.
 */
export function registerIPCHandlers(): void {
  // App info
  ipcMain.handle('app:getVersion', (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return app.getVersion();
  });

  // Window controls
  ipcMain.on('window:close', (event) => {
    if (!isTrustedSender(event)) {
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  ipcMain.on('window:minimize', (event) => {
    if (!isTrustedSender(event)) {
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    if (!isTrustedSender(event)) {
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });

  // CLI Spawner - Start a CLI process
  ipcMain.handle(
    'cli:spawn',
    async (
      event,
      args: string[],
      options: { cwd?: string; json?: boolean }
    ): Promise<{ spawnId: string; pid: number | undefined }> => {
      if (!isTrustedSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }

      const spawnId = `spawn-${nextSpawnId++}`;
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error('No window found for spawn request');
      }

      const handle = options.json
        ? spawnCLIWithJson(
            args,
            options,
            // JSON event callback
            (jsonEvent: JsonEvent) => {
              if (!window.isDestroyed()) {
                window.webContents.send('cli:json', spawnId, jsonEvent);
              }
            },
            // Raw output callback (for non-JSON lines when using JSON mode)
            (line: string) => {
              if (!window.isDestroyed()) {
                window.webContents.send('cli:stdout', spawnId, line);
              }
            },
            // Stderr callback
            (error: string) => {
              if (!window.isDestroyed()) {
                window.webContents.send('cli:stderr', spawnId, error);
              }
            },
            // Exit callback
            (code: number | null, signal: NodeJS.Signals | null) => {
              spawnedProcesses.delete(spawnId);
              if (!window.isDestroyed()) {
                window.webContents.send('cli:exit', spawnId, code, signal);
              }
            }
          )
        : spawnCLI(
            args,
            options,
            // Stdout callback
            (line: string) => {
              if (!window.isDestroyed()) {
                window.webContents.send('cli:stdout', spawnId, line);
              }
            },
            // Stderr callback
            (error: string) => {
              if (!window.isDestroyed()) {
                window.webContents.send('cli:stderr', spawnId, error);
              }
            },
            // Exit callback
            (code: number | null, signal: NodeJS.Signals | null) => {
              spawnedProcesses.delete(spawnId);
              if (!window.isDestroyed()) {
                window.webContents.send('cli:exit', spawnId, code, signal);
              }
            }
          );

      spawnedProcesses.set(spawnId, handle);

      return { spawnId, pid: handle.pid };
    }
  );

  // CLI Spawner - Kill a specific spawned process
  ipcMain.handle('cli:kill', async (event, spawnId: string): Promise<boolean> => {
    if (!isTrustedSender(event)) {
      return false;
    }
    const handle = spawnedProcesses.get(spawnId);
    if (handle) {
      handle.kill();
      spawnedProcesses.delete(spawnId);
      return true;
    }
    return false;
  });

  // CLI Spawner - Kill a process by PID
  ipcMain.handle('cli:killByPid', async (event, pid: number): Promise<boolean> => {
    if (!isTrustedSender(event)) {
      return false;
    }
    return killProcess(pid);
  });

  // CLI Spawner - Kill all active processes
  ipcMain.handle('cli:killAll', async (event): Promise<void> => {
    if (!isTrustedSender(event)) {
      return;
    }
    // Kill tracked spawned processes
    for (const handle of spawnedProcesses.values()) {
      handle.kill();
    }
    spawnedProcesses.clear();
    // Also kill any processes tracked in cli-spawner
    killAllProcesses();
  });

  // CLI Spawner - Get active process count
  ipcMain.handle('cli:getActiveCount', async (event): Promise<number> => {
    if (!isTrustedSender(event)) {
      return 0;
    }
    return getActiveProcessCount();
  });

  // Folder picker - Show native folder dialog
  ipcMain.handle('folder:showPicker', async (event): Promise<string | null> => {
    if (!isTrustedSender(event)) {
      return null;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return null;
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Video Folder',
      buttonLabel: 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Folder store - Get current folder
  ipcMain.handle('folder:getCurrent', (event): string | null => {
    if (!isTrustedSender(event)) {
      return null;
    }
    return getCurrentFolder();
  });

  // Folder store - Set current folder
  ipcMain.handle('folder:setCurrent', (event, folderPath: string): void => {
    if (!isTrustedSender(event)) {
      return;
    }
    setCurrentFolder(folderPath);
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    const recentFolders = getRecentFolders();
    updateRecentFoldersMenu(window, recentFolders);
  });

  // Folder store - Get recent folders
  ipcMain.handle('folder:getRecent', (event): string[] => {
    if (!isTrustedSender(event)) {
      return [];
    }
    return getRecentFolders();
  });

  // Folder store - Remove a recent folder
  ipcMain.handle('folder:removeRecent', (event, folderPath: string): void => {
    if (!isTrustedSender(event)) {
      return;
    }
    removeRecentFolder(folderPath);
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    const recentFolders = getRecentFolders();
    updateRecentFoldersMenu(window, recentFolders);
  });

  // Folder store - Clear recent folders
  ipcMain.handle('folder:clearRecent', (event): void => {
    if (!isTrustedSender(event)) {
      return;
    }
    clearRecentFolders();
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    updateRecentFoldersMenu(window, []);
  });
}

/**
 * Cleanup function to be called on app quit.
 */
export function cleanupIPCHandlers(): void {
  // Kill all spawned processes
  for (const handle of spawnedProcesses.values()) {
    handle.kill();
  }
  spawnedProcesses.clear();
  killAllProcesses();
}
