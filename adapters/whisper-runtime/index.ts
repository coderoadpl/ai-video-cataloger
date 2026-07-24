import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type {
  ConfigStore,
  WhisperRuntimeInstallProgress,
  WhisperRuntimePort,
  WhisperRuntimeStatus,
} from '@core/server/index.js';

export const WHISPER_CPP_PINNED_VERSION = 'v1.9.1';
export const WHISPER_CPP_BOTTLE_VERSION = '1.9.1';
export const WHISPER_CPP_BOTTLE_SHA256 = 'b2493bd1d16cf35939665fbc5505a02b28c0ba5281bbdf42c3b663549a18c327';
export const WHISPER_CPP_BOTTLE_MANIFEST_SHA256 = 'e10d60944bd55b3faf7a36b50909ea540022fbb78bae7568876b7be949863722';
export const GGML_BOTTLE_VERSION = '0.15.1';
export const GGML_BOTTLE_SHA256 = '48ba433a400f57e6910f1954755c811844a6bdcdbd1c203317713e1dce7d7165';
export const GGML_BOTTLE_MANIFEST_SHA256 = '5d17a07959d0c75094f75f2c64cc9e6c108f8cb1a66b17ad021fb40f1d8cc0cf';
export const LIBOMP_BOTTLE_VERSION = '22.1.8';
export const LIBOMP_BOTTLE_SHA256 = 'd900ec3deabc609d692d6c061dba84f9a58183c977653f559a4ddc6f0ea845af';
export const LIBOMP_BOTTLE_MANIFEST_SHA256 = 'f4800fbda034afbdb8bbfd431f475e77c84deb695c0424ad11de8d9c5588c5f8';
export const WHISPER_CPP_SOURCE_URL =
  `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_PINNED_VERSION}.tar.gz`;
export const WHISPER_CPP_SOURCE_SHA256 = '147267177eef7b22ec3d2476dd514d1b12e160e176230b740e3d1bd600118447';
export const GHCR_REGISTRY_URL = 'https://ghcr.io';

export const SLOW_CPU_WHISPER_WARNING =
  'Transcription is falling back to the OpenAI "whisper" CLI, which runs on CPU and is far slower than whisper.cpp. Install the managed runtime with: ai-video-cataloger models whisper-runtime install';

export const MANAGED_WHISPER_INCOMPLETE_MESSAGE =
  'The managed whisper.cpp runtime is present but incomplete (the whisper-cli binary is missing or empty). Reinstall it with: ai-video-cataloger models whisper-runtime install';

const tokenResponseSchema = z.object({
  token: z.string().min(1),
});

const manifestIndexSchema = z.object({
  schemaVersion: z.literal(2),
  manifests: z.array(z.object({
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    annotations: z.record(z.string(), z.string()).optional(),
  })),
});

export interface WhisperBottleFile {
  sourcePath: string;
  destinationName: string;
}

export interface WhisperBottleSpec {
  repository: string;
  version: string;
  sha256: string;
  manifestSha256: string;
  files: readonly WhisperBottleFile[];
}

export const WHISPER_BOTTLE_SPECS: readonly WhisperBottleSpec[] = [
  {
    repository: 'homebrew/core/whisper-cpp',
    version: WHISPER_CPP_BOTTLE_VERSION,
    sha256: WHISPER_CPP_BOTTLE_SHA256,
    manifestSha256: WHISPER_CPP_BOTTLE_MANIFEST_SHA256,
    files: [
      { sourcePath: 'whisper-cpp/1.9.1/bin/whisper-cli', destinationName: 'whisper-cli' },
      { sourcePath: 'whisper-cpp/1.9.1/lib/libwhisper.1.dylib', destinationName: 'libwhisper.1.dylib' },
    ],
  },
  {
    repository: 'homebrew/core/ggml',
    version: GGML_BOTTLE_VERSION,
    sha256: GGML_BOTTLE_SHA256,
    manifestSha256: GGML_BOTTLE_MANIFEST_SHA256,
    files: [
      { sourcePath: 'ggml/0.15.1/lib/libggml.0.dylib', destinationName: 'libggml.0.dylib' },
      { sourcePath: 'ggml/0.15.1/lib/libggml-base.0.dylib', destinationName: 'libggml-base.0.dylib' },
      { sourcePath: 'ggml/0.15.1/libexec/libggml-blas.so', destinationName: 'libggml-blas.so' },
      { sourcePath: 'ggml/0.15.1/libexec/libggml-cpu-apple_m1.so', destinationName: 'libggml-cpu-apple_m1.so' },
      { sourcePath: 'ggml/0.15.1/libexec/libggml-cpu-apple_m2_m3.so', destinationName: 'libggml-cpu-apple_m2_m3.so' },
      { sourcePath: 'ggml/0.15.1/libexec/libggml-cpu-apple_m4.so', destinationName: 'libggml-cpu-apple_m4.so' },
      { sourcePath: 'ggml/0.15.1/libexec/libggml-metal.so', destinationName: 'libggml-metal.so' },
    ],
  },
  {
    repository: 'homebrew/core/libomp',
    version: LIBOMP_BOTTLE_VERSION,
    sha256: LIBOMP_BOTTLE_SHA256,
    manifestSha256: LIBOMP_BOTTLE_MANIFEST_SHA256,
    files: [
      { sourcePath: 'libomp/22.1.8/lib/libomp.dylib', destinationName: 'libomp.dylib' },
    ],
  },
] as const;

interface InstallNamePatch {
  fileName: string;
  args: readonly string[];
}

export const whisperInstallNamePatches = (): readonly InstallNamePatch[] => [
  { fileName: 'whisper-cli', args: ['-change', '@rpath/libwhisper.1.dylib', '@loader_path/libwhisper.1.dylib'] },
  { fileName: 'whisper-cli', args: ['-change', '@@HOMEBREW_PREFIX@@/opt/ggml/lib/libggml.0.dylib', '@loader_path/libggml.0.dylib'] },
  { fileName: 'whisper-cli', args: ['-change', '@@HOMEBREW_PREFIX@@/opt/ggml/lib/libggml-base.0.dylib', '@loader_path/libggml-base.0.dylib'] },
  { fileName: 'libwhisper.1.dylib', args: ['-id', '@loader_path/libwhisper.1.dylib'] },
  { fileName: 'libwhisper.1.dylib', args: ['-change', '@@HOMEBREW_PREFIX@@/opt/ggml/lib/libggml.0.dylib', '@loader_path/libggml.0.dylib'] },
  { fileName: 'libwhisper.1.dylib', args: ['-change', '@@HOMEBREW_PREFIX@@/opt/ggml/lib/libggml-base.0.dylib', '@loader_path/libggml-base.0.dylib'] },
  { fileName: 'libggml.0.dylib', args: ['-id', '@loader_path/libggml.0.dylib'] },
  { fileName: 'libggml.0.dylib', args: ['-change', '@rpath/libggml-base.0.dylib', '@loader_path/libggml-base.0.dylib'] },
  { fileName: 'libggml-base.0.dylib', args: ['-id', '@loader_path/libggml-base.0.dylib'] },
  { fileName: 'libggml-base.0.dylib', args: ['-change', '@@HOMEBREW_PREFIX@@/opt/libomp/lib/libomp.dylib', '@loader_path/libomp.dylib'] },
  { fileName: 'libomp.dylib', args: ['-id', '@loader_path/libomp.dylib'] },
  ...['libggml-blas.so', 'libggml-cpu-apple_m1.so', 'libggml-cpu-apple_m2_m3.so', 'libggml-cpu-apple_m4.so', 'libggml-metal.so']
    .map((fileName) => ({ fileName, args: ['-change', '@rpath/libggml-base.0.dylib', '@loader_path/libggml-base.0.dylib'] })),
  ...['libggml-cpu-apple_m1.so', 'libggml-cpu-apple_m2_m3.so', 'libggml-cpu-apple_m4.so']
    .map((fileName) => ({ fileName, args: ['-change', '@@HOMEBREW_PREFIX@@/opt/libomp/lib/libomp.dylib', '@loader_path/libomp.dylib'] })),
];

const signedRuntimeFiles = [
  'libomp.dylib',
  'libggml-base.0.dylib',
  'libggml.0.dylib',
  'libwhisper.1.dylib',
  'libggml-blas.so',
  'libggml-cpu-apple_m1.so',
  'libggml-cpu-apple_m2_m3.so',
  'libggml-cpu-apple_m4.so',
  'libggml-metal.so',
  'whisper-cli',
] as const;

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
  registryUrl?: string | undefined;
  sourceUrl?: string | undefined;
  sourceSha256?: string | undefined;
  bottleSpecs?: readonly WhisperBottleSpec[] | undefined;
}

export class ManagedWhisperRuntimeAdapter implements WhisperRuntimePort {
  private readonly config: ConfigStore;
  private readonly homeDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly commandRunner: WhisperRuntimeCommandRunner;
  private readonly registryUrl: string;
  private readonly sourceUrl: string;
  private readonly sourceSha256: string;
  private readonly bottleSpecs: readonly WhisperBottleSpec[];

  constructor(options: ManagedWhisperRuntimeAdapterOptions) {
    this.config = options.config;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.commandRunner = options.commandRunner ?? nodeRuntimeCommandRunner;
    this.registryUrl = trimTrailingSlash(options.registryUrl ?? GHCR_REGISTRY_URL);
    this.sourceUrl = options.sourceUrl ?? WHISPER_CPP_SOURCE_URL;
    this.sourceSha256 = options.sourceSha256 ?? WHISPER_CPP_SOURCE_SHA256;
    this.bottleSpecs = options.bottleSpecs ?? WHISPER_BOTTLE_SPECS;
  }

  async status(input?: { configuredPath?: string | undefined }): Promise<Result<WhisperRuntimeStatus, AppError>> {
    const managedPath = managedWhisperBinaryPath(this.homeDirectory);
    const managedState = await managedRuntimeState(this.homeDirectory);
    const managedInstalled = managedState === 'installed';
    const buildTools = await this.detectBuildTools();
    const storedConfigured = input?.configuredPath === undefined
      ? await this.config.get({ kind: 'home' }, 'whisper_binary_path')
      : ok(input.configuredPath);
    if (!storedConfigured.ok) return storedConfigured;
    const configured = storedConfigured.value ?? '';
    if (configured.length > 0) {
      if (await executableExists(configured)) {
        return ok(await this.availableStatus(configured, 'configured', managedInstalled, buildTools));
      }
      return ok({
        available: false,
        path: configured,
        source: 'configured',
        version: null,
        managedInstalled,
        buildToolsAvailable: buildTools.missing.length === 0,
        missingBuildTools: buildTools.missing,
        message: `Configured Whisper binary is not executable: ${configured}`,
      });
    }
    if (managedInstalled) {
      return ok(await this.availableStatus(managedPath, 'managed', true, buildTools));
    }
    const incompleteMessage = managedState === 'incomplete' ? MANAGED_WHISPER_INCOMPLETE_MESSAGE : undefined;
    return ok(await this.systemStatus(buildTools, incompleteMessage));
  }

  private async systemStatus(
    buildTools: { missing: string[] },
    incompleteMessage: string | undefined,
  ): Promise<WhisperRuntimeStatus> {
    const buildToolsAvailable = buildTools.missing.length === 0;
    const cli = await this.commandRunner.run('whisper-cli', ['--help']);
    if (cli.ok) {
      return {
        available: true,
        path: 'whisper-cli',
        source: 'system',
        version: parseVersion(`${cli.value.stdout}\n${cli.value.stderr}`),
        managedInstalled: false,
        buildToolsAvailable,
        missingBuildTools: buildTools.missing,
        implementation: 'whisper-cli',
        ...(incompleteMessage === undefined ? {} : { warning: incompleteMessage }),
      };
    }
    const python = await this.commandRunner.run('whisper', ['--help']);
    if (python.ok) {
      return {
        available: true,
        path: 'whisper',
        source: 'system',
        version: parseVersion(`${python.value.stdout}\n${python.value.stderr}`),
        managedInstalled: false,
        buildToolsAvailable,
        missingBuildTools: buildTools.missing,
        implementation: 'openai-whisper',
        warning: incompleteMessage === undefined
          ? SLOW_CPU_WHISPER_WARNING
          : `${incompleteMessage} ${SLOW_CPU_WHISPER_WARNING}`,
      };
    }
    return {
      available: false,
      path: null,
      source: null,
      version: null,
      managedInstalled: false,
      buildToolsAvailable,
      missingBuildTools: buildTools.missing,
      ...(incompleteMessage === undefined ? {} : { message: incompleteMessage }),
    };
  }

  async install(options?: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined;
  }): Promise<Result<{ path: string; version: string; installed: boolean }, AppError>> {
    const binaryPath = managedWhisperBinaryPath(this.homeDirectory);
    if (await nonEmptyExecutable(binaryPath)) {
      return ok({ path: binaryPath, version: WHISPER_CPP_PINNED_VERSION, installed: false });
    }
    const bottle = await this.installBottle(options);
    if (bottle.ok) return bottle;
    const buildTools = await this.detectBuildTools(options?.signal);
    if (buildTools.missing.length > 0) return bottle;
    const fallbackProgress = await reportProgress(options?.onProgress, 'source_fallback', 75);
    if (!fallbackProgress.ok) return fallbackProgress;
    return this.installFromSource(options);
  }

  private async installBottle(options?: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined;
  }): Promise<Result<{ path: string; version: string; installed: boolean }, AppError>> {
    const stagingDirectory = whisperRuntimeStagingDirectory(this.homeDirectory);
    try {
      await rm(stagingDirectory, { recursive: true, force: true });
      await mkdir(stagingDirectory, { recursive: true });
      for (const [index, spec] of this.bottleSpecs.entries()) {
        const basePercentage = 5 + index * 20;
        const authenticated = await reportProgress(options?.onProgress, 'authenticating', basePercentage, spec.repository);
        if (!authenticated.ok) return authenticated;
        const token = await this.fetchToken(spec, options?.signal);
        if (!token.ok) return token;
        const manifested = await this.verifyManifest(spec, token.value, options?.signal);
        if (!manifested.ok) return manifested;
        const downloaded = await reportProgress(options?.onProgress, 'downloading', basePercentage + 7, spec.repository);
        if (!downloaded.ok) return downloaded;
        const archivePath = path.join(stagingDirectory, `${spec.repository.split('/').at(-1) ?? 'bottle'}.download.tmp`);
        const blob = await this.downloadBlob(spec, token.value, archivePath, options?.signal);
        if (!blob.ok) return blob;
        const extractedDirectory = path.join(stagingDirectory, `extracted-${String(index)}`);
        await mkdir(extractedDirectory, { recursive: true });
        const extracted = await this.commandRunner.run('tar', ['-xzf', archivePath, '-C', extractedDirectory], signalOption(options?.signal));
        if (!extracted.ok) return installFailure(`Failed to extract ${spec.repository} bottle`, extracted.error);
        for (const file of spec.files) {
          await copyFile(path.join(extractedDirectory, file.sourcePath), path.join(stagingDirectory, file.destinationName));
        }
        await rm(archivePath, { force: true });
        await rm(extractedDirectory, { recursive: true, force: true });
      }
      const patching = await reportProgress(options?.onProgress, 'patching', 68);
      if (!patching.ok) return patching;
      const patched = await this.patchAndSign(stagingDirectory, options?.signal);
      if (!patched.ok) return patched;
      return await this.publishRuntime(stagingDirectory);
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, 'Failed to install whisper.cpp bottle'), cause) };
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  private async fetchToken(spec: WhisperBottleSpec, signal?: AbortSignal): Promise<Result<string, AppError>> {
    const tokenUrl = new URL('/token', this.registryUrl);
    tokenUrl.searchParams.set('service', 'ghcr.io');
    tokenUrl.searchParams.set('scope', `repository:${spec.repository}:pull`);
    try {
      const response = await this.fetchImpl(tokenUrl, signalInit(signal));
      if (!response.ok) return downloadHttpError('GHCR token', response.status);
      const body: unknown = await response.json();
      const parsed = tokenResponseSchema.safeParse(body);
      if (!parsed.success) return invalidNetworkResponse('GHCR token');
      return ok(parsed.data.token);
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, 'Failed to fetch GHCR token'), cause) };
    }
  }

  private async verifyManifest(spec: WhisperBottleSpec, token: string, signal?: AbortSignal): Promise<Result<void, AppError>> {
    try {
      const response = await this.fetchImpl(`${this.registryUrl}/v2/${spec.repository}/manifests/${spec.version}`, {
        headers: {
          accept: 'application/vnd.oci.image.index.v1+json',
          authorization: `Bearer ${token}`,
        },
        ...signalInit(signal),
      });
      if (!response.ok) return downloadHttpError(`${spec.repository} manifest`, response.status);
      const body: unknown = await response.json();
      const parsed = manifestIndexSchema.safeParse(body);
      if (!parsed.success) return invalidNetworkResponse(`${spec.repository} manifest`);
      const expectedReference = `${spec.version}.arm64_sequoia`;
      const matching = parsed.data.manifests.some((manifest) =>
        manifest.digest === `sha256:${spec.manifestSha256}`
        && manifest.annotations?.['org.opencontainers.image.ref.name'] === expectedReference
        && manifest.annotations['sh.brew.bottle.digest'] === spec.sha256);
      return matching
        ? ok(undefined)
        : { ok: false, error: appError('download_error', `${spec.repository} manifest did not contain the pinned arm64 Sequoia bottle`) };
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, `Failed to fetch ${spec.repository} manifest`), cause) };
    }
  }

  private async downloadBlob(
    spec: WhisperBottleSpec,
    token: string,
    archivePath: string,
    signal?: AbortSignal,
  ): Promise<Result<void, AppError>> {
    try {
      const response = await this.fetchImpl(`${this.registryUrl}/v2/${spec.repository}/blobs/sha256:${spec.sha256}`, {
        headers: { authorization: `Bearer ${token}` },
        ...signalInit(signal),
      });
      if (!response.ok) return downloadHttpError(`${spec.repository} bottle`, response.status);
      const archive = Buffer.from(await response.arrayBuffer());
      await writeFile(archivePath, archive);
      const actualSha256 = createHash('sha256').update(archive).digest('hex');
      if (actualSha256 !== spec.sha256) {
        return {
          ok: false,
          error: appError('download_error', `${spec.repository} bottle failed checksum verification`, {
            expectedSha256: spec.sha256,
            actualSha256,
          }),
        };
      }
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, `Failed to download ${spec.repository} bottle`), cause) };
    }
  }

  private async patchAndSign(runtimeDirectory: string, signal?: AbortSignal): Promise<Result<void, AppError>> {
    for (const patch of whisperInstallNamePatches()) {
      const result = await this.commandRunner.run(
        'install_name_tool',
        [...patch.args, path.join(runtimeDirectory, patch.fileName)],
        signalOption(signal),
      );
      if (!result.ok) return installFailure(`Failed to patch ${patch.fileName}`, result.error);
    }
    for (const fileName of signedRuntimeFiles) {
      const result = await this.commandRunner.run(
        'codesign',
        ['--force', '--sign', '-', path.join(runtimeDirectory, fileName)],
        signalOption(signal),
      );
      if (!result.ok) return installFailure(`Failed to sign ${fileName}`, result.error);
    }
    await chmod(path.join(runtimeDirectory, 'whisper-cli'), 0o755);
    return ok(undefined);
  }

  private async installFromSource(options?: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined;
  }): Promise<Result<{ path: string; version: string; installed: boolean }, AppError>> {
    const stagingDirectory = whisperRuntimeStagingDirectory(this.homeDirectory);
    const archivePath = path.join(stagingDirectory, 'whisper-source.download.tmp');
    try {
      await rm(stagingDirectory, { recursive: true, force: true });
      await mkdir(stagingDirectory, { recursive: true });
      const response = await this.fetchImpl(this.sourceUrl, { redirect: 'follow', ...signalInit(options?.signal) });
      if (!response.ok) return downloadHttpError('whisper.cpp source', response.status);
      const archive = Buffer.from(await response.arrayBuffer());
      await writeFile(archivePath, archive);
      const actualSha256 = createHash('sha256').update(archive).digest('hex');
      if (actualSha256 !== this.sourceSha256) {
        return {
          ok: false,
          error: appError('download_error', 'whisper.cpp source download failed checksum verification', {
            expectedSha256: this.sourceSha256,
            actualSha256,
          }),
        };
      }
      const extracted = await this.commandRunner.run('tar', ['-xzf', archivePath, '-C', stagingDirectory], signalOption(options?.signal));
      if (!extracted.ok) return installFailure('Failed to extract whisper.cpp source', extracted.error);
      const sourceDirectory = path.join(stagingDirectory, `whisper.cpp-${WHISPER_CPP_PINNED_VERSION.slice(1)}`);
      const built = await this.commandRunner.run('make', ['-j4'], { cwd: sourceDirectory, ...signalOption(options?.signal) });
      if (!built.ok) return installFailure('Failed to build whisper.cpp source', built.error);
      const builtBinary = path.join(sourceDirectory, 'build', 'bin', 'whisper-cli');
      if (!await executableExists(builtBinary)) {
        return { ok: false, error: appError('download_error', 'whisper.cpp build did not produce build/bin/whisper-cli') };
      }
      await copyFile(builtBinary, path.join(stagingDirectory, 'whisper-cli'));
      await chmod(path.join(stagingDirectory, 'whisper-cli'), 0o755);
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(archivePath, { force: true });
      return await this.publishRuntime(stagingDirectory);
    } catch (cause) {
      return { ok: false, error: appError('download_error', errorMessage(cause, 'Failed to build whisper.cpp runtime fallback'), cause) };
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  private async publishRuntime(stagingDirectory: string): Promise<Result<{
    path: string;
    version: string;
    installed: boolean;
  }, AppError>> {
    const binaryPath = managedWhisperBinaryPath(this.homeDirectory);
    const runtimeDirectory = whisperRuntimeDirectory(this.homeDirectory);
    const wrapperTempPath = `${binaryPath}.install.tmp`;
    try {
      await mkdir(path.dirname(binaryPath), { recursive: true });
      await rm(runtimeDirectory, { recursive: true, force: true });
      await rename(stagingDirectory, runtimeDirectory);
      await writeFile(wrapperTempPath, whisperWrapperScript(), 'utf8');
      await chmod(wrapperTempPath, 0o755);
      await rename(wrapperTempPath, binaryPath);
      return ok({ path: binaryPath, version: WHISPER_CPP_PINNED_VERSION, installed: true });
    } catch (cause) {
      await rm(wrapperTempPath, { force: true });
      return { ok: false, error: appError('download_error', errorMessage(cause, 'Failed to publish whisper.cpp runtime'), cause) };
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
      implementation: 'whisper-cli',
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
  path.join(homeDirectory, '.ai-video-cataloger', 'bin', 'whisper-runtime', WHISPER_CPP_PINNED_VERSION);

export const whisperRuntimeStagingDirectory = (homeDirectory: string): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'bin', 'whisper-runtime', `${WHISPER_CPP_PINNED_VERSION}.install.tmp`);

const whisperWrapperScript = (): string =>
  `#!/bin/sh\nRUNTIME_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/whisper-runtime/${WHISPER_CPP_PINNED_VERSION}" && pwd)"\nGGML_BACKEND_PATH="$RUNTIME_DIR" exec "$RUNTIME_DIR/whisper-cli" "$@"\n`;

const reportProgress = async (
  onProgress: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined,
  phase: WhisperRuntimeInstallProgress['phase'],
  percentage: number,
  artifact?: string,
): Promise<Result<void, AppError>> =>
  onProgress?.({ phase, percentage, ...(artifact === undefined ? {} : { artifact }) }) ?? ok(undefined);

const executableExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const nonEmptyExecutable = async (candidate: string): Promise<boolean> => {
  if (!await executableExists(candidate)) return false;
  try {
    return (await stat(candidate)).size > 0;
  } catch {
    return false;
  }
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

const managedRuntimeState = async (homeDirectory: string): Promise<'installed' | 'incomplete' | 'absent'> => {
  const binaryPath = managedWhisperBinaryPath(homeDirectory);
  if (await nonEmptyExecutable(binaryPath)) return 'installed';
  if (await pathExists(binaryPath) || await pathExists(whisperRuntimeDirectory(homeDirectory))) return 'incomplete';
  return 'absent';
};

const parseVersion = (output: string): string => {
  const version = /(?:whisper(?:\.cpp)?|version)\D*(\d+\.\d+(?:\.\d+)?)/i.exec(output)?.[1];
  return version ?? WHISPER_CPP_PINNED_VERSION;
};

const trimTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const signalOption = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

const signalInit = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

const downloadHttpError = (resource: string, status: number): Result<never, AppError> => ({
  ok: false,
  error: appError('download_error', `Failed to download ${resource} (HTTP ${String(status)})`),
});

const invalidNetworkResponse = (resource: string): Result<never, AppError> => ({
  ok: false,
  error: appError('download_error', `${resource} returned invalid JSON`),
});

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
