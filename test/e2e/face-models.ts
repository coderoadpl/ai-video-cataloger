import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { fileArtifactPath, HuggingFaceWhisperModelDownloader } from '../../adapters/whisper/index.js';
import { scratchDirectory } from './helpers.js';
import {
  appError,
  FILE_ARTIFACTS,
  FILE_ARTIFACT_IDS,
  ok,
  type AppError,
  type FileArtifact,
  type Result,
} from '../../core/domain/index.js';
import type { ModelDownloadPort } from '../../core/server/index.js';

export type FaceModelDownloader = Pick<ModelDownloadPort, 'downloadFileArtifact' | 'fileArtifactPath'>;

export interface FaceModelsFs {
  copyFile(source: string, target: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  stat(path: string): Promise<{ size: number }>;
}

export interface EnsureE2eFaceModelsInput {
  homeDirectory: string;
  cacheDirectory?: string | undefined;
  environment?: NodeJS.ProcessEnv | undefined;
  artifacts?: readonly FileArtifact[] | undefined;
}

export interface EnsureE2eFaceModelsDeps {
  fs?: FaceModelsFs | undefined;
  downloader?: FaceModelDownloader | undefined;
}

export interface EnsureE2eFaceModelsOutput {
  cacheDirectory: string;
  copied: number;
  downloadAttempts: number;
}

const nodeFaceModelsFs: FaceModelsFs = { copyFile, mkdir, readFile, stat };

const scratchEnvironmentSchema = z.record(z.string(), z.string().optional());

const fileArtifactSchema = z.object({
  id: z.enum(FILE_ARTIFACT_IDS),
  filename: z.string().min(1),
  bytes: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.string().url(),
  license: z.string().min(1),
});

const inputSchema = z.object({
  homeDirectory: z.string().min(1),
  cacheDirectory: z.string().min(1).optional(),
  environment: scratchEnvironmentSchema.optional(),
  artifacts: z.array(fileArtifactSchema).optional(),
});

const nodeErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

export const e2eFaceModelsCacheDirectory = (environment: NodeJS.ProcessEnv = process.env): Result<string, AppError> => {
  const parsed = scratchEnvironmentSchema.safeParse({ ...environment });
  if (!parsed.success) {
    return { ok: false, error: appError('validation', 'Invalid e2e face model scratch environment', parsed.error.flatten()) };
  }
  return ok(join(scratchDirectory(parsed.data), 'face-models'));
};

export const ensureE2eFaceModels = async (
  input: EnsureE2eFaceModelsInput,
  deps: EnsureE2eFaceModelsDeps = {},
): Promise<Result<EnsureE2eFaceModelsOutput, AppError>> => {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('validation', 'Invalid e2e face model helper input', parsed.error.flatten()) };
  }
  const cacheDirectory = parsed.data.cacheDirectory === undefined
    ? e2eFaceModelsCacheDirectory(parsed.data.environment)
    : ok(parsed.data.cacheDirectory);
  if (!cacheDirectory.ok) return cacheDirectory;

  const fs = deps.fs ?? nodeFaceModelsFs;
  const downloader = deps.downloader ?? new HuggingFaceWhisperModelDownloader({ homeDirectory: cacheDirectory.value });
  const artifacts = parsed.data.artifacts ?? Object.values(FILE_ARTIFACTS);
  let downloadAttempts = 0;

  for (const artifact of artifacts) {
    const cachePath = downloader.fileArtifactPath(artifact);
    const cached = await validCachedArtifact(fs, artifact, cachePath);
    if (!cached.ok) return cached;
    if (cached.value) continue;

    downloadAttempts += 1;
    const downloaded = await downloader.downloadFileArtifact(artifact, { force: true });
    if (!downloaded.ok) return failedDownload(cacheDirectory.value, artifact, downloaded.error);

    const verified = await validCachedArtifact(fs, artifact, cachePath);
    if (!verified.ok) return verified;
    if (!verified.value) return invalidDownload(cacheDirectory.value, artifact);
  }

  for (const artifact of artifacts) {
    const source = downloader.fileArtifactPath(artifact);
    const target = fileArtifactPath(parsed.data.homeDirectory, artifact);
    try {
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    } catch (cause) {
      return {
        ok: false,
        error: appError('read_error', `Failed to copy e2e face model artifact ${artifact.id} into the isolated test home`, errorDetails(cause)),
      };
    }
  }

  return ok({ cacheDirectory: cacheDirectory.value, copied: artifacts.length, downloadAttempts });
};

const validCachedArtifact = async (
  fs: FaceModelsFs,
  artifact: FileArtifact,
  cachePath: string,
): Promise<Result<boolean, AppError>> => {
  let size: number;
  try {
    size = (await fs.stat(cachePath)).size;
  } catch (cause) {
    const details = errorDetails(cause);
    if (details.code === 'ENOENT') return ok(false);
    return {
      ok: false,
      error: appError('read_error', `Failed to inspect cached e2e face model artifact ${artifact.id}`, details),
    };
  }

  if (artifact.bytes !== null && size !== artifact.bytes) return ok(false);

  try {
    const sha256 = createHash('sha256').update(await fs.readFile(cachePath)).digest('hex');
    return ok(sha256 === artifact.sha256);
  } catch (cause) {
    return {
      ok: false,
      error: appError('read_error', `Failed to verify cached e2e face model artifact ${artifact.id}`, errorDetails(cause)),
    };
  }
};

const failedDownload = (cacheDirectory: string, artifact: FileArtifact, error: AppError): Result<never, AppError> => ({
  ok: false,
  error: appError(
    'download_error',
    `Failed to download e2e face model artifact ${artifact.id} into ${cacheDirectory}: ${error.message}. Pre-populate the cache with: AVC_HOME_DIRECTORY="${cacheDirectory}" ai-video-cataloger models faces install --force`,
    error,
  ),
});

const invalidDownload = (cacheDirectory: string, artifact: FileArtifact): Result<never, AppError> => ({
  ok: false,
  error: appError(
    'download_error',
    `Downloaded e2e face model artifact ${artifact.id} in ${cacheDirectory} did not match the expected size and SHA-256. Pre-populate the cache with: AVC_HOME_DIRECTORY="${cacheDirectory}" ai-video-cataloger models faces install --force`,
  ),
});

const errorDetails = (cause: unknown): { code: string | null; message: string } => {
  const parsed = nodeErrorSchema.safeParse(cause);
  if (!parsed.success) return { code: null, message: String(cause) };
  return { code: parsed.data.code ?? null, message: parsed.data.message ?? String(cause) };
};
