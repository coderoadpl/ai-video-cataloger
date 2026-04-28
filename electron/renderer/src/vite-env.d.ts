/// <reference types="vite/client" />

// Types for JSON events from CLI
interface JsonEvent {
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
interface CLISpawnOptions {
  cwd?: string;
  json?: boolean;
}

// Result from spawning a CLI process
interface CLISpawnResult {
  spawnId: string;
  pid: number | undefined;
}

// Callback types for CLI events
type CLIStdoutCallback = (spawnId: string, line: string) => void;
type CLIStderrCallback = (spawnId: string, error: string) => void;
type CLIJsonCallback = (spawnId: string, event: JsonEvent) => void;
type CLIExitCallback = (spawnId: string, code: number | null, signal: string | null) => void;

// CLI Spawner API
interface CLIAPI {
  spawn: (args: string[], options?: CLISpawnOptions) => Promise<CLISpawnResult>;
  kill: (spawnId: string) => Promise<boolean>;
  killByPid: (pid: number) => Promise<boolean>;
  killAll: () => Promise<void>;
  getActiveCount: () => Promise<number>;
  onStdout: (callback: CLIStdoutCallback) => () => void;
  onStderr: (callback: CLIStderrCallback) => () => void;
  onJson: (callback: CLIJsonCallback) => () => void;
  onExit: (callback: CLIExitCallback) => () => void;
}

// Folder API
interface FolderAPI {
  showPicker: () => Promise<string | null>;
  getCurrent: () => Promise<string | null>;
  setCurrent: (folderPath: string) => Promise<void>;
  getRecent: () => Promise<string[]>;
  removeRecent: (folderPath: string) => Promise<void>;
  clearRecent: () => Promise<void>;
}

// File API
interface FileAPI {
  readAsDataUrl: (filePath: string) => Promise<string | null>;
  exists: (filePath: string) => Promise<boolean>;
  readText: (filePath: string) => Promise<string | null>;
  readDir: (dirPath: string) => Promise<string[]>;
}

interface ElectronAPI {
  platform: NodeJS.Platform;
  closeWindow: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  getAppVersion: () => Promise<string>;
  file: FileAPI;
  cli: CLIAPI;
  folder: FolderAPI;
}

interface Window {
  electronAPI: ElectronAPI;
}
