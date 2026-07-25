import { execFile } from 'node:child_process';
import { lstat, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

import { appError, ok, type AppError, type CliPathEntry, type Result } from '@core/domain/index.js';

const execFileAsync = promisify(execFile);

const VERSION_PROBE_TIMEOUT_MS = 4_000;

interface CliPathAdapterConfig {
  commandName: string;
  ownedInstallPaths: readonly string[];
}

export const parseCliVersion = (output: string): string | null => {
  const match = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(output);
  return match === null ? null : match[0];
};

export class NodeCliPathAdapter {
  readonly commandName: string;
  readonly ownedInstallPaths: readonly string[];

  constructor(config: CliPathAdapterConfig) {
    this.commandName = config.commandName;
    this.ownedInstallPaths = config.ownedInstallPaths;
  }

  async resolveOnPath(): Promise<Result<CliPathEntry[], AppError>> {
    const paths = await this.locate();
    if (!paths.ok) return paths;
    const entries: CliPathEntry[] = [];
    for (const path of paths.value) {
      entries.push({
        path,
        version: await this.probeVersion(path),
        ...(await this.linkInfo(path)),
      });
    }
    return ok(entries);
  }

  private async locate(): Promise<Result<string[], AppError>> {
    try {
      const { stdout } = await execFileAsync('/usr/bin/which', ['-a', this.commandName]);
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || seen.has(trimmed)) continue;
        seen.add(trimmed);
        paths.push(trimmed);
      }
      return ok(paths);
    } catch (error) {
      if (isCommandNotFound(error)) return ok([]);
      return { ok: false, error: appError('internal', 'Unable to scan PATH for the command line tool') };
    }
  }

  private async probeVersion(path: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(path, ['--version'], { timeout: VERSION_PROBE_TIMEOUT_MS });
      return parseCliVersion(stdout);
    } catch {
      return null;
    }
  }

  private async linkInfo(path: string): Promise<{ isSymlink: boolean; symlinkTarget: string | null }> {
    try {
      const stats = await lstat(path);
      if (!stats.isSymbolicLink()) return { isSymlink: false, symlinkTarget: null };
      return { isSymlink: true, symlinkTarget: await readlink(path).catch(() => null) };
    } catch {
      return { isSymlink: false, symlinkTarget: null };
    }
  }
}

const isCommandNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 1;
