import { contextBridge, ipcRenderer } from 'electron';
// Expose protected methods that allow the renderer process to use
// IPC without exposing the entire electron API
const electronAPI = {
    // Platform information
    platform: process.platform,
    // Window controls
    closeWindow: () => {
        ipcRenderer.send('window:close');
    },
    minimizeWindow: () => {
        ipcRenderer.send('window:minimize');
    },
    maximizeWindow: () => {
        ipcRenderer.send('window:maximize');
    },
    // App info
    getAppVersion: () => {
        return ipcRenderer.invoke('app:getVersion');
    },
    // Folder operations
    folder: {
        /**
         * Show native folder picker dialog.
         * @returns Promise with selected folder path or null if cancelled
         */
        showPicker: () => {
            return ipcRenderer.invoke('folder:showPicker');
        },
        /**
         * Get the currently selected folder.
         */
        getCurrent: () => {
            return ipcRenderer.invoke('folder:getCurrent');
        },
        /**
         * Set the current folder and add to recent list.
         */
        setCurrent: (folderPath) => {
            return ipcRenderer.invoke('folder:setCurrent', folderPath);
        },
        /**
         * Get list of recent folders (max 10).
         */
        getRecent: () => {
            return ipcRenderer.invoke('folder:getRecent');
        },
        /**
         * Remove a folder from the recent list.
         */
        removeRecent: (folderPath) => {
            return ipcRenderer.invoke('folder:removeRecent', folderPath);
        },
        /**
         * Clear all recent folders.
         */
        clearRecent: () => {
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
        readAsDataUrl: (filePath) => {
            return ipcRenderer.invoke('file:readAsDataUrl', filePath);
        },
        /**
         * Check if a file exists.
         * @param filePath - Absolute path to the file
         * @returns Promise with boolean indicating if file exists
         */
        exists: (filePath) => {
            return ipcRenderer.invoke('file:exists', filePath);
        },
        /**
         * Read a text file.
         * @param filePath - Absolute path to the file
         * @returns Promise with text content or null if file doesn't exist
         */
        readText: (filePath) => {
            return ipcRenderer.invoke('file:readText', filePath);
        },
        /**
         * Read directory contents.
         * @param dirPath - Absolute path to the directory
         * @returns Promise with array of filenames (empty if directory doesn't exist)
         */
        readDir: (dirPath) => {
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
        spawn: (args, options = {}) => {
            return ipcRenderer.invoke('cli:spawn', args, options);
        },
        /**
         * Kill a spawned CLI process by its spawn ID.
         * @param spawnId - The spawn ID returned from spawn()
         * @returns Promise<boolean> - true if killed, false if not found
         */
        kill: (spawnId) => {
            return ipcRenderer.invoke('cli:kill', spawnId);
        },
        /**
         * Kill a process by its PID.
         * @param pid - The process ID
         * @returns Promise<boolean> - true if killed, false if not found
         */
        killByPid: (pid) => {
            return ipcRenderer.invoke('cli:killByPid', pid);
        },
        /**
         * Kill all active CLI processes.
         */
        killAll: () => {
            return ipcRenderer.invoke('cli:killAll');
        },
        /**
         * Get the count of active CLI processes.
         */
        getActiveCount: () => {
            return ipcRenderer.invoke('cli:getActiveCount');
        },
        /**
         * Listen for stdout lines from CLI processes.
         * @param callback - Called with (spawnId, line) for each line
         * @returns Cleanup function to remove the listener
         */
        onStdout: (callback) => {
            const handler = (_event, spawnId, line) => {
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
        onStderr: (callback) => {
            const handler = (_event, spawnId, error) => {
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
        onJson: (callback) => {
            const handler = (_event, spawnId, jsonEvent) => {
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
        onExit: (callback) => {
            const handler = (_event, spawnId, code, signal) => {
                callback(spawnId, code, signal);
            };
            ipcRenderer.on('cli:exit', handler);
            return () => {
                ipcRenderer.removeListener('cli:exit', handler);
            };
        },
    },
};
// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
//# sourceMappingURL=preload.js.map