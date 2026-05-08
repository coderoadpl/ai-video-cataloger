import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { readFile, access } from 'node:fs/promises';
import { extname } from 'node:path';
import { constants } from 'node:fs';
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

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Store active spawned processes by their unique IDs
const spawnedProcesses = new Map<string, CLIProcessHandle>();
let nextSpawnId = 1;

/**
 * Register all IPC handlers for the main process.
 */
export function registerIPCHandlers(): void {
  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  // Window controls
  ipcMain.on('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  ipcMain.on('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
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
  ipcMain.handle('cli:kill', async (_event, spawnId: string): Promise<boolean> => {
    const handle = spawnedProcesses.get(spawnId);
    if (handle) {
      handle.kill();
      spawnedProcesses.delete(spawnId);
      return true;
    }
    return false;
  });

  // CLI Spawner - Kill a process by PID
  ipcMain.handle('cli:killByPid', async (_event, pid: number): Promise<boolean> => {
    return killProcess(pid);
  });

  // CLI Spawner - Kill all active processes
  ipcMain.handle('cli:killAll', async (): Promise<void> => {
    // Kill tracked spawned processes
    for (const handle of spawnedProcesses.values()) {
      handle.kill();
    }
    spawnedProcesses.clear();
    // Also kill any processes tracked in cli-spawner
    killAllProcesses();
  });

  // CLI Spawner - Get active process count
  ipcMain.handle('cli:getActiveCount', async (): Promise<number> => {
    return getActiveProcessCount();
  });

  // Folder picker - Show native folder dialog
  ipcMain.handle('folder:showPicker', async (event): Promise<string | null> => {
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
  ipcMain.handle('folder:getCurrent', (): string | null => {
    return getCurrentFolder();
  });

  // Folder store - Set current folder
  ipcMain.handle('folder:setCurrent', (event, folderPath: string): void => {
    setCurrentFolder(folderPath);
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    const recentFolders = getRecentFolders();
    updateRecentFoldersMenu(window, recentFolders);
  });

  // Folder store - Get recent folders
  ipcMain.handle('folder:getRecent', (): string[] => {
    return getRecentFolders();
  });

  // Folder store - Remove a recent folder
  ipcMain.handle('folder:removeRecent', (event, folderPath: string): void => {
    removeRecentFolder(folderPath);
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    const recentFolders = getRecentFolders();
    updateRecentFoldersMenu(window, recentFolders);
  });

  // Folder store - Clear recent folders
  ipcMain.handle('folder:clearRecent', (event): void => {
    clearRecentFolders();
    // Update the recent folders menu
    const window = BrowserWindow.fromWebContents(event.sender);
    updateRecentFoldersMenu(window, []);
  });

  // File operations - Read file as data URL (for thumbnails)
  ipcMain.handle('file:readAsDataUrl', async (_event, filePath: string): Promise<string | null> => {
    try {
      // Check if file exists and is readable
      await access(filePath, constants.R_OK);

      // Read file and convert to base64 data URL
      const buffer = await readFile(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = getMimeType(filePath);
      return `data:${mimeType};base64,${base64}`;
    } catch {
      // File doesn't exist or can't be read
      return null;
    }
  });

  // File operations - Check if file exists
  ipcMain.handle('file:exists', async (_event, filePath: string): Promise<boolean> => {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  // File operations - Read text file
  ipcMain.handle('file:readText', async (_event, filePath: string): Promise<string | null> => {
    try {
      // Check if file exists and is readable
      await access(filePath, constants.R_OK);
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch {
      // File doesn't exist or can't be read
      return null;
    }
  });

  // File operations - Read directory contents
  ipcMain.handle('file:readDir', async (_event, dirPath: string): Promise<string[]> => {
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dirPath);
      return entries;
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }
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
