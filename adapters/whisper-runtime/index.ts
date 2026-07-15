import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { ConfigStore, WhisperRuntimePort, WhisperRuntimeStatus } from '@core/server/index.js';

export const WHISPER_CPP_PINNED_VERSION = 'v1.9.1';
export const WHISPER_CPP_SOURCE_URL =
  `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_PINNED_VERSION}.tar.gz`;
export const WHISPER_CPP_SOURCE_SHA256 = '147267177eef7b22ec3d2476dd514d1b12e160e176230b740e3d1bd600118447';

export interface WhisperRuntimeCommandOptions {
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface WhisperRuntimeCommandRunner {
  run(
    command: string,
    args: readonly string[],
    options?: WhisperRuntimeCommandOptions,
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>>;
}

export interface ManagedWhisperRuntimeAdapterOptions {
  config: ConfigStore;
  homeDirectory?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  commandRunner?: WhisperRuntimeCommandRunner | undefined;
  releaseUrl?: string | undefined;
  expectedSha256?: string | undefined;
}

export class ManagedWhisperRuntimeAdapter implements WhisperRuntimePort {
  private readonly config: ConfigStore;
  private readonly homeDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly commandRunner: WhisperRuntimeCommandRunner;
  private readonly releaseUrl: string;
  private readonly expectedSha256: string;

  constructor(options: ManagedWhisperRuntimeAdapterOptions) {
    this.config = options.config;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.commandRunner = options.commandRunner ?? nodeRuntimeCommandRunner;
    this.releaseUrl = options.releaseUrl ?? WHISPER_CPP_SOURCE_URL;
    this.expectedSha256 = options.expectedSha256 ?? WHISPER_CPP_SOURCE_SHA256;
  }

  async status(): Promise<Result<WhisperRuntimeStatus, AppError>> {
    const managedPath = managedWhisperBinaryPath(this.homeDirectory);
    const managedInstalled = await executableExists(managedPath);
    const buildTools = await this.detectBuildTools();
    const configured = await this.config.get({ kind: 'home' }, 'whisper_binary_path');
    if (!configured.ok) return configured;
    if (configured.value !== null && configured.value.length > 0 && await executableExists(configured.value)) {
      return ok(await this.availableStatus(configured.value, 'configured', managedInstalled, buildTools));
    }
    if (managedInstalled) {
      return ok(await this.availableStatus(managedPath, 'managed', true, buildTools));
    }
    const system = await this.commandRunner.run('whisper', ['--help']);
    if (system.ok) {
      return ok({
        available: true,
        path: 'whisper',
        source: 'system',
        version: parseVersion(`${system.value.stdout}\n${system.value.stderr}`),
        managedInstalled: false,
        buildToolsAvailable: buildTools.missing.length === 0,
        missingBuildTools: buildTools.missing,
      });
    }
    return ok({
      available: false,
      path: null,
      source: null,
      version: null,
      managedInstalled: false,
      buildToolsAvailable: buildTools.missing.length === 0,
      missingBuildTools: buildTools.missing,
    });
  }

  async install(options?: { signal?: AbortSignal | undefined }): Promise<Result<{
    path: string;
    version: string;
    installed: boolean;
  }, AppError>> {
    const binaryPath = managedWhisperBinaryPath(this.homeDirectory);
    if (await executableExists(binaryPath)) {
      return ok({ path: binaryPath, version: WHISPER_CPP_PINNED_VERSION, installed: false });
    }
    const buildTools = await this.detectBuildTools(options?.signal);
    if (buildTools.missing.length > 0) {
      return {
        ok: false,
        error: appError(
          'prerequisites_failed',
          `Managed whisper.cpp requires ${buildTools.missing.join(' and ')} to build the official source release`,
          { missingBuildTools: buildTools.missing },
        ),
      };
    }

    const binDirectory = path.dirname(binaryPath);
    const runtimeDirectory = whisperRuntimeDirectory(this.homeDirectory);
    const archivePath = path.join(binDirectory, `whisper-${WHISPER_CPP_PINNED_VERSION}.download.tmp`);
    const installTempPath = `${binaryPath}.install.tmp`;
    try {
      await mkdir(binDirectory, { recursive: true });
      await rm(runtimeDirectory, { recursive: true, force: true });
      await mkdir(runtimeDirectory, { recursive: true });
      await rm(archivePath, { force: true });
      await rm(installTempPath, { force: true });
      const response = await this.fetchImpl(this.releaseUrl, {
        redirect: 'follow',
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      if (!response.ok) {
        return { ok: false, error: appError('download_error', `Failed to download whisper.cpp source (HTTP ${response.status})`) };
      }
      const sourceArchive = Buffer.from(await response.arrayBuffer());
      await writeFile(archivePath, sourceArchive);
      const actualSha256 = createHash('sha256').update(sourceArchive).digest('hex');
      if (actualSha256 !== this.expectedSha256) {
        return {
          ok: false,
          error: appError('download_error', 'whisper.cpp source download failed checksum verification', {
            expectedSha256: this.expectedSha256,
            actualSha256,
          }),
        };
      }
      const extracted = await this.commandRunner.run('tar', ['-xzf', archivePath, '-C', runtimeDirectory], options);
      if (!extracted.ok) return installFailure('Failed to extract whisper.cpp source', extracted.error);
      const sourceDirectory = path.join(runtimeDirectory, `whisper.cpp-${WHISPER_CPP_PINNED_VERSION.slice(1)}`);
      const built = await this.commandRunner.run('make', ['-j4'], { cwd: sourceDirectory, ...signalOption(options?.signal) });
      if (!built.ok) return installFailure('Failed to build whisper.cpp source', built.error);
      const builtBinary = path.join(sourceDirectory, 'build', 'bin', 'whisper-cli');
      if (!await executableExists(builtBinary)) {
        return { ok: false, error: appError('download_error', 'whisper.cpp build did not produce build/bin/whisper-cli') };
      }
      await copyFile(builtBinary, installTempPath);
      await chmod(installTempPath, 0o755);
      await rename(installTempPath, binaryPath);
      return ok({ path: binaryPath, version: WHISPER_CPP_PINNED_VERSION, installed: true });
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, 'Failed to install whisper.cpp runtime'), cause) };
    } finally {
      await rm(archivePath, { force: true });
      await rm(installTempPath, { force: true });
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  }

  private async availableStatus(
    binaryPath: string,
    source: 'configured' | 'managed',
    managedInstalled: boolean,
    buildTools: { missing: string[] },
  ): Promise<WhisperRuntimeStatus> {
    const version = await this.commandRunner.run(binaryPath, ['--help']);
    return {
      available: true,
      path: binaryPath,
      source,
      version: version.ok ? parseVersion(`${version.value.stdout}\n${version.value.stderr}`) : WHISPER_CPP_PINNED_VERSION,
      managedInstalled,
      buildToolsAvailable: buildTools.missing.length === 0,
      missingBuildTools: buildTools.missing,
    };
  }

  private async detectBuildTools(signal?: AbortSignal): Promise<{ missing: string[] }> {
    const [cmake, clang] = await Promise.all([
      this.commandRunner.run('cmake', ['--version'], signalOption(signal)),
      this.commandRunner.run('clang', ['--version'], signalOption(signal)),
    ]);
    return { missing: [...(cmake.ok ? [] : ['CMake']), ...(clang.ok ? [] : ['Clang'])] };
  }
}

export const managedWhisperBinaryPath = (homeDirectory: string): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'bin', 'whisper');

export const whisperRuntimeDirectory = (homeDirectory: string): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'runtime', `whisper-${WHISPER_CPP_PINNED_VERSION}.tmp`);

const executableExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const parseVersion = (output: string): string => {
  const version = /(?:whisper(?:\.cpp)?|version)\D*(\d+\.\d+(?:\.\d+)?)/i.exec(output)?.[1];
  return version ?? WHISPER_CPP_PINNED_VERSION;
};

const signalOption = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

const installFailure = (message: string, cause: AppError): Result<never, AppError> => ({
  ok: false,
  error: appError('download_error', `${message}: ${cause.message}`),
});

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

const nodeRuntimeCommandRunner: WhisperRuntimeCommandRunner = {
  run: (command, args, options) =>
    new Promise((resolve) => {
      execFile(command, [...args], {
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }, (error, stdout, stderr) => {
        if (error !== null) {
          resolve({ ok: false, error: appError('processing_error', error.message) });
          return;
        }
        resolve(ok({ stdout: String(stdout), stderr: String(stderr) }));
      });
    }),
};
