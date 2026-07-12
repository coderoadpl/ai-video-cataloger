import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ok, type AppError, type MachineProfile, type Result } from '@core/domain/index.js';
import type { DependencyStatus, LocalAiRuntimePort, LocalAiRuntimeStatus } from '@core/server/index.js';

import {
  ClaudeCliAnalyzerAdapter,
  OllamaAnalyzerAdapter,
  buildAnalyzerPrompt,
  claudeProjectHistoryPath,
  filteredAnalyzerEnv,
  type AnalyzerCommandRunner,
  type AnalyzerCommandRunnerOptions,
} from './index.js';

const tempRoots: string[] = [];

describe('ClaudeCliAnalyzerAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('constructs claude args, filters env, includes transcript and file URLs, and clears project history', async () => {
    const root = await tempRoot();
    const home = path.join(root, 'home');
    const videoPath = path.join(root, 'videos', 'Clip One.mp4');
    const framePaths = [
      path.join(root, 'videos', 'frames', 'frame-001.jpg'),
      path.join(root, 'videos', 'frames', 'frame-002.jpg'),
    ];
    const historyPath = claudeProjectHistoryPath(home, path.dirname(videoPath));
    await mkdir(historyPath, { recursive: true });
    await writeFile(path.join(historyPath, 'conversation.jsonl'), 'old', 'utf8');
    const runner = new FakeAnalyzerCommandRunner('DESCRIPTION: A clip.\nFILENAME: useful-clip');
    const adapter = new ClaudeCliAnalyzerAdapter({
      commandRunner: runner,
      homeDirectory: home,
      env: {
        PATH: '/bin',
        DEBUG: '1',
        CLAUDECODE: '1',
        VSCODE_FOO: '1',
        ELECTRON_RUN_AS_NODE: '1',
      },
    });

    const result = await adapter.analyze({
      videoPath,
      framePaths,
      transcript: 'spoken words',
      backend: 'claude',
      localModel: 'gemma3:12b',
      timeoutSeconds: 120,
    });

    expect(result).toEqual(ok({ rawResponse: 'DESCRIPTION: A clip.\nFILENAME: useful-clip' }));
    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected claude command call');
    expect(call.command).toBe('claude');
    expect(call.args.slice(0, 3)).toEqual(['--add-dir', path.dirname(videoPath), '-p']);
    expect(call.args[3]).toContain('Here is the transcript of the audio');
    expect(call.args[3]).toContain('spoken words');
    expect(call.args[3]).toContain(`file://${framePaths[0]}`);
    expect(call.args[3]).toContain(`file://${framePaths[1]}`);
    expect(call.options.timeoutMs).toBe(120_000);
    expect(call.options.env).toEqual({ PATH: '/bin' });
    expect(existsSync(historyPath)).toBe(false);
  });

  it('passes verbose stdout and stderr through while preserving the no-transcript prompt note', async () => {
    const runner = new FakeAnalyzerCommandRunner('final response');
    runner.onRun = (options) => {
      options.onStdout?.('streamed stdout');
      options.onStderr?.('streamed stderr');
      return Promise.resolve(ok({ stdout: 'final response', stderr: '' }));
    };
    let stdout = '';
    let stderr = '';
    const adapter = new ClaudeCliAnalyzerAdapter({
      commandRunner: runner,
      verbose: true,
      writeStdout: (chunk) => {
        stdout += chunk;
      },
      writeStderr: (chunk) => {
        stderr += chunk;
      },
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frames/frame-001.jpg'],
      transcript: null,
      backend: 'claude',
      localModel: 'gemma3:12b',
      timeoutSeconds: 30,
    });

    expect(result).toEqual(ok({ rawResponse: 'final response' }));
    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected claude command call');
    expect(call.args[3]).toContain('This video has no audio or transcript available.');
    expect(stdout).toContain('streamed stdout');
    expect(stderr).toContain('streamed stderr');
  });
});

describe('OllamaAnalyzerAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('prechecks installed models before calling Ollama', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: [] };
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      baseUrl: 'http://127.0.0.1:1',
      fetchImpl: () => Promise.reject(new Error('fetch should not be called')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame-001.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 300,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'model_not_installed' } });
  });

  it('posts stream:false chat requests with base64 frames and returns raw model text', async () => {
    const root = await tempRoot();
    const frameOne = path.join(root, 'frame-001.jpg');
    const frameTwo = path.join(root, 'frame-002.jpg');
    await writeFile(frameOne, Buffer.from('frame-one'));
    await writeFile(frameTwo, Buffer.from('frame-two'));
    const server = await startFakeOllamaServer({ message: { content: 'DESCRIPTION: Local.\nFILENAME: local-clip' } });
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const adapter = new OllamaAnalyzerAdapter({ runtime, baseUrl: server.origin });

    try {
      const result = await adapter.analyze({
        videoPath: path.join(root, 'Clip One.mp4'),
        framePaths: [frameOne, frameTwo],
        transcript: 'local transcript',
        backend: 'local',
        localModel: 'gemma3:12b',
        timeoutSeconds: 300,
      });

      expect(result).toEqual(ok({ rawResponse: 'DESCRIPTION: Local.\nFILENAME: local-clip' }));
      const request = server.requests[0];
      if (request === undefined) throw new Error('Expected Ollama request');
      const parsed = ollamaChatRequestSchema.parse(request.body);
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/api/chat');
      expect(parsed.stream).toBe(false);
      expect(parsed.model).toBe('gemma3:12b');
      expect(parsed.messages[0]?.content).toContain('local transcript');
      expect(parsed.messages[0]?.images).toEqual([
        Buffer.from('frame-one').toString('base64'),
        Buffer.from('frame-two').toString('base64'),
      ]);
    } finally {
      await server.close();
    }
  });

  it('maps empty Ollama responses to ollama_unavailable', async () => {
    const server = await startFakeOllamaServer({ message: { content: '' } });
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      baseUrl: server.origin,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });

    try {
      const result = await adapter.analyze({
        videoPath: '/work/clip.mp4',
        framePaths: ['/work/frame-001.jpg'],
        transcript: null,
        backend: 'local',
        localModel: 'gemma3:12b',
        timeoutSeconds: 300,
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
    } finally {
      await server.close();
    }
  });
});

describe('analyzer helpers', () => {
  it('filters subprocess env with parity semantics', () => {
    expect(filteredAnalyzerEnv({
      PATH: '/bin',
      NODE_OPTIONS: '--inspect',
      VSCODE_PID: '123',
      VSCODE_CUSTOM: '1',
      CLAUDECODE: '1',
      KEEP_ME: 'yes',
    })).toEqual({ PATH: '/bin', KEEP_ME: 'yes' });
  });

  it('builds local prompts with attached image wording', () => {
    const prompt = buildAnalyzerPrompt({
      videoName: 'Clip.mp4',
      transcript: null,
      framePaths: ['/frame.jpg'],
      frameMode: 'attached-images',
    });

    expect(prompt).toContain('Attached are 1 frame(s) extracted from the video (as images).');
    expect(prompt).toContain('DESCRIPTION: <your 2-3 sentence description here>');
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'analyzer-adapter-'));
  tempRoots.push(root);
  return root;
};

interface AnalyzerCommandCall {
  command: string;
  args: string[];
  options: AnalyzerCommandRunnerOptions;
}

class FakeAnalyzerCommandRunner implements AnalyzerCommandRunner {
  readonly calls: AnalyzerCommandCall[] = [];
  onRun: ((options: AnalyzerCommandRunnerOptions) => Promise<Result<{ stdout: string; stderr: string }, AppError>>) | null = null;

  constructor(private readonly stdout: string) {}

  run(
    command: string,
    args: readonly string[],
    options: AnalyzerCommandRunnerOptions,
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>> {
    this.calls.push({ command, args: [...args], options });
    if (this.onRun !== null) return this.onRun(options);
    return Promise.resolve(ok({ stdout: this.stdout, stderr: '' }));
  }
}

class FakeLocalAiRuntime implements LocalAiRuntimePort {
  machineValue: MachineProfile = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
  statusValue: LocalAiRuntimeStatus = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: [] };

  machine(): Promise<Result<MachineProfile, AppError>> {
    return Promise.resolve(ok(this.machineValue));
  }

  status(): Promise<Result<LocalAiRuntimeStatus, AppError>> {
    return Promise.resolve(ok(this.statusValue));
  }

  pull(tag: string): Promise<Result<{ tag: string; status: 'installed' }, AppError>> {
    return Promise.resolve(ok({ tag, status: 'installed' }));
  }

  rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>> {
    return Promise.resolve(ok({ tag, status: 'removed' }));
  }

  stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>> {
    return Promise.resolve(ok({ stopped: true }));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({
      name: 'ollama',
      available: true,
      version: this.statusValue.runtimeVersion,
      source: 'system',
      path: null,
      installHint: '',
    }));
  }
}

const ollamaChatRequestSchema = z.object({
  model: z.string(),
  stream: z.boolean(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
    images: z.array(z.string()),
  })),
});

const startFakeOllamaServer = async (
  responseBody: unknown,
): Promise<{ origin: string; requests: Array<{ method: string; url: string; body: unknown }>; close: () => Promise<void> }> => {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readRequestBody(request).then((body) => {
      requests.push({ method: request.method ?? '', url: request.url ?? '', body });
      response.setHeader('content-type', 'application/json');
      response.statusCode = 200;
      response.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not expose a TCP port');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
};

const readRequestBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return null;
  return JSON.parse(raw);
};
