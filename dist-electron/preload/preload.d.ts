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
export interface CLISpawnOptions {
    cwd?: string;
    json?: boolean;
}
export interface CLISpawnResult {
    spawnId: string;
    pid: number | undefined;
}
export type CLIStdoutCallback = (spawnId: string, line: string) => void;
export type CLIStderrCallback = (spawnId: string, error: string) => void;
export type CLIJsonCallback = (spawnId: string, event: JsonEvent) => void;
export type CLIExitCallback = (spawnId: string, code: number | null, signal: string | null) => void;
declare const electronAPI: {
    platform: NodeJS.Platform;
    closeWindow: () => void;
    minimizeWindow: () => void;
    maximizeWindow: () => void;
    getAppVersion: () => Promise<string>;
    folder: {
        /**
         * Show native folder picker dialog.
         * @returns Promise with selected folder path or null if cancelled
         */
        showPicker: () => Promise<string | null>;
        /**
         * Get the currently selected folder.
         */
        getCurrent: () => Promise<string | null>;
        /**
         * Set the current folder and add to recent list.
         */
        setCurrent: (folderPath: string) => Promise<void>;
        /**
         * Get list of recent folders (max 10).
         */
        getRecent: () => Promise<string[]>;
        /**
         * Remove a folder from the recent list.
         */
        removeRecent: (folderPath: string) => Promise<void>;
        /**
         * Clear all recent folders.
         */
        clearRecent: () => Promise<void>;
    };
    file: {
        /**
         * Read a file and return it as a data URL (for images, thumbnails, etc.)
         * @param filePath - Absolute path to the file
         * @returns Promise with data URL or null if file doesn't exist
         */
        readAsDataUrl: (filePath: string) => Promise<string | null>;
        /**
         * Check if a file exists.
         * @param filePath - Absolute path to the file
         * @returns Promise with boolean indicating if file exists
         */
        exists: (filePath: string) => Promise<boolean>;
        /**
         * Read a text file.
         * @param filePath - Absolute path to the file
         * @returns Promise with text content or null if file doesn't exist
         */
        readText: (filePath: string) => Promise<string | null>;
        /**
         * Read directory contents.
         * @param dirPath - Absolute path to the directory
         * @returns Promise with array of filenames (empty if directory doesn't exist)
         */
        readDir: (dirPath: string) => Promise<string[]>;
    };
    cli: {
        /**
         * Spawn a CLI command.
         * @param args - Command arguments to pass to the CLI
         * @param options - Spawn options (cwd, json mode)
         * @returns Promise with spawn ID and PID
         */
        spawn: (args: string[], options?: CLISpawnOptions) => Promise<CLISpawnResult>;
        /**
         * Kill a spawned CLI process by its spawn ID.
         * @param spawnId - The spawn ID returned from spawn()
         * @returns Promise<boolean> - true if killed, false if not found
         */
        kill: (spawnId: string) => Promise<boolean>;
        /**
         * Kill a process by its PID.
         * @param pid - The process ID
         * @returns Promise<boolean> - true if killed, false if not found
         */
        killByPid: (pid: number) => Promise<boolean>;
        /**
         * Kill all active CLI processes.
         */
        killAll: () => Promise<void>;
        /**
         * Get the count of active CLI processes.
         */
        getActiveCount: () => Promise<number>;
        /**
         * Listen for stdout lines from CLI processes.
         * @param callback - Called with (spawnId, line) for each line
         * @returns Cleanup function to remove the listener
         */
        onStdout: (callback: CLIStdoutCallback) => (() => void);
        /**
         * Listen for stderr lines from CLI processes.
         * @param callback - Called with (spawnId, error) for each line
         * @returns Cleanup function to remove the listener
         */
        onStderr: (callback: CLIStderrCallback) => (() => void);
        /**
         * Listen for JSON events from CLI processes (when using json mode).
         * @param callback - Called with (spawnId, event) for each JSON event
         * @returns Cleanup function to remove the listener
         */
        onJson: (callback: CLIJsonCallback) => (() => void);
        /**
         * Listen for process exit events.
         * @param callback - Called with (spawnId, code, signal) when a process exits
         * @returns Cleanup function to remove the listener
         */
        onExit: (callback: CLIExitCallback) => (() => void);
    };
};
export type ElectronAPI = typeof electronAPI;
export {};
