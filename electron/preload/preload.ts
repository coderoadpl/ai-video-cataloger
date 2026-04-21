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

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declarations for the exposed API
export type ElectronAPI = typeof electronAPI;
