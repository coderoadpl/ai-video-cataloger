/**
 * Installable mock of window.electronAPI (and window.menuAPI) for renderer tests.
 *
 * Mirrors the surface of the real preload bridge (electron/preload/preload.ts,
 * typed globally in src/vite-env.d.ts): cli.spawn resolves with a spawnId the
 * test controls, and the emit* helpers deliver cli:stdout / cli:stderr /
 * cli:json / cli:exit events to registered listeners with a given spawnId.
 */

// A single cli.spawn invocation, recorded for assertions
export interface SpawnRecord {
  spawnId: string;
  args: string[];
  options: CLISpawnOptions;
}

export interface ElectronApiMock {
  /** The mock electronAPI object installed on window. */
  electronAPI: ElectronAPI;
  /** Every cli.spawn call, in order. */
  spawns: SpawnRecord[];
  /** Every spawnId passed to cli.kill, in order. */
  killed: string[];
  /** Queue an explicit spawnId for the next cli.spawn call. */
  queueSpawnId: (spawnId: string) => void;
  /** Resolves with the next not-yet-consumed cli.spawn call. */
  waitForSpawn: () => Promise<SpawnRecord>;
  /** Emit a cli:stdout line to all registered listeners. */
  emitStdout: (spawnId: string, line: string) => void;
  /** Emit a cli:stderr line to all registered listeners. */
  emitStderr: (spawnId: string, line: string) => void;
  /** Emit a cli:json event to all registered listeners. */
  emitJson: (spawnId: string, event: JsonEvent) => void;
  /** Emit a cli:exit event to all registered listeners. */
  emitExit: (spawnId: string, code: number | null, signal?: string | null) => void;
  /** Number of currently registered listeners per channel. */
  listenerCounts: () => { stdout: number; stderr: number; json: number; exit: number };
}

/**
 * Create the mock and install it on window.electronAPI / window.menuAPI.
 */
export function installElectronApiMock(): ElectronApiMock {
  const spawns: SpawnRecord[] = [];
  const killed: string[] = [];
  const queuedSpawnIds: string[] = [];
  const pendingSpawns: SpawnRecord[] = [];
  const spawnWaiters: Array<(record: SpawnRecord) => void> = [];
  let nextSpawnId = 1;

  const stdoutListeners = new Set<CLIStdoutCallback>();
  const stderrListeners = new Set<CLIStderrCallback>();
  const jsonListeners = new Set<CLIJsonCallback>();
  const exitListeners = new Set<CLIExitCallback>();

  const electronAPI: ElectronAPI = {
    platform: 'darwin',
    closeWindow: (): void => {},
    minimizeWindow: (): void => {},
    maximizeWindow: (): void => {},
    getAppVersion: (): Promise<string> => Promise.resolve('0.0.0-test'),
    folder: {
      showPicker: (): Promise<string | null> => Promise.resolve(null),
      getCurrent: (): Promise<string | null> => Promise.resolve(null),
      setCurrent: (): Promise<void> => Promise.resolve(),
      getRecent: (): Promise<string[]> => Promise.resolve([]),
      removeRecent: (): Promise<void> => Promise.resolve(),
      clearRecent: (): Promise<void> => Promise.resolve(),
    },
    cli: {
      spawn: (args: string[], options: CLISpawnOptions = {}): Promise<CLISpawnResult> => {
        const spawnId = queuedSpawnIds.shift() ?? `spawn-${nextSpawnId++}`;
        const record: SpawnRecord = { spawnId, args, options };
        spawns.push(record);
        const waiter = spawnWaiters.shift();
        if (waiter) {
          waiter(record);
        } else {
          pendingSpawns.push(record);
        }
        return Promise.resolve({ spawnId, pid: 4242 });
      },
      kill: (spawnId: string): Promise<boolean> => {
        killed.push(spawnId);
        return Promise.resolve(true);
      },
      killByPid: (): Promise<boolean> => Promise.resolve(true),
      killAll: (): Promise<void> => Promise.resolve(),
      getActiveCount: (): Promise<number> => Promise.resolve(0),
      onStdout: (callback: CLIStdoutCallback): (() => void) => {
        stdoutListeners.add(callback);
        return () => {
          stdoutListeners.delete(callback);
        };
      },
      onStderr: (callback: CLIStderrCallback): (() => void) => {
        stderrListeners.add(callback);
        return () => {
          stderrListeners.delete(callback);
        };
      },
      onJson: (callback: CLIJsonCallback): (() => void) => {
        jsonListeners.add(callback);
        return () => {
          jsonListeners.delete(callback);
        };
      },
      onExit: (callback: CLIExitCallback): (() => void) => {
        exitListeners.add(callback);
        return () => {
          exitListeners.delete(callback);
        };
      },
    },
  };

  const menuAPI: MenuAPI = {
    onOpenFolder: () => () => {},
    onOpenRecentFolder: () => () => {},
    onClearRecentFolders: () => () => {},
    onToggleTerminal: () => () => {},
    onToggleSidebar: () => () => {},
    onShowSettings: () => () => {},
    onShowPrerequisites: () => () => {},
    onShowModelManager: () => () => {},
  };

  window.electronAPI = electronAPI;
  window.menuAPI = menuAPI;

  return {
    electronAPI,
    spawns,
    killed,
    queueSpawnId: (spawnId: string): void => {
      queuedSpawnIds.push(spawnId);
    },
    waitForSpawn: (): Promise<SpawnRecord> => {
      const next = pendingSpawns.shift();
      if (next) {
        return Promise.resolve(next);
      }
      return new Promise<SpawnRecord>((resolve) => {
        spawnWaiters.push(resolve);
      });
    },
    emitStdout: (spawnId: string, line: string): void => {
      for (const callback of stdoutListeners) {
        callback(spawnId, line);
      }
    },
    emitStderr: (spawnId: string, line: string): void => {
      for (const callback of stderrListeners) {
        callback(spawnId, line);
      }
    },
    emitJson: (spawnId: string, event: JsonEvent): void => {
      for (const callback of jsonListeners) {
        callback(spawnId, event);
      }
    },
    emitExit: (spawnId: string, code: number | null, signal: string | null = null): void => {
      for (const callback of exitListeners) {
        callback(spawnId, code, signal);
      }
    },
    listenerCounts: () => ({
      stdout: stdoutListeners.size,
      stderr: stderrListeners.size,
      json: jsonListeners.size,
      exit: exitListeners.size,
    }),
  };
}
