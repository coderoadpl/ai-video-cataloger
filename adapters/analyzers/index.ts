import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import {
  appError,
  legacyAnalyzerProvider,
  ok,
  type AppError,
  type AnalyzerProviderConfig,
  type Result,
} from '@core/domain/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerPort,
  CredentialsStore,
  DependencyStatus,
  LocalAiRuntimePort,
  ProvidersPort,
  ProviderTestResult,
} from '@core/server/index.js';

const envKeysToExclude = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'NODE_OPTIONS',
  'NODE_DEBUG',
  'DEBUG',
  'VSCODE_INSPECTOR_OPTIONS',
  'VSCODE_CLI',
  'VSCODE_PID',
  'VSCODE_CWD',
  'VSCODE_NLS_CONFIG',
  'VSCODE_CODE_CACHE_PATH',
  'VSCODE_HANDLES_UNCAUGHT_ERRORS',
  'CLAUDECODE',
]);

const ollamaChatResponseSchema = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
});

const apiChatResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
  })),
});

export interface AnalyzerCommandRunnerOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onStdout?: ((chunk: string) => void) | undefined;
  onStderr?: ((chunk: string) => void) | undefined;
}

export interface AnalyzerCommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: AnalyzerCommandRunnerOptions,
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>>;
}

export interface HarnessAnalyzerAdapterOptions {
  commandRunner?: AnalyzerCommandRunner | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homeDirectory?: string | undefined;
  verbose?: boolean | undefined;
  writeStdout?: ((chunk: string) => void) | undefined;
  writeStderr?: ((chunk: string) => void) | undefined;
}

interface HarnessRuntimeDefinition {
  providerId: string;
  versionArgs: readonly string[];
  dependencyName: string;
  installHint: string;
  beforeRun: 'claude-project-history' | null;
  verboseInvocation: string | null;
}

const harnessRuntimeDefinitions: readonly HarnessRuntimeDefinition[] = [
  {
    providerId: 'claude-code',
    versionArgs: ['--version'],
    dependencyName: 'claude',
    installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
    beforeRun: 'claude-project-history',
    verboseInvocation: 'claude --add-dir "{videoDir}" -p "<prompt>"',
  },
  {
    providerId: 'codex',
    versionArgs: ['--version'],
    dependencyName: 'codex',
    installHint: 'Install Codex CLI',
    beforeRun: null,
    verboseInvocation: null,
  },
  {
    providerId: 'cursor-agent',
    versionArgs: ['--version'],
    dependencyName: 'cursor-agent',
    installHint: 'Install Cursor Agent CLI',
    beforeRun: null,
    verboseInvocation: null,
  },
];

export interface OllamaAnalyzerAdapterOptions {
  runtime: LocalAiRuntimePort;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  readFrame?: ((framePath: string) => Promise<Uint8Array>) | undefined;
  verbose?: boolean | undefined;
  writeStdout?: ((chunk: string) => void) | undefined;
}

export interface OpenAiCompatibleAnalyzerAdapterOptions {
  credentials: CredentialsStore;
  fetchImpl?: typeof fetch | undefined;
  readFrame?: ((framePath: string) => Promise<Uint8Array>) | undefined;
}

export class OpenAiCompatibleAnalyzerAdapter implements AnalyzerPort, ProvidersPort {
  private readonly credentials: CredentialsStore;
  private readonly fetchImpl: typeof fetch;
  private readonly readFrame: (framePath: string) => Promise<Uint8Array>;

  constructor(options: OpenAiCompatibleAnalyzerAdapterOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.readFrame = options.readFrame ?? readFile;
  }

  async test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family !== 'api') {
      return { ok: false, error: appError('invalid_config_value', 'API provider configuration is required') };
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
        message: `No API key stored for ${config.providerId}. Save a credential before testing.`,
      });
    }
    return ok(await probeApiProvider(this.fetchImpl, config, credential.value, startedAt));
  }

  async analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    const provider = input.provider;
    if (provider === undefined || provider.family !== 'api') {
      return { ok: false, error: appError('invalid_config_value', 'API analyzer provider configuration is required') };
    }
    const credential = await this.credentials.get(provider.apiKeyRef);
    if (!credential.ok) return credential;
    if (credential.value === null) {
      return { ok: false, error: appError('missing_api_key', `No credential stored for provider ${provider.providerId}`) };
    }
    let images: Uint8Array[];
    try {
      images = await Promise.all(input.framePaths.map((framePath) => this.readFrame(framePath)));
    } catch {
      return { ok: false, error: appError('read_error', 'Could not read frames for API analysis') };
    }
    const prompt = buildAnalyzerPrompt({
      videoName: path.basename(input.videoPath),
      transcript: input.transcript,
      framePaths: input.framePaths,
      frameMode: 'attached-images',
    });
    const result = await postOpenAiCompatibleChat(this.fetchImpl, {
      provider,
      apiKey: credential.value,
      prompt,
      framePaths: input.framePaths,
      images,
      timeoutMs: input.timeoutSeconds * 1000,
      signal: input.signal,
    });
    if (!result.ok) return result;
    return ok({ rawResponse: result.value });
  }

  async dependency(input?: {
    backend: AnalyzeInput['backend'];
    provider?: AnalyzeInput['provider'];
  }): Promise<Result<DependencyStatus, AppError>> {
    const provider = input?.provider;
    if (provider === undefined || provider.family !== 'api') {
      return ok({
        name: 'api-provider',
        available: false,
        version: null,
        source: null,
        path: null,
        installHint: 'Configure an API analyzer provider',
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
}

export class HarnessAnalyzerAdapter implements AnalyzerPort, ProvidersPort {
  private readonly commandRunner: AnalyzerCommandRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDirectory: string;
  private readonly verbose: boolean;
  private readonly writeStdout: (chunk: string) => void;
  private readonly writeStderr: (chunk: string) => void;

  constructor(options: HarnessAnalyzerAdapterOptions = {}) {
    this.commandRunner = options.commandRunner ?? childProcessAnalyzerCommandRunner;
    this.env = options.env ?? process.env;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.verbose = options.verbose ?? false;
    this.writeStdout = options.writeStdout ?? ((chunk) => {
      process.stdout.write(chunk);
    });
    this.writeStderr = options.writeStderr ?? ((chunk) => {
      process.stderr.write(chunk);
    });
  }

  async analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    const provider = input.provider ?? legacyAnalyzerProvider('claude');
    if (provider.family !== 'harness') {
      return { ok: false, error: appError('invalid_config_value', 'Harness analyzer provider configuration is required') };
    }
    const verbose = this.verbose || input.verbose;
    const videoDir = path.dirname(input.videoPath);
    const prompt = buildAnalyzerPrompt({
      videoName: path.basename(input.videoPath),
      transcript: input.transcript,
      framePaths: input.framePaths,
      frameMode: provider.promptStyle === 'file-urls' ? 'file-url' : 'dir-access',
    });
    const runtime = harnessRuntimeDefinition(provider.providerId);
    await runHarnessPreparation(runtime, this.homeDirectory, videoDir);
    const args = expandHarnessArgs(provider.argsTemplate, { prompt, videoDir });
    const invocation = runtime.verboseInvocation === null
      ? `${provider.command} ${expandHarnessArgs(provider.argsTemplate, { prompt: '<prompt>', videoDir }).map((argument) => JSON.stringify(argument)).join(' ')}`
      : runtime.verboseInvocation.replaceAll('{videoDir}', videoDir);
    const verbosePrefix = verbose
      ? [
        `[verbose] Frame paths being analyzed:\n${input.framePaths.map((framePath) => `  ${framePath}`).join('\n')}\n`,
        `[verbose] Full prompt being sent to ${provider.providerId}:\n${prompt}\n`,
        `[verbose] Running: ${invocation}\n`,
      ].join('\n')
      : '';
    if (verbosePrefix.length > 0) this.writeStdout(verbosePrefix);
    const run = await this.commandRunner.run(provider.command, args, {
      env: filteredAnalyzerEnv(this.env),
      timeoutMs: input.timeoutSeconds * 1000,
      signal: input.signal,
      onStdout: verbose ? this.writeStdout : undefined,
      onStderr: verbose ? this.writeStderr : undefined,
    });
    if (!run.ok) return run;
    return ok({ rawResponse: run.value.stdout });
  }

  async dependency(input?: {
    backend: AnalyzeInput['backend'];
    provider?: AnalyzeInput['provider'];
  }): Promise<Result<DependencyStatus, AppError>> {
    const provider = input?.provider ?? legacyAnalyzerProvider('claude');
    if (provider.family !== 'harness') {
      return ok(unavailableHarnessDependency('harness', 'Configure a harness analyzer provider'));
    }
    const tested = await this.testHarness(provider);
    const runtime = harnessRuntimeDefinition(provider.providerId);
    return ok({
      name: runtime.dependencyName,
      available: tested.available,
      version: tested.version,
      source: tested.available ? 'system' : null,
      path: null,
      installHint: tested.available ? runtime.installHint : `${runtime.installHint}. ${tested.message}`,
    });
  }

  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family !== 'harness') {
      return Promise.resolve({
        ok: false,
        error: appError('invalid_config_value', 'Harness provider configuration is required'),
      });
    }
    return this.testHarness(config).then((result) => ok(result));
  }

  private async testHarness(
    provider: Extract<AnalyzerProviderConfig, { family: 'harness' }>,
  ): Promise<Extract<ProviderTestResult, { family: 'harness' }>> {
    const startedAt = performance.now();
    const runtime = harnessRuntimeDefinition(provider.providerId);
    const version = await this.commandRunner.run(provider.command, runtime.versionArgs, {
      env: filteredAnalyzerEnv(this.env),
      timeoutMs: 5000,
    });
    if (!version.ok) {
      return {
        family: 'harness',
        providerId: provider.providerId,
        available: false,
        version: null,
        latencyMs: Math.round(performance.now() - startedAt),
        message: version.error.message,
      };
    }
    const reportedVersion = version.value.stdout.trim() || version.value.stderr.trim() || 'installed';
    return {
      family: 'harness',
      providerId: provider.providerId,
      available: true,
      version: reportedVersion,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `${provider.command} ${reportedVersion}`,
    };
  }
}

export class OllamaAnalyzerAdapter implements AnalyzerPort, ProvidersPort {
  private readonly runtime: LocalAiRuntimePort;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly readFrame: (framePath: string) => Promise<Uint8Array>;
  private readonly verbose: boolean;
  private readonly writeStdout: (chunk: string) => void;

  constructor(options: OllamaAnalyzerAdapterOptions) {
    this.runtime = options.runtime;
    this.baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.readFrame = options.readFrame ?? readFile;
    this.verbose = options.verbose ?? false;
    this.writeStdout = options.writeStdout ?? ((chunk) => {
      process.stdout.write(chunk);
    });
  }

  async test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>> {
    if (config.family !== 'local') {
      return { ok: false, error: appError('invalid_config_value', 'Local provider configuration is required') };
    }
    const startedAt = performance.now();
    const status = await this.runtime.status();
    if (!status.ok) return status;
    const runtimeAvailable = status.value.runtimeUp;
    const modelAvailable = runtimeAvailable && isModelInstalled(status.value.installedModels, config.modelTag);
    const message = !runtimeAvailable
      ? 'Local AI runtime is not running'
      : modelAvailable
        ? `Local AI model ${config.modelTag} is installed`
        : `Local AI model ${config.modelTag} is not installed. Run: ai-video-cataloger models pull ${config.modelTag}`;
    return ok({
      family: 'local',
      providerId: config.providerId,
      runtimeAvailable,
      modelAvailable,
      version: runtimeAvailable ? status.value.runtimeVersion : null,
      latencyMs: Math.round(performance.now() - startedAt),
      message,
    });
  }

  async analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
    const verbose = this.verbose || input.verbose;
    const status = await this.runtime.status();
    if (!status.ok) return status;
    if (!status.value.runtimeUp) {
      return { ok: false, error: appError('ollama_unavailable', 'Local AI runtime is not available') };
    }
    if (!isModelInstalled(status.value.installedModels, input.localModel)) {
      return {
        ok: false,
        error: appError(
          'model_not_installed',
          `Local AI model "${input.localModel}" is not installed. Run: ai-video-cataloger models pull ${input.localModel}`,
        ),
      };
    }
    const images = await Promise.all(input.framePaths.map(async (framePath) => bytesToBase64(await this.readFrame(framePath))));
    const prompt = buildAnalyzerPrompt({
      videoName: path.basename(input.videoPath),
      transcript: input.transcript,
      framePaths: input.framePaths,
      frameMode: 'attached-images',
    });
    if (verbose) {
      this.writeStdout(`[verbose] Local analysis via ${this.baseUrl} model ${input.localModel}\n`);
      this.writeStdout(`[verbose] ${input.framePaths.length} frame(s), prompt below:\n${prompt}\n`);
    }
    const response = await postOllamaChat(this.fetchImpl, this.baseUrl, {
      model: input.localModel,
      prompt,
      images,
      timeoutMs: input.timeoutSeconds * 1000,
      signal: input.signal,
    });
    if (!response.ok) return response;
    if (verbose) this.writeStdout(`[verbose] Local model response:\n${response.value}\n`);
    return ok({ rawResponse: response.value });
  }

  async dependency(input?: {
    backend: AnalyzeInput['backend'];
    provider?: AnalyzeInput['provider'];
  }): Promise<Result<DependencyStatus, AppError>> {
    const runtime = await this.runtime.dependency();
    if (!runtime.ok || !runtime.value.available || input?.provider?.family !== 'local') return runtime;
    const status = await this.runtime.status();
    if (!status.ok) return status;
    const modelAvailable = status.value.runtimeUp
      && isModelInstalled(status.value.installedModels, input.provider.modelTag);
    if (modelAvailable) return runtime;
    return ok({
      name: input.provider.modelTag,
      available: false,
      version: status.value.runtimeVersion,
      source: null,
      path: null,
      installHint: `Run: ai-video-cataloger models pull ${input.provider.modelTag}`,
    });
  }
}

export const filteredAnalyzerEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !envKeysToExclude.has(key) && !key.startsWith('VSCODE_')) {
      filtered[key] = value;
    }
  }
  return filtered;
};

export const expandHarnessArgs = (
  argsTemplate: readonly string[],
  values: { prompt: string; videoDir: string },
): string[] => argsTemplate.map((argument) => argument
  .replaceAll('{prompt}', values.prompt)
  .replaceAll('{videoDir}', values.videoDir));

export const claudeProjectHistoryPath = (homeDirectory: string, videoDirectory: string): string =>
  path.join(homeDirectory, '.claude', 'projects', `-${videoDirectory.replaceAll('/', '-').replace(/^-/, '')}`);

export const buildAnalyzerPrompt = (input: {
  videoName: string;
  transcript: string | null;
  framePaths: readonly string[];
  frameMode: 'file-url' | 'dir-access' | 'attached-images';
}): string => {
  const transcriptBlock = input.transcript === null
    ? 'This video has no audio or transcript available.\n\n'
    : `Here is the transcript of the audio:\n---\n${input.transcript}\n---\n\n`;
  const frameBlock = input.frameMode === 'file-url'
    ? `Here are ${input.framePaths.length} frame(s) extracted from the video:\n${input.framePaths.map((framePath) => `file://${framePath}`).join('\n')}\n\n`
    : input.frameMode === 'dir-access'
      ? `Read these ${input.framePaths.length} frame file(s) from the accessible video workspace:\n${input.framePaths.join('\n')}\n\n`
      : `Attached are ${input.framePaths.length} frame(s) extracted from the video (as images).\n\n`;
  return `You are analyzing a video file named "${input.videoName}".\n\n${transcriptBlock}${frameBlock}${responseContractInstructions(input.transcript !== null)}`;
};

const responseContractInstructions = (hasTranscript: boolean): string =>
  `Based on the visual content from the frames${hasTranscript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;

const clearClaudeProjectHistory = async (homeDirectory: string, videoDirectory: string): Promise<void> => {
  await rm(claudeProjectHistoryPath(homeDirectory, videoDirectory), { recursive: true, force: true });
};

const harnessRuntimeDefinition = (providerId: string): HarnessRuntimeDefinition =>
  harnessRuntimeDefinitions.find((definition) => definition.providerId === providerId) ?? {
    providerId,
    versionArgs: ['--version'],
    dependencyName: providerId,
    installHint: `Install the ${providerId} harness command`,
    beforeRun: null,
    verboseInvocation: null,
  };

const runHarnessPreparation = async (
  definition: HarnessRuntimeDefinition,
  homeDirectory: string,
  videoDirectory: string,
): Promise<void> => {
  if (definition.beforeRun === 'claude-project-history') {
    await clearClaudeProjectHistory(homeDirectory, videoDirectory);
  }
};

const unavailableHarnessDependency = (name: string, installHint: string): DependencyStatus => ({
  name,
  available: false,
  version: null,
  source: null,
  path: null,
  installHint,
});

const isModelInstalled = (installedModels: readonly string[], tag: string): boolean =>
  installedModels.some((installed) => installed === tag || installed === `${tag}:latest`);

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const normalizeOllamaBaseUrl = (value: string): string =>
  value.startsWith('http://') || value.startsWith('https://') ? value : `http://${value}`;

const apiProbeTimeoutMs = 10_000;

const probeApiProvider = async (
  fetchImpl: typeof fetch,
  config: Extract<AnalyzerProviderConfig, { family: 'api' }>,
  apiKey: string,
  startedAt: number,
): Promise<Extract<ProviderTestResult, { family: 'api' }>> => {
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(apiProbeTimeoutMs),
    });
  } catch {
    return {
      family: 'api',
      providerId: config.providerId,
      reachable: false,
      authenticated: false,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Could not reach API provider at ${config.baseUrl}`,
    };
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  if (response.status === 401 || response.status === 403) {
    return {
      family: 'api',
      providerId: config.providerId,
      reachable: true,
      authenticated: false,
      latencyMs,
      message: 'API provider rejected the stored credential',
    };
  }
  if (!response.ok) {
    return {
      family: 'api',
      providerId: config.providerId,
      reachable: true,
      authenticated: false,
      latencyMs,
      message: `API provider returned HTTP ${response.status}`,
    };
  }
  return {
    family: 'api',
    providerId: config.providerId,
    reachable: true,
    authenticated: true,
    latencyMs,
    message: `Connected to ${config.baseUrl}`,
  };
};

const postOpenAiCompatibleChat = async (
  fetchImpl: typeof fetch,
  request: {
    provider: Extract<AnalyzerProviderConfig, { family: 'api' }>;
    apiKey: string;
    prompt: string;
    framePaths: string[];
    images: Uint8Array[];
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  },
): Promise<Result<string, AppError>> => {
  let response: Response;
  const signal = request.signal === undefined
    ? AbortSignal.timeout(request.timeoutMs)
    : AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]);
  try {
    response = await fetchImpl(`${request.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: request.provider.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            ...request.images.map((image, index) => ({
              type: 'image_url',
              image_url: {
                url: `data:${imageMimeType(request.framePaths[index] ?? '')};base64,${bytesToBase64(image)}`,
                detail: request.provider.maxImageDetail,
              },
            })),
          ],
        }],
      }),
      signal,
    });
  } catch {
    if (request.signal?.aborted === true) {
      return { ok: false, error: appError('processing_error', 'API analysis cancelled') };
    }
    if (signal.aborted) {
      return { ok: false, error: appError('provider_error', 'API provider request timed out') };
    }
    return { ok: false, error: appError('provider_error', 'API provider request failed') };
  }
  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    const excerpt = redactSecret(rawBody.slice(0, 500), request.apiKey);
    if (response.status === 401) {
      return { ok: false, error: appError('provider_auth_failed', 'API provider rejected the stored credential') };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const hint = retryAfter === null ? 'Retry later.' : `Retry after ${retryAfter} seconds.`;
      return { ok: false, error: appError('rate_limited', `API provider rate limit reached. ${hint}`) };
    }
    const suffix = excerpt.trim().length === 0 ? '' : `: ${excerpt.trim()}`;
    return { ok: false, error: appError('provider_error', `API provider returned HTTP ${response.status}${suffix}`) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: appError('provider_error', 'API provider returned invalid JSON') };
  }
  const parsed = apiChatResponseSchema.safeParse(body);
  const content = parsed.success ? parsed.data.choices[0]?.message.content : null;
  if (content === null || content === undefined || content.length === 0) {
    return { ok: false, error: appError('provider_error', 'API provider returned an empty response') };
  }
  return ok(content);
};

const imageMimeType = (framePath: string): string => {
  const extension = path.extname(framePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
};

const redactSecret = (value: string, secret: string): string =>
  secret.length === 0 ? value : value.replaceAll(secret, '[REDACTED]');

const postOllamaChat = async (
  fetchImpl: typeof fetch,
  baseUrl: string,
  request: { model: string; prompt: string; images: string[]; timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<Result<string, AppError>> => {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0.2 },
        messages: [{ role: 'user', content: request.prompt, images: request.images }],
      }),
      signal: request.signal === undefined
        ? AbortSignal.timeout(request.timeoutMs)
        : AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]),
    });
  } catch (cause) {
    return { ok: false, error: appError('ollama_unavailable', unavailableMessage(baseUrl, cause), cause) };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (/not found/i.test(text)) {
      return { ok: false, error: appError('model_not_installed', `Model not installed: ${request.model}`) };
    }
    return { ok: false, error: appError('ollama_unavailable', `Local AI runtime not reachable at ${baseUrl}: HTTP ${response.status}`) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return { ok: false, error: appError('ollama_unavailable', unavailableMessage(baseUrl, cause), cause) };
  }
  const parsed = ollamaChatResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.message?.content === undefined || parsed.data.message.content.length === 0) {
    return { ok: false, error: appError('ollama_unavailable', 'Local AI returned an empty response') };
  }
  return ok(parsed.data.message.content);
};

const unavailableMessage = (baseUrl: string, cause: unknown): string =>
  `Local AI runtime not reachable at ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`;

export const childProcessAnalyzerCommandRunner: AnalyzerCommandRunner = {
  run: (command, args, options) =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], {
        detached: true,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let forcedTermination: NodeJS.Timeout | undefined;
      const terminate = (): void => {
        killChildProcessGroup(child, 'SIGTERM');
        forcedTermination = setTimeout(() => {
          if (!settled) killChildProcessGroup(child, 'SIGKILL');
        }, 1000);
      };
      const abort = (): void => {
        cancelled = true;
        terminate();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      if (options.signal?.aborted === true) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        options.onStdout?.(text);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        options.onStderr?.(text);
      });
      child.on('error', (cause) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forcedTermination !== undefined) clearTimeout(forcedTermination);
        options.signal?.removeEventListener('abort', abort);
        resolve({ ok: false, error: appError('processing_error', cause.message, cause) });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forcedTermination !== undefined) clearTimeout(forcedTermination);
        options.signal?.removeEventListener('abort', abort);
        if (timedOut) {
          resolve({ ok: false, error: appError('processing_error', `Command timed out: ${command}`) });
          return;
        }
        if (cancelled) {
          resolve({ ok: false, error: appError('processing_error', `Command cancelled: ${command}`) });
          return;
        }
        if (code !== 0) {
          resolve({ ok: false, error: appError('processing_error', stderr.trim() || `Command failed: ${command}`) });
          return;
        }
        resolve(ok({ stdout, stderr }));
      });
    }),
};

const killChildProcessGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid !== undefined) {
    let groupKilled = false;
    try {
      process.kill(-child.pid, signal);
      groupKilled = true;
    } catch {
      groupKilled = false;
    }
    if (groupKilled) return;
  }
  child.kill(signal);
};
