import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { app } from 'electron';

// Types for CLI spawner
export interface CLIProcessHandle {
  pid: number | undefined;
  kill: () => void;
}

export interface CLISpawnOptions {
  cwd?: string;
  json?: boolean;
}

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

export type OutputCallback = (line: string) => void;
export type ErrorCallback = (error: string) => void;
export type JsonCallback = (event: JsonEvent) => void;
export type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void;

// Store for active processes (for cleanup and kill capability)
const activeProcesses = new Map<number, ChildProcess>();
let nextProcessId = 1;

/**
 * Get the path to the CLI binary.
 * In development, use the local dist/index.js.
 * In production, it should be bundled with the app.
 */
function getCLIPath(): string {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // In development, use the locally built CLI
    return path.join(process.cwd(), 'dist', 'index.js');
  } else {
    // In production, the CLI is bundled with the app
    // It should be in the app's resources directory
    return path.join(process.resourcesPath, 'cli', 'index.js');
  }
}

/**
 * Spawn a CLI command and stream its output.
 *
 * @param args - Command arguments to pass to the CLI
 * @param options - Spawn options
 * @param onStdout - Callback for stdout lines
 * @param onStderr - Callback for stderr lines
 * @param onExit - Callback when process exits
 * @returns Process handle with kill capability
 */
export function spawnCLI(
  args: string[],
  options: CLISpawnOptions,
  onStdout: OutputCallback,
  onStderr: ErrorCallback,
  onExit: ExitCallback
): CLIProcessHandle {
  const cliPath = getCLIPath();
  const processId = nextProcessId++;

  // Build the command arguments
  const fullArgs = [...args];

  // Set up the spawn options
  const spawnOptions = {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env },
    shell: false,
  };

  // Spawn the CLI process using node
  const child = spawn('node', [cliPath, ...fullArgs], spawnOptions);

  // Store the process for later reference
  if (child.pid) {
    activeProcesses.set(processId, child);
  }

  // Stream stdout line by line
  if (child.stdout) {
    const stdoutRL = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    stdoutRL.on('line', (line) => {
      onStdout(line);
    });
  }

  // Stream stderr line by line
  if (child.stderr) {
    const stderrRL = createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    });

    stderrRL.on('line', (line) => {
      onStderr(line);
    });
  }

  // Handle process exit
  child.on('exit', (code, signal) => {
    activeProcesses.delete(processId);
    onExit(code, signal);
  });

  // Handle spawn errors
  child.on('error', (error) => {
    activeProcesses.delete(processId);
    onStderr(`Failed to spawn CLI: ${error.message}`);
    onExit(1, null);
  });

  // Return handle for kill capability
  return {
    pid: child.pid,
    kill: () => {
      if (child.pid && !child.killed) {
        child.kill('SIGTERM');
        activeProcesses.delete(processId);
      }
    },
  };
}

/**
 * Parse a JSON line from CLI output.
 * Returns the parsed event or null if not valid JSON.
 */
export function parseJsonLine(line: string): JsonEvent | null {
  try {
    const parsed = JSON.parse(line);
    // Validate it has the expected structure
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as JsonEvent;
    }
    return null;
  } catch {
    // Not JSON, return null
    return null;
  }
}

/**
 * Spawn a CLI command with JSON output parsing.
 * This is a convenience wrapper that parses JSON events from stdout.
 *
 * @param args - Command arguments (--json will be added automatically)
 * @param options - Spawn options
 * @param onJson - Callback for parsed JSON events
 * @param onRawOutput - Callback for non-JSON stdout lines
 * @param onStderr - Callback for stderr lines
 * @param onExit - Callback when process exits
 * @returns Process handle with kill capability
 */
export function spawnCLIWithJson(
  args: string[],
  options: CLISpawnOptions,
  onJson: JsonCallback,
  onRawOutput: OutputCallback,
  onStderr: ErrorCallback,
  onExit: ExitCallback
): CLIProcessHandle {
  // Ensure --json flag is included
  const fullArgs = args.includes('--json') ? args : ['--json', ...args];

  return spawnCLI(
    fullArgs,
    { ...options, json: true },
    (line) => {
      const jsonEvent = parseJsonLine(line);
      if (jsonEvent) {
        onJson(jsonEvent);
      } else {
        // Pass through non-JSON lines
        onRawOutput(line);
      }
    },
    onStderr,
    onExit
  );
}

/**
 * Kill a process by its PID.
 * Returns true if the process was killed, false if not found.
 */
export function killProcess(pid: number): boolean {
  for (const [, child] of activeProcesses) {
    if (child.pid === pid && !child.killed) {
      child.kill('SIGTERM');
      return true;
    }
  }
  return false;
}

/**
 * Kill all active CLI processes.
 * Useful for cleanup on app quit.
 */
export function killAllProcesses(): void {
  for (const [, child] of activeProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  activeProcesses.clear();
}

/**
 * Get the count of active CLI processes.
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
