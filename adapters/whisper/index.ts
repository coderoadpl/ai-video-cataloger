import OpenAI from 'openai';
import type { TranscriptionCreateParamsNonStreaming } from 'openai/resources/audio/transcriptions.js';
import { execFile } from 'node:child_process';
import { accessSync, createReadStream, createWriteStream, type ReadStream, type WriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import {
  apiProviderIdForBaseUrl,
  appError,
  ok,
  type AppError,
  type FileArtifact,
  type FileArtifactId,
  type Result,
  type WhisperModelName,
} from '@core/domain/index.js';
import {
  filterTranscript,
  parseRichSegments,
  type FilteredTranscript,
  type DependencyStatus,
  type CredentialsStore,
  type FileArtifactDownloadProgress,
  type ModelDownloadPort,
  type TranscriptionOutput,
  type TranscribeInput,
  type TranscriberPort,
  type WhisperDownloadProgress,
  type WhisperRuntimePort,
  type WhisperRuntimeStatus,
} from '@core/server/index.js';

const whisperApiTranscriptionSchema = z.object({
  text: z.string(),
  segments: z.array(z.unknown()).optional(),
}).passthrough();

const openAiErrorSchema = z.object({
  status: z.number().optional(),
  message: z.string().optional(),
});

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: { signal?: AbortSignal | undefined }): Promise<Result<{ stdout: string; stderr: string }, AppError>>;
}

export interface WhisperBinaryResolver {
  bundledWhisperPath(): string | null;
}

export interface ResolvedWhisperBinary {
  path: string;
  source: 'bundled' | 'configured' | 'managed' | 'system' | null;
  available: boolean;
}

export interface WhisperApiClient {
  createTranscription(
    input: {
      file: ReadStream;
      model: string;
      language?: string;
      response_format?: 'verbose_json';
      timestamp_granularities?: ['segment'];
    },
    options?: { signal?: AbortSignal | undefined },
  ): Promise<unknown>;
}

export interface OpenAiWhisperClientOptions {
  apiKey: string;
  baseURL?: string | undefined;
}

export interface WhisperTranscriberOptions {
  homeDirectory?: string | undefined;
  apiKey?: string | undefined;
  commandRunner?: CommandRunner | undefined;
  binaryResolver?: WhisperBinaryResolver | undefined;
  runtime?: WhisperRuntimePort | undefined;
  apiClient?: WhisperApiClient | undefined;
  credentials?: CredentialsStore | undefined;
}

export interface WhisperModelDownloaderOptions {
  homeDirectory?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  nowMs?: (() => number) | undefined;
  onProgress?: ((progress: WhisperDownloadProgress) => void) | undefined;
  urlForModel?: ((model: WhisperModelName) => string) | undefined;
  warn?: ((message: string) => void) | undefined;
}

export class WhisperTranscriberAdapter implements TranscriberPort {
  private readonly homeDirectory: string;
  private readonly apiKey: string | undefined;
  private readonly commandRunner: CommandRunner;
  private readonly binaryResolver: WhisperBinaryResolver;
  private readonly runtime: WhisperRuntimePort | undefined;
  private readonly apiClient: WhisperApiClient | undefined;
  private readonly credentials: CredentialsStore | undefined;

  constructor(options: WhisperTranscriberOptions = {}) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.commandRunner = options.commandRunner ?? childProcessCommandRunner;
    this.binaryResolver = options.binaryResolver ?? homeWhisperBinaryResolver(this.homeDirectory);
    this.runtime = options.runtime;
    this.apiClient = options.apiClient;
    this.credentials = options.credentials;
  }

  async transcribe(input: TranscribeInput): Promise<Result<TranscriptionOutput, AppError>> {
    if (input.mode === 'skip') return ok({ transcriptPath: input.transcriptPath, content: '', filteredSegments: 0 });
    if (input.mode === 'api') return this.transcribeWithApi(input);
    return this.transcribeWithLocal(input);
  }

  async dependency(input?: {
    mode: 'local' | 'api' | 'skip';
    model: WhisperModelName;
    apiBaseUrl?: string | undefined;
    apiModel?: string | undefined;
    binaryPath?: string | undefined;
  }): Promise<Result<DependencyStatus, AppError>> {
    if (input?.mode === 'skip') {
      return ok({
        name: 'transcription-skip',
        available: true,
        version: null,
        source: null,
        path: null,
        installHint: '',
      });
    }
    if (input?.mode === 'api') {
      const apiKey = await this.resolveApiKey(input.apiBaseUrl);
      if (!apiKey.ok) return apiKey;
      const available = apiKey.value !== null;
      return ok({
        name: 'openai-whisper-api',
        available,
        version: null,
        source: null,
        path: null,
        installHint: available ? '' : 'Add an OpenAI API credential in Settings or set OPENAI_API_KEY',
      });
    }
    const runtime = await this.localRuntimeDependency(input?.binaryPath);
    if (!runtime.ok || input === undefined || !runtime.value.available) return runtime;
    if (runtime.value.source === 'system') return runtime;
    const modelPath = primaryModelPath(this.homeDirectory, input.model);
    const modelAvailable = await pathExists(modelPath)
      || await pathExists(directModelPath(this.homeDirectory, input.model));
    if (modelAvailable) return runtime;
    return ok({
      name: `whisper-${input.model}`,
      available: false,
      version: null,
      source: null,
      path: modelPath,
      installHint: `Run: ai-video-cataloger models download ${input.model}`,
    });
  }

  private async localRuntimeDependency(binaryPath?: string | undefined): Promise<Result<DependencyStatus, AppError>> {
    if (this.runtime !== undefined) {
      const runtime = await this.runtime.status({ configuredPath: binaryPath });
      if (!runtime.ok) return runtime;
      return ok(runtimeDependency(runtime.value));
    }
    const binary = await resolveWhisperBinary(this.binaryResolver, this.commandRunner);
    if (!binary.available) {
      return ok({
        name: 'whisper',
        available: false,
        version: null,
        source: null,
        path: null,
        installHint: 'Install the managed whisper.cpp runtime or configure whisper_binary_path',
      });
    }
    const help = await this.commandRunner.run(binary.path, ['--help']);
    return ok({
      name: 'whisper',
      available: true,
      version: help.ok ? parseWhisperVersion(`${help.value.stdout}\n${help.value.stderr}`) : null,
      source: binary.source,
      path: binary.path,
      installHint: '',
      engine: usesOpenAiWhisperDialect(binary) ? 'openai-whisper' : 'whisper-cli',
    });
  }

  private async transcribeWithLocal(input: TranscribeInput): Promise<Result<TranscriptionOutput, AppError>> {
    const binary = await this.resolvedBinary(input.binaryPath);
    if (!binary.available) {
      return {
        ok: false,
        error: appError('prerequisites_failed', 'Whisper is not available'),
      };
    }
    let stagingDirectory: string | null = null;
    try {
      await mkdir(path.dirname(input.transcriptPath), { recursive: true });
      stagingDirectory = await mkdtemp(path.join(path.dirname(input.transcriptPath), '.whisper-'));
      const stagedInput: TranscribeInput = {
        ...input,
        transcriptPath: path.join(stagingDirectory, path.basename(input.transcriptPath)),
        ...(input.transcriptJsonPath === undefined
          ? {}
          : { transcriptJsonPath: path.join(stagingDirectory, path.basename(input.transcriptJsonPath)) }),
      };
      const modelPath = await resolveWhisperCppModelPath(this.homeDirectory, input.model);
      const openAiDialect = usesOpenAiWhisperDialect(binary);
      let run = await this.commandRunner.run(
        binary.path,
        openAiDialect
          ? openAiWhisperArgs(stagedInput)
          : whisperCppArgs(modelPath, stagedInput),
        { signal: input.signal },
      );
      if (!run.ok && !openAiDialect && input.signal?.aborted !== true) {
        run = await this.commandRunner.run(
          binary.path,
          [...whisperCppArgs(modelPath, stagedInput), '--no-gpu'],
          { signal: input.signal },
        );
      }
      if (!run.ok) return run;
      if (openAiDialect) {
        await relocateOpenAiWhisperOutput(stagedInput, 'txt', stagedInput.transcriptPath);
        if (stagedInput.transcriptJsonPath !== undefined) {
          await relocateOpenAiWhisperOutput(stagedInput, 'json', stagedInput.transcriptJsonPath);
        }
      }
      const rawText = (await readFile(stagedInput.transcriptPath, 'utf8')).trim();
      const decoded = stagedInput.transcriptJsonPath === undefined
        ? null
        : await readJsonFile(stagedInput.transcriptJsonPath);
      const filtered = filterTranscript(rawText, parseRichSegments(decoded));
      await persistFilteredTranscript(input, filtered);
      return ok({
        transcriptPath: input.transcriptPath,
        content: filtered.text,
        filteredSegments: filtered.filteredSegments,
      });
    } catch (cause) {
      return transcriptionFailure(cause, 'Failed to transcribe audio');
    } finally {
      if (stagingDirectory !== null) await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  private async resolvedBinary(binaryPath?: string | undefined): Promise<ResolvedWhisperBinary> {
    if (this.runtime === undefined) return resolveWhisperBinary(this.binaryResolver, this.commandRunner);
    const runtime = await this.runtime.status({ configuredPath: binaryPath });
    if (!runtime.ok || !runtime.value.available || runtime.value.path === null) {
      return { path: 'whisper', source: null, available: false };
    }
    return { path: runtime.value.path, source: runtime.value.source, available: true };
  }

  private async transcribeWithApi(input: TranscribeInput): Promise<Result<TranscriptionOutput, AppError>> {
    const apiKey = await this.resolveApiKey(input.apiBaseUrl ?? DEFAULT_WHISPER_API_BASE_URL);
    if (!apiKey.ok) return apiKey;
    if (apiKey.value === null) {
      return {
        ok: false,
        error: appError('missing_api_key', 'An OpenAI API credential or OPENAI_API_KEY is required when using OpenAI Whisper API'),
      };
    }
    try {
      await mkdir(path.dirname(input.transcriptPath), { recursive: true });
      const client = this.apiClient ?? createOpenAiWhisperClient(apiKey.value, input.apiBaseUrl ?? DEFAULT_WHISPER_API_BASE_URL);
      const response = await client.createTranscription({
        file: createReadStream(input.audioPath),
        model: input.apiModel ?? DEFAULT_WHISPER_API_MODEL,
        ...(input.language === 'auto' ? {} : { language: input.language }),
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      }, { signal: input.signal });
      const transcription = whisperApiTranscriptionSchema.safeParse(response);
      if (!transcription.success) {
        return {
          ok: false,
          error: appError('processing_error', 'Whisper API returned invalid transcription data', transcription.error),
        };
      }
      const filtered = filterTranscript(transcription.data.text.trim(), parseRichSegments(transcription.data));
      await persistFilteredTranscript(input, filtered);
      return ok({
        transcriptPath: input.transcriptPath,
        content: filtered.text,
        filteredSegments: filtered.filteredSegments,
      });
    } catch (cause) {
      return openAiFailure(cause);
    }
  }

  private async resolveApiKey(baseUrl = DEFAULT_WHISPER_API_BASE_URL): Promise<Result<string | null, AppError>> {
    if (this.apiKey !== undefined && this.apiKey.length > 0) return ok(this.apiKey);
    if (this.credentials === undefined) return ok(null);
    const providerId = apiProviderIdForBaseUrl(baseUrl);
    if (providerId === null) return { ok: false, error: appError('invalid_config_value', `Invalid Whisper API base URL: ${baseUrl}`) };
    const stored = await this.credentials.get(providerId);
    if (!stored.ok) return stored;
    return ok(stored.value === null || stored.value.length === 0 ? null : stored.value);
  }
}

export class HuggingFaceWhisperModelDownloader implements ModelDownloadPort {
  private readonly homeDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly onProgress: ((progress: WhisperDownloadProgress) => void) | undefined;
  private readonly urlForModel: (model: WhisperModelName) => string;
  private readonly warn: (message: string) => void;

  constructor(options: WhisperModelDownloaderOptions = {}) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowMs = options.nowMs ?? Date.now;
    this.onProgress = options.onProgress;
    this.urlForModel = options.urlForModel ?? whisperModelDownloadUrl;
    this.warn = options.warn ?? ((message) => {
      process.stderr.write(`${message}\n`);
    });
  }

  whisperModelPath(model: WhisperModelName): string {
    return primaryModelPath(this.homeDirectory, model);
  }

  async isWhisperModelDownloaded(model: WhisperModelName): Promise<Result<boolean, AppError>> {
    try {
      const exists = await pathExists(this.whisperModelPath(model))
        || await pathExists(directModelPath(this.homeDirectory, model))
        || await pathExists(legacyModelPath(this.homeDirectory, model));
      return ok(exists);
    } catch (cause) {
      return downloadFailure(cause, 'Failed to check model status');
    }
  }

  async downloadWhisperModel(
    model: WhisperModelName,
    options: { force: boolean; onProgress?: (progress: WhisperDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    const modelPath = this.whisperModelPath(model);
    const downloaded = await this.isWhisperModelDownloaded(model);
    if (!downloaded.ok) return downloaded;
    if (downloaded.value && !options.force) {
      return ok({ model, path: modelPath, downloaded: false, skipped: true });
    }

    const tempPath = `${modelPath}.tmp`;
    try {
      await mkdir(path.dirname(modelPath), { recursive: true });
      await rm(tempPath, { force: true });
      const url = this.urlForModel(model);
      const expectedSha256 = await this.expectedSha256(url, options.signal);
      const response = await this.fetchImpl(url, signalInit(options.signal));
      if (!response.ok) {
        return { ok: false, error: appError('download_error', `HTTP error: ${response.status} ${response.statusText}`) };
      }
      const onProgress = options.onProgress ?? this.onProgress;
      const written = await this.streamVerifiedTempFile(model, response, tempPath, expectedSha256, onProgress);
      if (!written.ok) return written;
      await rm(modelPath, { force: true });
      await rename(tempPath, modelPath);
      return ok({ model, path: modelPath, downloaded: true, skipped: false, sizeBytes: written.value.sizeBytes });
    } catch (cause) {
      await rm(tempPath, { force: true });
      return downloadFailure(cause, 'Failed to download model');
    }
  }

  async deleteWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>> {
    if (!options.force) return { ok: false, error: appError('confirmation_required', 'Deletion requires --force flag') };
    const modelPath = this.whisperModelPath(model);
    try {
      if (!await pathExists(modelPath)) {
        return { ok: false, error: appError('model_not_found', `Model not found: ${model}`) };
      }
      await rm(modelPath, { force: true });
      return ok({ model, path: modelPath, deleted: true });
    } catch (cause) {
      return { ok: false, error: appError('delete_error', errorMessage(cause, 'Failed to delete model'), cause) };
    }
  }

  fileArtifactPath(artifact: FileArtifact): string {
    return fileArtifactPath(this.homeDirectory, artifact);
  }

  async isFileArtifactDownloaded(artifact: FileArtifact): Promise<Result<boolean, AppError>> {
    try {
      return ok(await pathExists(this.fileArtifactPath(artifact)));
    } catch (cause) {
      return downloadFailure(cause, 'Failed to check artifact status');
    }
  }

  async downloadFileArtifact(
    artifact: FileArtifact,
    options: { force: boolean; onProgress?: (progress: FileArtifactDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ artifactId: FileArtifactId; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    const artifactPath = this.fileArtifactPath(artifact);
    const downloaded = await this.isFileArtifactDownloaded(artifact);
    if (!downloaded.ok) return downloaded;
    if (downloaded.value && !options.force) {
      return ok({ artifactId: artifact.id, path: artifactPath, downloaded: false, skipped: true });
    }

    const tempPath = `${artifactPath}.tmp`;
    try {
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await rm(tempPath, { force: true });
      const response = await this.fetchImpl(artifact.url, signalInit(options.signal));
      if (!response.ok) {
        return { ok: false, error: appError('download_error', `HTTP error: ${response.status} ${response.statusText}`) };
      }
      const written = await this.streamVerifiedArtifactTempFile(artifact, response, tempPath, options.onProgress);
      if (!written.ok) return written;
      await rm(artifactPath, { force: true });
      await rename(tempPath, artifactPath);
      return ok({ artifactId: artifact.id, path: artifactPath, downloaded: true, skipped: false, sizeBytes: written.value.sizeBytes });
    } catch (cause) {
      await rm(tempPath, { force: true });
      return downloadFailure(cause, 'Failed to download artifact');
    }
  }

  private async expectedSha256(url: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const head = await this.fetchImpl(url, { method: 'HEAD', redirect: 'manual', ...signalInit(signal) });
      return sha256Header(head.headers);
    } catch {
      return null;
    }
  }

  private async streamVerifiedTempFile(
    model: WhisperModelName,
    response: Response,
    tempPath: string,
    expectedSha256: string | null,
    onProgress: ((progress: WhisperDownloadProgress) => void) | undefined,
  ): Promise<Result<{ sizeBytes: number }, AppError>> {
    const body = response.body;
    if (body === null) return { ok: false, error: appError('download_error', 'Download response body is empty') };
    if (expectedSha256 === null) {
      this.warn(`Whisper model ${model} could not be checksum-verified: the download source did not expose a SHA-256 header; proceeding with an unverified download`);
    }

    const totalBytes = contentLength(response.headers);
    const hash = createHash('sha256');
    const fileStream = createWriteStream(tempPath);
    const reader = body.getReader();
    let downloadedBytes = 0;
    let lastBytes = 0;
    let lastProgressAt = this.nowMs();
    const emit = (now: number): void => {
      const elapsed = (now - lastProgressAt) / 1000;
      onProgress?.({
        model,
        downloadedBytes,
        totalBytes,
        percentage: totalBytes === null || totalBytes === 0 ? null : Math.round((downloadedBytes / totalBytes) * 100),
        speed: elapsed > 0 ? (downloadedBytes - lastBytes) / elapsed : null,
      });
      lastBytes = downloadedBytes;
      lastProgressAt = now;
    };

    try {
      while (true) {
        const read = await reader.read();
        if (read.done) break;
        hash.update(read.value);
        downloadedBytes += read.value.length;
        await writeChunk(fileStream, read.value);
        const now = this.nowMs();
        if (now - lastProgressAt >= 500) emit(now);
      }
      await endStream(fileStream);
    } catch (cause) {
      fileStream.destroy();
      await rm(tempPath, { force: true });
      return downloadFailure(cause, 'Failed to download model');
    }

    emit(this.nowMs());
    const actualSha256 = hash.digest('hex');
    if (expectedSha256 !== null && actualSha256 !== expectedSha256) {
      await rm(tempPath, { force: true });
      return {
        ok: false,
        error: appError('download_error', `Downloaded model checksum mismatch for ${model}`, {
          expectedSha256,
          actualSha256,
        }),
      };
    }
    return ok({ sizeBytes: downloadedBytes });
  }

  private async streamVerifiedArtifactTempFile(
    artifact: FileArtifact,
    response: Response,
    tempPath: string,
    onProgress: ((progress: FileArtifactDownloadProgress) => void) | undefined,
  ): Promise<Result<{ sizeBytes: number }, AppError>> {
    const body = response.body;
    if (body === null) return { ok: false, error: appError('download_error', 'Download response body is empty') };
    const totalBytes = contentLength(response.headers);
    const hash = createHash('sha256');
    const fileStream = createWriteStream(tempPath);
    const reader = body.getReader();
    let downloadedBytes = 0;
    let lastBytes = 0;
    let lastProgressAt = this.nowMs();
    const emit = (now: number): void => {
      const elapsed = (now - lastProgressAt) / 1000;
      onProgress?.({
        artifactId: artifact.id,
        downloadedBytes,
        totalBytes,
        percentage: totalBytes === null || totalBytes === 0 ? null : Math.round((downloadedBytes / totalBytes) * 100),
        speed: elapsed > 0 ? (downloadedBytes - lastBytes) / elapsed : null,
      });
      lastBytes = downloadedBytes;
      lastProgressAt = now;
    };

    try {
      while (true) {
        const read = await reader.read();
        if (read.done) break;
        hash.update(read.value);
        downloadedBytes += read.value.length;
        await writeChunk(fileStream, read.value);
        const now = this.nowMs();
        if (now - lastProgressAt >= 500) emit(now);
      }
      await endStream(fileStream);
    } catch (cause) {
      fileStream.destroy();
      await rm(tempPath, { force: true });
      return downloadFailure(cause, 'Failed to download artifact');
    }

    emit(this.nowMs());
    const actualSha256 = hash.digest('hex');
    if (actualSha256 !== artifact.sha256) {
      await rm(tempPath, { force: true });
      return {
        ok: false,
        error: appError('download_error', `Downloaded artifact checksum mismatch for ${artifact.id}`, {
          expectedSha256: artifact.sha256,
          actualSha256,
        }),
      };
    }
    if (artifact.bytes !== null && downloadedBytes !== artifact.bytes) {
      await rm(tempPath, { force: true });
      return {
        ok: false,
        error: appError('download_error', `Downloaded artifact size mismatch for ${artifact.id}`, {
          expectedBytes: artifact.bytes,
          actualBytes: downloadedBytes,
        }),
      };
    }
    return ok({ sizeBytes: downloadedBytes });
  }
}

export const resolveWhisperBinary = async (
  resolver: WhisperBinaryResolver = homeWhisperBinaryResolver(homedir()),
  runner: CommandRunner = childProcessCommandRunner,
): Promise<ResolvedWhisperBinary> => {
  const bundled = resolver.bundledWhisperPath();
  if (bundled !== null) return { path: bundled, source: 'bundled', available: true };
  const cli = await runner.run('whisper-cli', ['--help']);
  if (cli.ok) return { path: 'whisper-cli', source: 'system', available: true };
  const system = await runner.run('whisper', ['--help']);
  if (system.ok) return { path: 'whisper', source: 'system', available: true };
  return { path: 'whisper', source: null, available: false };
};

const usesOpenAiWhisperDialect = (binary: ResolvedWhisperBinary): boolean =>
  binary.source === 'system' && path.basename(binary.path) === 'whisper';

export const whisperModelDownloadUrl = (model: WhisperModelName): string =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

export const primaryModelPath = (homeDirectory: string, model: WhisperModelName): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'models', 'whisper', `ggml-${model}.bin`);

export const directModelPath = (homeDirectory: string, model: WhisperModelName): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'models', 'whisper', `${model}.bin`);

export const legacyModelPath = (homeDirectory: string, model: WhisperModelName): string =>
  path.join(homeDirectory, '.cache', 'whisper', `${model}.pt`);

export const fileArtifactPath = (homeDirectory: string, artifact: FileArtifact): string =>
  path.join(homeDirectory, '.ai-video-cataloger', 'models', ...artifact.id.split('/'), artifact.filename);

const homeWhisperBinaryResolver = (homeDirectory: string): WhisperBinaryResolver => ({
  bundledWhisperPath: () => {
    const bundled = path.join(homeDirectory, '.ai-video-cataloger', 'bin', 'whisper');
    return pathExistsSync(bundled) ? bundled : null;
  },
});

const resolveWhisperCppModelPath = async (homeDirectory: string, model: WhisperModelName): Promise<string> => {
  const primary = primaryModelPath(homeDirectory, model);
  if (await pathExists(primary)) return primary;
  const direct = directModelPath(homeDirectory, model);
  return await pathExists(direct) ? direct : primary;
};

const whisperCppArgs = (modelPath: string, input: TranscribeInput): readonly string[] => {
  const outputPrefix = input.transcriptPath.slice(0, -path.extname(input.transcriptPath).length);
  return [
    '-m',
    modelPath,
    '-f',
    input.audioPath,
    '-l',
    input.language,
    '-otxt',
    ...(input.transcriptJsonPath === undefined ? [] : ['-oj']),
    '-of',
    outputPrefix,
    '--no-prints',
  ];
};

const openAiWhisperArgs = (input: TranscribeInput): readonly string[] => [
  input.audioPath,
  '--model',
  input.model,
  ...(input.language === 'auto' ? [] : ['--language', input.language]),
  '--output_dir',
  path.dirname(input.transcriptPath),
  '--output_format',
  input.transcriptJsonPath === undefined ? 'txt' : 'all',
];

const relocateOpenAiWhisperOutput = async (
  input: TranscribeInput,
  extension: 'txt' | 'json',
  targetPath: string,
): Promise<void> => {
  const producedPath = path.join(
    path.dirname(input.transcriptPath),
    `${path.basename(input.audioPath, path.extname(input.audioPath))}.${extension}`,
  );
  if (producedPath !== targetPath) await rename(producedPath, targetPath);
};

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const content = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const persistFilteredTranscript = async (
  input: TranscribeInput,
  filtered: FilteredTranscript,
): Promise<void> => {
  await writeFile(input.transcriptPath, filtered.text, 'utf8');
  if (input.transcriptJsonPath === undefined) return;
  await mkdir(path.dirname(input.transcriptJsonPath), { recursive: true });
  await writeFile(input.transcriptJsonPath, JSON.stringify({
    text: filtered.text,
    segments: filtered.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      no_speech_prob: segment.noSpeechProb,
      avg_logprob: segment.avgLogprob,
    })),
  }, null, 2), 'utf8');
};

const childProcessCommandRunner: CommandRunner = {
  run: (command, args, options) =>
    new Promise((resolve) => {
      const child = execFile(command, [...args], (error, stdout, stderr) => {
        options?.signal?.removeEventListener('abort', abort);
        if (error !== null) {
          resolve({ ok: false, error: appError('processing_error', error.message, error) });
          return;
        }
        resolve(ok({ stdout: String(stdout), stderr: String(stderr) }));
      });
      const abort = (): void => {
        child.kill('SIGTERM');
      };
      if (options?.signal?.aborted === true) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
    }),
};

const DEFAULT_WHISPER_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_WHISPER_API_MODEL = 'whisper-1';

export const openAiWhisperClientOptions = (apiKey: string, baseURL: string): OpenAiWhisperClientOptions => ({
  apiKey,
  ...(baseURL === DEFAULT_WHISPER_API_BASE_URL ? {} : { baseURL }),
});

export const createOpenAiWhisperClient = (apiKey: string, baseURL: string): WhisperApiClient => {
  const client = new OpenAI(openAiWhisperClientOptions(apiKey, baseURL));
  return {
    createTranscription: (input, options) => client.audio.transcriptions.create({
      ...input,
      stream: false,
    } satisfies TranscriptionCreateParamsNonStreaming<'verbose_json' | undefined>, options),
  };
};

const parseWhisperVersion = (output: string): string | null => {
  const match = /whisper[.\s]*([\d.]+)/i.exec(output);
  return match?.[1] ?? 'installed';
};

const runtimeDependency = (runtime: WhisperRuntimeStatus): DependencyStatus => ({
  name: 'whisper',
  available: runtime.available,
  version: runtime.version,
  source: runtime.source,
  path: runtime.path,
  installHint: runtime.available
    ? ''
    : runtime.message !== undefined
      ? runtime.message
    : runtime.buildToolsAvailable
      ? 'Install the managed whisper.cpp runtime or configure whisper_binary_path'
      : `Managed whisper.cpp requires ${runtime.missingBuildTools.join(' and ')}`,
  ...(runtime.warning === undefined ? {} : { warning: runtime.warning }),
  ...(runtime.engine === undefined ? {} : { engine: runtime.engine }),
});

const openAiFailure = (cause: unknown): Result<never, AppError> => {
  const parsed = openAiErrorSchema.safeParse(cause);
  const status = parsed.success ? parsed.data.status : undefined;
  if (status === 401) {
    return {
      ok: false,
      error: appError('missing_api_key', 'Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.', cause),
    };
  }
  if (status === 429) {
    return { ok: false, error: appError('processing_error', 'OpenAI API rate limit exceeded. Please try again later.', cause) };
  }
  if (status === 413) {
    return { ok: false, error: appError('processing_error', 'Audio file too large for OpenAI API. Maximum file size is 25MB.', cause) };
  }
  return transcriptionFailure(cause, 'OpenAI API transcription failed');
};

const transcriptionFailure = (cause: unknown, fallbackMessage: string): Result<never, AppError> => ({
  ok: false,
  error: appError('processing_error', errorMessage(cause, fallbackMessage), cause),
});

const downloadFailure = (cause: unknown, fallbackMessage: string): Result<never, AppError> => ({
  ok: false,
  error: appError('download_error', errorMessage(cause, fallbackMessage), cause),
});

const errorMessage = (cause: unknown, fallbackMessage: string): string =>
  cause instanceof Error ? cause.message : fallbackMessage;

const writeChunk = (stream: WriteStream, chunk: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error === null || error === undefined) resolve();
      else reject(error);
    });
  });

const endStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.end(() => {
      resolve();
    });
  });

const pathExists = async (value: string): Promise<boolean> => {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
};

const pathExistsSync = (value: string): boolean => {
  try {
    accessSync(value);
    return true;
  } catch {
    return false;
  }
};

const sha256Header = (headers: Headers): string | null => {
  const linked = normalizeSha256(headers.get('x-linked-etag'));
  if (linked !== null) return linked;
  return normalizeSha256(headers.get('etag'));
};

const normalizeSha256 = (value: string | null): string | null => {
  if (value === null) return null;
  const normalized = value.replaceAll('"', '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
};

const contentLength = (headers: Headers): number | null => {
  const raw = headers.get('content-length') ?? headers.get('x-linked-size');
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const signalInit = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };
