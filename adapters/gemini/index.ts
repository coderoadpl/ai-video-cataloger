import { open, readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

import {
  appError,
  batchSubmitRejection,
  geminiNativeModelPricing,
  geminiPricingModeMultiplier,
  ok,
  GEMINI_NATIVE_API_BASE_URL,
  GEMINI_NATIVE_FILES_API_LIMIT_BYTES,
  GEMINI_NATIVE_INLINE_LIMIT_BYTES,
  type AnalyzerProviderConfig,
  type AppError,
  type GeminiPricingMode,
  type Result,
} from '@core/domain/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerBatchPort,
  AnalyzerBatchRequest,
  AnalyzerBatchStatus,
  AnalyzerBatchSubmission,
  AnalyzerBatchUploadInput,
  AnalyzerPort,
  CredentialsStore,
  DependencyStatus,
  ProvidersPort,
  ProviderTestResult,
} from '@core/server/index.js';

import {
  BATCH_INLINE_REQUEST_LIMIT_BYTES,
  batchJobForDisplayName,
  batchJobMessage,
  batchListNextPageToken,
  batchResults,
  buildBatchSubmitBody,
  inlineRequestTooLargeError,
  parseBatchOperation,
  readBatchJobState,
} from './batch.js';
import { analysisFromGenerateContent } from './response.js';

import {
  descriptionInstruction,
  filenameInstruction,
  outputLanguageInstruction,
  retrievalBriefing,
  tagsInstruction,
} from '@adapters/analyzers/prompt.js';

type GeminiNativeProvider = Extract<AnalyzerProviderConfig, { family: 'gemini-native' }>;

export interface VideoFileHandle {
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  close(): Promise<void>;
}

export interface VideoFileSource {
  size(videoPath: string): Promise<number>;
  readAll(videoPath: string): Promise<Uint8Array>;
  open(videoPath: string): Promise<VideoFileHandle>;
}

export interface GeminiNativeAnalyzerAdapterOptions {
  credentials: CredentialsStore;
  fetchImpl?: typeof fetch | undefined;
  videoFile?: VideoFileSource | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollIntervalMs?: number | undefined;
  maxPollAttempts?: number | undefined;
  uploadChunkBytes?: number | undefined;
  onWarning?: ((message: string) => void) | undefined;
}

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const BATCH_REQUEST_TIMEOUT_MS = 60_000;
const BATCH_LIST_PAGE_LIMIT = 100;
const MISSING_BATCH_JOB = Symbol('missing-batch-job');

const UPLOAD_CHUNK_RETRIES = 3;
const UPLOAD_RETRY_DELAY_MS = 500;

const isRetryableUploadStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

export const nodeVideoFileSource: VideoFileSource = {
  size: async (videoPath) => (await stat(videoPath)).size,
  readAll: (videoPath) => readFile(videoPath),
  open: async (videoPath) => {
    const handle = await open(videoPath, 'r');
    return {
      read: async (offset, length) => {
        const buffer = new Uint8Array(new ArrayBuffer(length));
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  },
};

const fileStateSchema = z.object({
  name: z.string().optional(),
  uri: z.string().optional(),
  state: z.string().optional(),
});

const uploadResponseSchema = z.object({
  file: fileStateSchema.optional(),
});

const INLINE_REQUEST_OVERHEAD_BYTES = 64 * 1024;

// The 20 MB cap applies to the whole JSON request, and inline video travels
// base64-encoded (4/3 expansion), so eligibility is computed on encoded size.
export const shouldUploadInline = (sizeBytes: number): boolean =>
  Math.ceil(sizeBytes / 3) * 4 + INLINE_REQUEST_OVERHEAD_BYTES <= GEMINI_NATIVE_INLINE_LIMIT_BYTES;

export const geminiProviderPricing = (
  provider: GeminiNativeProvider,
  mode: GeminiPricingMode = 'interactive',
): { pricePerMTokensInput?: number | undefined; pricePerMTokensOutput?: number | undefined } => {
  if (provider.pricePerMTokensInput !== undefined && provider.pricePerMTokensOutput !== undefined) {
    const multiplier = geminiPricingModeMultiplier(mode);
    return {
      pricePerMTokensInput: provider.pricePerMTokensInput * multiplier,
      pricePerMTokensOutput: provider.pricePerMTokensOutput * multiplier,
    };
  }
  const fromModel = geminiNativeModelPricing(provider.model, mode);
  return fromModel ?? {};
};

export const buildGeminiPrompt = (input: { videoName: string; outputLanguage: string }): string =>
  `You are analyzing a video file named "${input.videoName}". You can see the video and hear its full audio track: speech, music and ambient sound.

${retrievalBriefing}

Respond in exactly this format:
DESCRIPTION: ${descriptionInstruction} If there is no speech, say so and describe the music or ambient sound instead.
FILENAME: ${filenameInstruction}
TAGS: ${tagsInstruction}
TRANSCRIPT: verbatim speech and on-screen text with timestamps, one segment per line formatted [MM:SS] text. If there is no speech at all, write exactly: NONE${outputLanguageInstruction(input.outputLanguage)}`;

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

export class GeminiNativeAnalyzerAdapter implements AnalyzerPort, AnalyzerBatchPort, ProvidersPort {
  private readonly credentials: CredentialsStore;
  private readonly fetchImpl: typeof fetch;
  private readonly videoFile: VideoFileSource;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly uploadChunkBytes: number;
  private readonly warn: (message: string) => void;

  constructor(options: GeminiNativeAnalyzerAdapterOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.videoFile = options.videoFile ?? nodeVideoFileSource;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPollAttempts = options.maxPollAttempts ?? 60;
    this.uploadChunkBytes = options.uploadChunkBytes ?? UPLOAD_CHUNK_BYTES;
    this.warn = options.onWarning ?? (() => undefined);
  }

  async test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native provider configuration is required') };
    }
    const startedAt = performance.now();
    const credential = await this.credentials.get(config.apiKeyRef);
    if (!credential.ok) return credential;
    if (credential.value === null) {
      return ok({
        family: 'api',
        providerId: config.providerId,
        reachable: false,
        authenticated: false,
        latencyMs: null,
        message: `No API key stored for ${config.providerId}. Save a Gemini API key before testing.`,
      });
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${GEMINI_NATIVE_API_BASE_URL}/v1beta/models/${config.model}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': credential.value },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return ok({
        family: 'api',
        providerId: config.providerId,
        reachable: false,
        authenticated: false,
        latencyMs: Math.round(performance.now() - startedAt),
        message: 'Could not reach the Gemini API',
      });
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    if (response.status === 401 || response.status === 403) {
      return ok({
        family: 'api',
        providerId: config.providerId,
        reachable: true,
        authenticated: false,
        latencyMs,
        message: 'Gemini rejected the stored API key',
      });
    }
    if (response.status === 404) {
      return ok({
        family: 'api',
        providerId: config.providerId,
        reachable: true,
        authenticated: true,
        latencyMs,
        message: `Model "${config.model}" is not available for this key`,
      });
    }
    if (!response.ok) {
      return ok({
        family: 'api',
        providerId: config.providerId,
        reachable: true,
        authenticated: false,
        latencyMs,
        message: `Gemini API returned HTTP ${response.status}`,
      });
    }
    return ok({
      family: 'api',
      providerId: config.providerId,
      reachable: true,
      authenticated: true,
      latencyMs,
      message: `Connected to Gemini (${config.model})`,
    });
  }

  async analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    const provider = input.provider;
    if (provider === undefined || provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const credential = await this.credentials.get(provider.apiKeyRef);
    if (!credential.ok) return credential;
    if (credential.value === null) {
      return { ok: false, error: appError('missing_api_key', `No Gemini API key stored for provider ${provider.providerId}`) };
    }
    const apiKey = credential.value;
    let sizeBytes: number;
    try {
      sizeBytes = await this.videoFile.size(input.videoPath);
    } catch {
      return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
    }
    if (sizeBytes > GEMINI_NATIVE_FILES_API_LIMIT_BYTES) {
      return { ok: false, error: appError('provider_error', tooLargeMessage(sizeBytes)) };
    }
    const prompt = buildGeminiPrompt({ videoName: basename(input.videoPath), outputLanguage: input.outputLanguage });
    const timeoutMs = input.timeoutSeconds * 1000;
    const signal = combinedSignal(input.signal, timeoutMs);

    if (shouldUploadInline(sizeBytes)) {
      let bytes: Uint8Array;
      try {
        bytes = await this.videoFile.readAll(input.videoPath);
      } catch {
        return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
      }
      return this.generate(apiKey, provider, {
        parts: [
          { inline_data: { mime_type: 'video/mp4', data: bytesToBase64(bytes) } },
          { text: prompt },
        ],
      }, signal, input.signal);
    }

    const uploaded = await this.uploadResumable(apiKey, input.videoPath, sizeBytes, signal, input.signal);
    if (!uploaded.ok) return uploaded;
    const active = await this.pollActive(apiKey, uploaded.value.name, signal, input.signal);
    if (!active.ok) {
      await this.deleteFile(apiKey, uploaded.value.name);
      return active;
    }
    const generated = await this.generate(apiKey, provider, {
      parts: [
        { file_data: { mime_type: 'video/mp4', file_uri: active.value } },
        { text: prompt },
      ],
    }, signal, input.signal);
    await this.deleteFile(apiKey, uploaded.value.name);
    return generated;
  }

  async uploadForBatch(input: AnalyzerBatchUploadInput): Promise<Result<AnalyzerBatchRequest, AppError>> {
    const provider = input.provider;
    if (provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const apiKey = await this.apiKey(provider);
    if (!apiKey.ok) return apiKey;
    let sizeBytes: number;
    try {
      sizeBytes = await this.videoFile.size(input.videoPath);
    } catch {
      return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
    }
    if (sizeBytes > GEMINI_NATIVE_FILES_API_LIMIT_BYTES) {
      return { ok: false, error: appError('provider_error', tooLargeMessage(sizeBytes)) };
    }
    const signal = combinedSignal(input.signal, input.timeoutSeconds * 1000);
    const uploaded = await this.uploadResumable(apiKey.value, input.videoPath, sizeBytes, signal, input.signal);
    if (!uploaded.ok) return uploaded;
    const active = await this.pollActive(apiKey.value, uploaded.value.name, signal, input.signal);
    if (!active.ok) {
      await this.deleteFile(apiKey.value, uploaded.value.name);
      return active;
    }
    return ok({
      key: input.key,
      videoPath: input.videoPath,
      fileName: uploaded.value.name,
      fileUri: active.value,
      outputLanguage: input.outputLanguage,
    });
  }

  async submitBatch(input: {
    provider: AnalyzerProviderConfig;
    displayName: string;
    requests: readonly AnalyzerBatchRequest[];
    signal?: AbortSignal | undefined;
  }): Promise<Result<AnalyzerBatchSubmission, AppError>> {
    const provider = input.provider;
    if (provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const apiKey = await this.apiKey(provider);
    if (!apiKey.ok) return apiKey;
    const body = buildBatchSubmitBody(
      input.displayName,
      input.requests.map((request) => ({
        key: request.key,
        fileUri: request.fileUri,
        prompt: buildGeminiPrompt({
          videoName: basename(request.videoPath),
          outputLanguage: request.outputLanguage,
        }),
      })),
    );
    const bodyBytes = Buffer.byteLength(body);
    if (bodyBytes > BATCH_INLINE_REQUEST_LIMIT_BYTES) {
      return { ok: false, error: inlineRequestTooLargeError(bodyBytes, input.requests.length) };
    }
    const response = await this.batchFetch(
      `${GEMINI_NATIVE_API_BASE_URL}/v1beta/models/${provider.model}:batchGenerateContent`,
      apiKey.value,
      { method: 'POST', body },
      input.signal,
      { markRejections: true },
    );
    if (!response.ok) return response;
    const operation = parseBatchOperation(response.value);
    if (!operation.ok) return operation;
    const jobName = operation.value.name;
    if (jobName === undefined || jobName.length === 0) {
      return { ok: false, error: appError('provider_error', 'Gemini batch submission returned no job name') };
    }
    return ok({ jobName, requestCount: input.requests.length });
  }

  async findBatchByDisplayName(input: {
    provider: AnalyzerProviderConfig;
    displayName: string;
    signal?: AbortSignal | undefined;
  }): Promise<Result<string | null, AppError>> {
    const provider = input.provider;
    if (provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const apiKey = await this.apiKey(provider);
    if (!apiKey.ok) return apiKey;
    let pageToken: string | null = null;
    for (let page = 0; page < BATCH_LIST_PAGE_LIMIT; page += 1) {
      const url = `${GEMINI_NATIVE_API_BASE_URL}/v1beta/batches?pageSize=100`
        + (pageToken === null ? '' : `&pageToken=${encodeURIComponent(pageToken)}`);
      const response: Result<unknown, AppError> = await this.batchFetch(
        url,
        apiKey.value,
        { method: 'GET' },
        input.signal,
      );
      if (!response.ok) return response;
      const match = batchJobForDisplayName(response.value, input.displayName);
      if (match !== null) {
        if (match.matchCount > 1) {
          this.warn(
            `Gemini holds ${String(match.matchCount)} batch jobs named "${input.displayName}"; `
            + `re-attaching to the newest one (${match.jobName}).`,
          );
        }
        return ok(match.jobName);
      }
      pageToken = batchListNextPageToken(response.value);
      if (pageToken === null) return ok(null);
    }
    return ok(null);
  }

  async batchStatus(input: {
    provider: AnalyzerProviderConfig;
    jobName: string;
    requestKeys: readonly string[];
    signal?: AbortSignal | undefined;
  }): Promise<Result<AnalyzerBatchStatus, AppError>> {
    const provider = input.provider;
    if (provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const apiKey = await this.apiKey(provider);
    if (!apiKey.ok) return apiKey;
    const response = await this.batchFetch(
      `${GEMINI_NATIVE_API_BASE_URL}/v1beta/${input.jobName}`,
      apiKey.value,
      { method: 'GET' },
      input.signal,
      { missingIsExpired: true },
    );
    if (!response.ok) return response;
    if (response.value === MISSING_BATCH_JOB) {
      return ok({
        state: 'expired',
        message: `Gemini no longer knows batch job ${input.jobName}`,
        results: null,
      });
    }
    const operation = parseBatchOperation(response.value);
    if (!operation.ok) return operation;
    const reading = readBatchJobState(operation.value);
    if (reading.unrecognizedState !== null) {
      this.warn(
        `Gemini reported batch job ${input.jobName} with the unrecognized state `
        + `"${reading.unrecognizedState}"; treating it as ${reading.state}.`,
      );
    }
    const state = reading.state;
    if (state !== 'succeeded') {
      return ok({ state, message: batchJobMessage(operation.value), results: null });
    }
    if (operation.value.response?.responsesFile !== undefined) {
      return {
        ok: false,
        error: appError(
          'provider_error',
          'Gemini answered the batch with a responses file; this build only reads inline batch responses',
        ),
      };
    }
    return ok({
      state,
      message: null,
      results: batchResults(operation.value, input.requestKeys, geminiProviderPricing(provider, 'batch')),
    });
  }

  // The Files API holds an upload for 48 hours whether or not the job that used it is done;
  // releasing them keeps the account's quota free for the next run.
  async releaseBatchUploads(input: {
    provider: AnalyzerProviderConfig;
    fileNames: readonly string[];
  }): Promise<Result<void, AppError>> {
    const provider = input.provider;
    if (provider.family !== 'gemini-native') {
      return { ok: false, error: appError('invalid_config_value', 'Gemini native analyzer provider configuration is required') };
    }
    const apiKey = await this.apiKey(provider);
    if (!apiKey.ok) return apiKey;
    for (const fileName of input.fileNames) await this.deleteFile(apiKey.value, fileName);
    return ok(undefined);
  }

  private async apiKey(provider: GeminiNativeProvider): Promise<Result<string, AppError>> {
    const credential = await this.credentials.get(provider.apiKeyRef);
    if (!credential.ok) return credential;
    if (credential.value === null) {
      return { ok: false, error: appError('missing_api_key', `No Gemini API key stored for provider ${provider.providerId}`) };
    }
    return ok(credential.value);
  }

  private async batchFetch(
    url: string,
    apiKey: string,
    init: { method: string; body?: string | undefined },
    userSignal: AbortSignal | undefined,
    options: { missingIsExpired?: boolean | undefined; markRejections?: boolean | undefined } = {},
  ): Promise<Result<unknown, AppError>> {
    const signal = combinedSignal(userSignal, BATCH_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal,
      });
    } catch (cause) {
      return uploadFailure(userSignal, signal, cause);
    }
    if (response.status === 404 && options.missingIsExpired === true) return ok(MISSING_BATCH_JOB);
    if (!response.ok) {
      const definitive = options.markRejections === true
        && response.status >= 400 && response.status < 500
        && await carriesErrorBody(response);
      const error = batchHttpError(response.status);
      return { ok: false, error: definitive ? batchSubmitRejection(error) : error };
    }
    try {
      return ok(await response.json());
    } catch {
      return { ok: false, error: appError('provider_error', 'Gemini batch API returned invalid JSON') };
    }
  }

  async dependency(input?: {
    backend: AnalyzeInput['backend'];
    provider?: AnalyzeInput['provider'];
  }): Promise<Result<DependencyStatus, AppError>> {
    const provider = input?.provider;
    if (provider === undefined || provider.family !== 'gemini-native') {
      return ok({
        name: 'gemini-native',
        available: false,
        version: null,
        source: null,
        path: null,
        installHint: 'Configure the Gemini native video analyzer',
      });
    }
    const credential = await this.credentials.get(provider.apiKeyRef);
    if (!credential.ok) return credential;
    return ok({
      name: provider.providerId,
      available: credential.value !== null,
      version: null,
      source: null,
      path: null,
      installHint: `Run: ai-video-cataloger config set-credential ${provider.providerId}`,
    });
  }

  private async uploadResumable(
    apiKey: string,
    videoPath: string,
    sizeBytes: number,
    signal: AbortSignal,
    userSignal: AbortSignal | undefined,
  ): Promise<Result<{ name: string }, AppError>> {
    let startResponse: Response;
    try {
      startResponse = await this.fetchImpl(`${GEMINI_NATIVE_API_BASE_URL}/upload/v1beta/files`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(sizeBytes),
          'X-Goog-Upload-Header-Content-Type': 'video/mp4',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: basename(videoPath) } }),
        signal,
      });
    } catch (cause) {
      return uploadFailure(userSignal, signal, cause);
    }
    if (!startResponse.ok) {
      return { ok: false, error: uploadHttpError(startResponse.status) };
    }
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (uploadUrl === null) {
      return { ok: false, error: appError('provider_error', 'Gemini upload did not return an upload URL') };
    }
    return this.uploadChunks(apiKey, videoPath, sizeBytes, uploadUrl, signal, userSignal);
  }

  private async uploadChunks(
    apiKey: string,
    videoPath: string,
    sizeBytes: number,
    uploadUrl: string,
    signal: AbortSignal,
    userSignal: AbortSignal | undefined,
  ): Promise<Result<{ name: string }, AppError>> {
    let handle: VideoFileHandle;
    try {
      handle = await this.videoFile.open(videoPath);
    } catch {
      return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
    }
    try {
      let offset = 0;
      let retries = 0;
      while (offset < sizeBytes) {
        if (signal.aborted) return abortResult(userSignal);
        let chunk: Uint8Array<ArrayBuffer>;
        try {
          chunk = await handle.read(offset, Math.min(this.uploadChunkBytes, sizeBytes - offset));
        } catch {
          return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
        }
        if (chunk.byteLength === 0) {
          return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
        }
        const last = offset + chunk.byteLength >= sizeBytes;
        const attempt = await this.sendChunk({ apiKey, uploadUrl, offset, chunk, last, signal, userSignal });
        if ('response' in attempt) {
          if (last) return uploadedFileName(attempt.response);
          offset += chunk.byteLength;
          retries = 0;
          continue;
        }
        if (!attempt.retryable || retries >= UPLOAD_CHUNK_RETRIES) return attempt.failure;
        retries += 1;
        await this.sleep(UPLOAD_RETRY_DELAY_MS * retries);
        const received = await this.receivedOffset(apiKey, uploadUrl, signal);
        if (received !== null) offset = received;
      }
      return { ok: false, error: appError('read_error', 'Could not read video file for Gemini analysis') };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private async sendChunk(input: {
    apiKey: string;
    uploadUrl: string;
    offset: number;
    chunk: Uint8Array<ArrayBuffer>;
    last: boolean;
    signal: AbortSignal;
    userSignal: AbortSignal | undefined;
  }): Promise<{ response: Response } | { failure: Result<never, AppError>; retryable: boolean }> {
    try {
      const response = await this.fetchImpl(input.uploadUrl, {
        method: 'POST',
        headers: {
          'x-goog-api-key': input.apiKey,
          'X-Goog-Upload-Command': input.last ? 'upload, finalize' : 'upload',
          'X-Goog-Upload-Offset': String(input.offset),
          'Content-Length': String(input.chunk.byteLength),
        },
        body: input.chunk,
        signal: input.signal,
      });
      if (response.ok) return { response };
      return {
        failure: { ok: false, error: uploadHttpError(response.status) },
        retryable: isRetryableUploadStatus(response.status),
      };
    } catch (cause) {
      return {
        failure: uploadFailure(input.userSignal, input.signal, cause),
        retryable: !input.signal.aborted,
      };
    }
  }

  // The resumable protocol answers a `query` command with the byte count it actually holds,
  // which is the only safe place to resume a chunk the server may have half received.
  private async receivedOffset(apiKey: string, uploadUrl: string, signal: AbortSignal): Promise<number | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(uploadUrl, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'X-Goog-Upload-Command': 'query', 'Content-Length': '0' },
        signal,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const received = Number(response.headers.get('x-goog-upload-size-received'));
    return Number.isSafeInteger(received) && received >= 0 ? received : null;
  }

  private async pollActive(
    apiKey: string,
    fileName: string,
    signal: AbortSignal,
    userSignal: AbortSignal | undefined,
  ): Promise<Result<string, AppError>> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      if (signal.aborted) return abortResult(userSignal);
      let response: Response;
      try {
        response = await this.fetchImpl(`${GEMINI_NATIVE_API_BASE_URL}/v1beta/${fileName}`, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
          signal,
        });
      } catch (cause) {
        return uploadFailure(userSignal, signal, cause);
      }
      if (!response.ok) return { ok: false, error: uploadHttpError(response.status) };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: appError('provider_error', 'Gemini file status returned invalid JSON') };
      }
      const parsed = fileStateSchema.safeParse(body);
      const state = parsed.success ? parsed.data.state : undefined;
      if (state === 'ACTIVE') {
        const uri = parsed.success ? parsed.data.uri : undefined;
        if (uri === undefined || uri.length === 0) {
          return { ok: false, error: appError('provider_error', 'Gemini file became ACTIVE without a URI') };
        }
        return ok(uri);
      }
      if (state === 'FAILED') {
        return { ok: false, error: appError('provider_error', 'Gemini failed to process the uploaded video') };
      }
      await this.sleep(this.pollIntervalMs);
    }
    return { ok: false, error: appError('provider_error', 'Gemini video did not become ACTIVE before timeout') };
  }

  private async deleteFile(apiKey: string, fileName: string): Promise<void> {
    try {
      await this.fetchImpl(`${GEMINI_NATIVE_API_BASE_URL}/v1beta/${fileName}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return;
    }
  }

  private async generate(
    apiKey: string,
    provider: GeminiNativeProvider,
    content: { parts: unknown[] },
    signal: AbortSignal,
    userSignal: AbortSignal | undefined,
  ): Promise<Result<AnalysisOutput, AppError>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${GEMINI_NATIVE_API_BASE_URL}/v1beta/models/${provider.model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [content] }),
        signal,
      });
    } catch (cause) {
      return uploadFailure(userSignal, signal, cause);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: appError('provider_auth_failed', 'Gemini rejected the stored API key') };
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const hint = retryAfter === null ? 'Retry later.' : `Retry after ${retryAfter} seconds.`;
        return { ok: false, error: appError('rate_limited', `Gemini rate limit reached. ${hint}`) };
      }
      return { ok: false, error: appError('provider_error', `Gemini API returned HTTP ${response.status}`) };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: appError('provider_error', 'Gemini API returned invalid JSON') };
    }
    return analysisFromGenerateContent(body, geminiProviderPricing(provider));
  }
}

const basename = (filePath: string): string => filePath.split(/[/\\]/).pop() ?? filePath;

const combinedSignal = (userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal =>
  userSignal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([userSignal, AbortSignal.timeout(timeoutMs)]);

const abortResult = (userSignal: AbortSignal | undefined): Result<never, AppError> =>
  userSignal?.aborted === true
    ? { ok: false, error: appError('processing_error', 'Gemini analysis cancelled') }
    : { ok: false, error: appError('provider_error', 'Gemini request timed out') };

const uploadFailure = (
  userSignal: AbortSignal | undefined,
  signal: AbortSignal,
  cause: unknown,
): Result<never, AppError> => {
  if (userSignal?.aborted === true) return { ok: false, error: appError('processing_error', 'Gemini analysis cancelled') };
  if (signal.aborted) return { ok: false, error: appError('provider_error', 'Gemini request timed out') };
  return { ok: false, error: appError('provider_error', 'Gemini request failed', cause) };
};

const uploadedFileName = async (response: Response): Promise<Result<{ name: string }, AppError>> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: appError('provider_error', 'Gemini upload returned invalid JSON') };
  }
  const parsed = uploadResponseSchema.safeParse(body);
  const name = parsed.success ? parsed.data.file?.name : undefined;
  if (name === undefined || name.length === 0) {
    return { ok: false, error: appError('provider_error', 'Gemini upload response did not contain a file name') };
  }
  return ok({ name });
};

const gigabytes = (bytes: number): string => (bytes / 1024 / 1024 / 1024).toFixed(2);

const tooLargeMessage = (sizeBytes: number): string =>
  `Video is ${gigabytes(sizeBytes)} GB; the Gemini Files API accepts at most `
  + `${gigabytes(GEMINI_NATIVE_FILES_API_LIMIT_BYTES)} GB per file`;

const batchErrorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }),
});

const carriesErrorBody = async (response: Response): Promise<boolean> => {
  try {
    return batchErrorBodySchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
};

const batchHttpError = (status: number): AppError => {
  if (status === 401 || status === 403) return appError('provider_auth_failed', 'Gemini rejected the stored API key');
  if (status === 429) return appError('rate_limited', 'Gemini rate limit reached. Retry later.');
  return appError('provider_error', `Gemini batch API returned HTTP ${status}`);
};

const uploadHttpError = (status: number): AppError => {
  if (status === 401 || status === 403) return appError('provider_auth_failed', 'Gemini rejected the stored API key');
  if (status === 429) return appError('rate_limited', 'Gemini rate limit reached. Retry later.');
  return appError('provider_error', `Gemini upload returned HTTP ${status}`);
};
