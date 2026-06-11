/**
 * useCliCommand - the ONLY renderer module that talks to window.electronAPI.cli.
 *
 * Wraps the spawn/listen/cleanup lifecycle of a CLI process into a single
 * promise-returning function. Every event callback is filtered by the spawnId
 * of the process this run started, so concurrent processes cannot cross-talk.
 */

import { useCallback } from 'react';

/** Result of a completed CLI command run. */
export interface CliRunResult {
  /** Process exit code (null when terminated by a signal). */
  code: number | null;
  /** Termination signal (e.g. 'SIGTERM' when cancelled), null on normal exit. */
  signal: string | null;
  /** All JSON events received from this process, in order. */
  events: JsonEvent[];
}

/** Callbacks invoked while the CLI command is running. */
export interface CliRunCallbacks {
  /** Called for every JSON event emitted by this process. */
  onJson?: (event: JsonEvent) => void;
  /** Called for every raw output line from this process (terminal log feed). */
  onLine?: (line: string, source: 'stdout' | 'stderr') => void;
}

/** Options for running a CLI command. */
export interface CliRunOptions {
  /** Aborting kills the spawned process via cli.kill(spawnId). */
  signal?: AbortSignal;
  /** Working directory for the spawned process. */
  cwd?: string;
}

export type RunCli = (
  args: string[],
  callbacks?: CliRunCallbacks,
  options?: CliRunOptions
) => Promise<CliRunResult>;

/**
 * Returns a stable runCli function that spawns the CLI in JSON mode and
 * resolves when the process exits. Listeners are always cleaned up.
 */
export function useCliCommand(): RunCli {
  return useCallback<RunCli>(async (args, callbacks = {}, options = {}) => {
    const api = window.electronAPI;
    if (!api) {
      throw new Error('electronAPI is not available');
    }

    const { onJson, onLine } = callbacks;
    const { signal, cwd } = options;

    const events: JsonEvent[] = [];
    const cleanups: Array<() => void> = [];
    let ownSpawnId: string | null = null;

    try {
      return await new Promise<CliRunResult>((resolve, reject) => {
        const handleStdout = (spawnId: string, line: string): void => {
          if (spawnId !== ownSpawnId) return;
          onLine?.(line, 'stdout');
        };

        const handleStderr = (spawnId: string, line: string): void => {
          if (spawnId !== ownSpawnId) return;
          onLine?.(line, 'stderr');
        };

        const handleJson = (spawnId: string, event: JsonEvent): void => {
          if (spawnId !== ownSpawnId) return;
          events.push(event);
          onJson?.(event);
        };

        const handleExit = (spawnId: string, code: number | null, exitSignal: string | null): void => {
          if (spawnId !== ownSpawnId) return;
          resolve({ code, signal: exitSignal, events });
        };

        cleanups.push(api.cli.onStdout(handleStdout));
        cleanups.push(api.cli.onStderr(handleStderr));
        cleanups.push(api.cli.onJson(handleJson));
        cleanups.push(api.cli.onExit(handleExit));

        if (signal) {
          if (signal.aborted) {
            reject(new Error('Command aborted before spawn'));
            return;
          }
          const handleAbort = (): void => {
            if (ownSpawnId !== null) {
              void api.cli.kill(ownSpawnId);
            }
          };
          signal.addEventListener('abort', handleAbort);
          cleanups.push(() => signal.removeEventListener('abort', handleAbort));
        }

        api.cli
          .spawn(args, { json: true, cwd })
          .then(({ spawnId }) => {
            ownSpawnId = spawnId;
            // If the caller aborted while the spawn was in flight, kill now.
            if (signal?.aborted) {
              void api.cli.kill(spawnId);
            }
          })
          .catch((error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    } finally {
      for (const cleanup of cleanups) {
        cleanup();
      }
    }
  }, []);
}
