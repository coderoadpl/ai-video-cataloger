import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(CURRENT_DIR, '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'apps', 'cli', 'src', 'main.ts');

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  },
): Promise<CommandResult> {
  const effectiveCwd = options?.cwd ?? PROJECT_ROOT;
  const timeout = options?.timeout ?? 30000;

  return new Promise((resolve, reject) => {
    const generatedHome = options?.env?.HOME === undefined ? mkdtempSync(join(tmpdir(), 'avc-cli-home-')) : null;
    const proc = spawn(process.execPath, ['--import', 'tsx', CLI_PATH, ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...(generatedHome === null ? {} : { HOME: generatedHome }),
        AVC_WORKING_DIRECTORY: effectiveCwd,
        ...options?.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (generatedHome !== null) rmSync(generatedHome, { recursive: true, force: true });
      if (killed) {
        reject(new Error(`Command timed out after ${timeout}ms`));
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      if (generatedHome !== null) rmSync(generatedHome, { recursive: true, force: true });
      reject(error);
    });
  });
}

export function parseJsonEvents(output: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    if (line.trim().length > 0) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null) events.push(parsed);
      } catch {
        continue;
      }
    }
  }

  return events;
}

export function findEvent(
  events: Array<Record<string, unknown>>,
  type: string,
): Record<string, unknown> | undefined {
  return events.find((event) => event.type === type);
}

export function getCliPath(): string {
  return CLI_PATH;
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
