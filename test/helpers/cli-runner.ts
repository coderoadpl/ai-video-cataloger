/**
 * CLI runner helper for tests
 * Executes CLI commands and captures output
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'dist', 'index.js');

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run CLI command and capture output
 */
export function runCli(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }
): Promise<CommandResult> {
  const cwd = options?.cwd ?? PROJECT_ROOT;
  const timeout = options?.timeout ?? 30000;

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (killed) {
        reject(new Error(`Command timed out after ${timeout}ms`));
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Parse JSON events from CLI output (newline-delimited JSON)
 */
export function parseJsonEvents(output: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    if (line.trim()) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip non-JSON lines
      }
    }
  }

  return events;
}

/**
 * Find a specific event type in parsed events
 */
export function findEvent(
  events: Array<Record<string, unknown>>,
  type: string
): Record<string, unknown> | undefined {
  return events.find((e) => e.type === type);
}

/**
 * Get the CLI path
 */
export function getCliPath(): string {
  return CLI_PATH;
}

/**
 * Get the project root path
 */
export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
