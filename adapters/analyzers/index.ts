import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import {
  appError,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type {
  AnalysisOutput,
  AnalyzeInput,
  AnalyzerPort,
  DependencyStatus,
  LocalAiRuntimePort,
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

export interface AnalyzerCommandRunnerOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
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

export interface ClaudeCliAnalyzerAdapterOptions {
  commandRunner?: AnalyzerCommandRunner | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homeDirectory?: string | undefined;
  verbose?: boolean | undefined;
  writeStdout?: ((chunk: string) => void) | undefined;
  writeStderr?: ((chunk: string) => void) | undefined;
}

export interface OllamaAnalyzerAdapterOptions {
  runtime: LocalAiRuntimePort;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  readFrame?: ((framePath: string) => Promise<Uint8Array>) | undefined;
  verbose?: boolean | undefined;
  writeStdout?: ((chunk: string) => void) | undefined;
}

export class ClaudeCliAnalyzerAdapter implements AnalyzerPort {
  private readonly commandRunner: AnalyzerCommandRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDirectory: string;
  private readonly verbose: boolean;
  private readonly writeStdout: (chunk: string) => void;
  private readonly writeStderr: (chunk: string) => void;

  constructor(options: ClaudeCliAnalyzerAdapterOptions = {}) {
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
    const videoDir = path.dirname(input.videoPath);
    const prompt = buildAnalyzerPrompt({
      videoName: path.basename(input.videoPath),
      transcript: input.transcript,
      framePaths: input.framePaths,
      frameMode: 'file-url',
    });
    await clearClaudeProjectHistory(this.homeDirectory, videoDir);
    const args = ['--add-dir', videoDir, '-p', prompt];
    const verbosePrefix = this.verbose
      ? [
        `[verbose] Frame paths being analyzed:\n${input.framePaths.map((framePath) => `  ${framePath}`).join('\n')}\n`,
        `[verbose] Full prompt being sent to Claude:\n${prompt}\n`,
        `[verbose] Running: claude --add-dir "${videoDir}" -p "<prompt>"\n`,
      ].join('\n')
      : '';
    if (verbosePrefix.length > 0) this.writeStdout(verbosePrefix);
    const run = await this.commandRunner.run('claude', args, {
      env: filteredAnalyzerEnv(this.env),
      timeoutMs: input.timeoutSeconds * 1000,
      onStdout: this.verbose ? this.writeStdout : undefined,
      onStderr: this.verbose ? this.writeStderr : undefined,
    });
    if (!run.ok) return run;
    return ok({ rawResponse: run.value.stdout });
  }

  async dependency(): Promise<Result<DependencyStatus, AppError>> {
    const version = await this.commandRunner.run('claude', ['--version'], {
      env: filteredAnalyzerEnv(this.env),
      timeoutMs: 5000,
    });
    if (!version.ok) {
      return ok({
        name: 'claude',
        available: false,
        version: null,
        source: null,
        path: null,
        installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
      });
    }
    return ok({
      name: 'claude',
      available: true,
      version: version.value.stdout.trim() || 'installed',
      source: 'system',
      path: null,
      installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
    });
  }
}

export class OllamaAnalyzerAdapter implements AnalyzerPort {
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

  async analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>> {
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
    if (this.verbose) {
      this.writeStdout(`[verbose] Local analysis via ${this.baseUrl} model ${input.localModel}\n`);
      this.writeStdout(`[verbose] ${input.framePaths.length} frame(s), prompt below:\n${prompt}\n`);
    }
    const response = await postOllamaChat(this.fetchImpl, this.baseUrl, {
      model: input.localModel,
      prompt,
      images,
      timeoutMs: input.timeoutSeconds * 1000,
    });
    if (!response.ok) return response;
    if (this.verbose) this.writeStdout(`[verbose] Local model response:\n${response.value}\n`);
    return ok({ rawResponse: response.value });
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return this.runtime.dependency();
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

export const claudeProjectHistoryPath = (homeDirectory: string, videoDirectory: string): string =>
  path.join(homeDirectory, '.claude', 'projects', `-${videoDirectory.replaceAll('/', '-').replace(/^-/, '')}`);

export const buildAnalyzerPrompt = (input: {
  videoName: string;
  transcript: string | null;
  framePaths: readonly string[];
  frameMode: 'file-url' | 'attached-images';
}): string => {
  const transcriptBlock = input.transcript === null
    ? 'This video has no audio or transcript available.\n\n'
    : `Here is the transcript of the audio:\n---\n${input.transcript}\n---\n\n`;
  const frameBlock = input.frameMode === 'file-url'
    ? `Here are ${input.framePaths.length} frame(s) extracted from the video:\n${input.framePaths.map((framePath) => `file://${framePath}`).join('\n')}\n\n`
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

const isModelInstalled = (installedModels: readonly string[], tag: string): boolean =>
  installedModels.some((installed) => installed === tag || installed === `${tag}:latest`);

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const normalizeOllamaBaseUrl = (value: string): string =>
  value.startsWith('http://') || value.startsWith('https://') ? value : `http://${value}`;

const postOllamaChat = async (
  fetchImpl: typeof fetch,
  baseUrl: string,
  request: { model: string; prompt: string; images: string[]; timeoutMs: number },
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
      signal: AbortSignal.timeout(request.timeoutMs),
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

const childProcessAnalyzerCommandRunner: AnalyzerCommandRunner = {
  run: (command, args, options) =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], {
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
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
        resolve({ ok: false, error: appError('processing_error', cause.message, cause) });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (timedOut) {
          resolve({ ok: false, error: appError('processing_error', `Command timed out: ${command}`) });
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
