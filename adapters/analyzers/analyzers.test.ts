import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  appError,
  builtInHarnessProviders,
  ok,
  type AppError,
  type AnalyzerProviderConfig,
  type MachineProfile,
  type Result,
} from '@core/domain/index.js';
import type { CredentialsStore, DependencyStatus, LocalAiRuntimePort, LocalAiRuntimeStatus } from '@core/server/index.js';

import {
  HarnessAnalyzerAdapter,
  OllamaAnalyzerAdapter,
  OpenAiCompatibleAnalyzerAdapter,
  buildAnalyzerPrompt,
  buildHarnessArgs,
  childProcessAnalyzerCommandRunner,
  claudeProjectHistoryPath,
  expandHarnessArgs,
  filteredAnalyzerEnv,
  type AnalyzerCommandRunner,
  type AnalyzerCommandRunnerOptions,
} from './index.js';

const tempRoots: string[] = [];

describe('HarnessAnalyzerAdapter', () => {
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
    const adapter = new HarnessAnalyzerAdapter({
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
      outputLanguage: 'auto',
      verbose: false,
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
    runner.onRun = (call) => {
      call.options.onStdout?.('streamed stdout');
      call.options.onStderr?.('streamed stderr');
      return Promise.resolve(ok({ stdout: 'final response', stderr: '' }));
    };
    let stdout = '';
    let stderr = '';
    const adapter = new HarnessAnalyzerAdapter({
      commandRunner: runner,
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
      outputLanguage: 'auto',
      verbose: true,
    });

    expect(result).toEqual(ok({ rawResponse: 'final response' }));
    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected claude command call');
    expect(call.args[3]).toContain('This video has no audio or transcript available.');
    expect(stdout).toContain('streamed stdout');
    expect(stderr).toContain('streamed stderr');
  });

  it('passes cancellation to the Claude child process', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const controller = new AbortController();
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner });

    await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'claude',
      localModel: 'unused',
      timeoutSeconds: 30,
      outputLanguage: 'auto',
      verbose: false,
      signal: controller.signal,
    });

    expect(runner.calls[0]?.options.signal).toBe(controller.signal);
  });

  it('maps harness preparation failures to read_error without running the command', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const adapter = new HarnessAnalyzerAdapter({
      commandRunner: runner,
      prepare: () => Promise.reject(new Error('EPERM')),
    });

    const result = await adapter.analyze(analyzeInput(customHarnessProvider()));

    expect(result).toMatchObject({ ok: false, error: { code: 'read_error' } });
    expect(runner.calls).toEqual([]);
  });

  it('constructs every built-in invocation from provider data', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner, resolveCommand: (command) => command });

    for (const descriptor of builtInHarnessProviders()) {
      const provider = {
        family: descriptor.family,
        providerId: descriptor.providerId,
        command: descriptor.command,
        argsTemplate: descriptor.argsTemplate,
        promptStyle: descriptor.promptStyle,
      };
      await adapter.analyze(analyzeInput(provider));
    }

    expect(runner.calls.map(({ command, args }) => ({ command, args: args.slice(0, -1) }))).toEqual([
      { command: 'claude', args: ['--add-dir', '/work/videos', '-p'] },
      { command: 'codex', args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', '/work/videos'] },
      { command: 'cursor-agent', args: ['--print', '--trust', '--mode', 'ask', '--workspace', '/work/videos'] },
    ]);
    expect(runner.calls[0]?.args.at(-1)).toContain('file:///work/videos/frames/frame-001.jpg');
    expect(runner.calls[1]?.args.at(-1)).toContain('Read these 1 frame file(s)');
    expect(runner.calls[2]?.args.at(-1)).toContain('file:///work/videos/frames/frame-001.jpg');
  });

  it('inserts model and effort flags for built-in harnesses before prompt arguments', () => {
    const prompt = 'prompt text';
    const videoDir = '/work/videos';
    const providers = builtInHarnessProviders();
    const claude = providers.find((provider) => provider.providerId === 'claude-code');
    const codex = providers.find((provider) => provider.providerId === 'codex');
    const cursor = providers.find((provider) => provider.providerId === 'cursor-agent');
    if (claude === undefined || codex === undefined || cursor === undefined) {
      throw new Error('Expected built-in harness descriptors');
    }

    expect(buildHarnessArgs({
      ...claude,
      model: 'claude-sonnet-4-20250514',
      reasoningEffort: 'high',
    }, { prompt, videoDir })).toEqual([
      '--add-dir',
      videoDir,
      '--model',
      'claude-sonnet-4-20250514',
      '--effort',
      'high',
      '-p',
      prompt,
    ]);
    expect(buildHarnessArgs({
      ...codex,
      model: 'gpt-5-codex',
      reasoningEffort: 'xhigh',
    }, { prompt, videoDir })).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--cd',
      videoDir,
      '-m',
      'gpt-5-codex',
      '-c',
      'model_reasoning_effort=xhigh',
      prompt,
    ]);
    expect(buildHarnessArgs({
      ...cursor,
      model: 'cursor-large-high',
      reasoningEffort: 'low',
    }, { prompt, videoDir })).toEqual([
      '--print',
      '--trust',
      '--mode',
      'ask',
      '--workspace',
      videoDir,
      '--model',
      'cursor-large-high',
      prompt,
    ]);
  });

  it('drops a cross-provider model id, falls back to the harness default, and warns', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner, resolveCommand: (command) => command });
    const codex = builtInHarnessProviders().find((provider) => provider.providerId === 'codex');
    if (codex === undefined) throw new Error('Expected codex harness descriptor');
    const warnings: string[] = [];

    const result = await adapter.analyze({
      ...analyzeInput({
        family: 'harness',
        providerId: codex.providerId,
        command: codex.command,
        argsTemplate: codex.argsTemplate,
        promptStyle: codex.promptStyle,
        model: 'claude-fable-5',
      }),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(result).toEqual(ok({ rawResponse: 'response' }));
    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected codex command call');
    expect(call.command).toBe('codex');
    expect(call.args).not.toContain('claude-fable-5');
    expect(call.args).not.toContain('-m');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('claude-fable-5');
    expect(warnings[0]).toContain('codex');
  });

  it('keeps a genuine custom model id via the escape hatch', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner, resolveCommand: (command) => command });
    const codex = builtInHarnessProviders().find((provider) => provider.providerId === 'codex');
    if (codex === undefined) throw new Error('Expected codex harness descriptor');
    const warnings: string[] = [];

    await adapter.analyze({
      ...analyzeInput({
        family: 'harness',
        providerId: codex.providerId,
        command: codex.command,
        argsTemplate: codex.argsTemplate,
        promptStyle: codex.promptStyle,
        model: 'gpt-5-codex',
      }),
      onWarning: (warning) => warnings.push(warning),
    });

    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected codex command call');
    expect(call.args).toContain('-m');
    expect(call.args).toContain('gpt-5-codex');
    expect(warnings).toEqual([]);
  });

  it('keeps quotes, command substitutions, and backticks inert inside argument values', async () => {
    const runner = new FakeAnalyzerCommandRunner('response');
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner });
    const videoDir = '/work/videos/quoted "dir" $(touch nope) `touch nope`';
    const provider: Extract<AnalyzerProviderConfig, { family: 'harness' }> = {
      family: 'harness',
      providerId: 'custom-agent',
      command: 'custom-agent',
      argsTemplate: ['run', '--directory={videoDir}', 'PROMPT={prompt}'],
      promptStyle: 'file-urls',
    };

    await adapter.analyze({
      ...analyzeInput(provider),
      videoPath: path.join(videoDir, 'clip "name" $(touch nope) `touch nope`.mp4'),
      framePaths: [path.join(videoDir, 'frames', 'frame-001.jpg')],
      transcript: 'Say "hello" and preserve $(touch nope) plus `touch nope`.',
    });

    const call = runner.calls[0];
    if (call === undefined) throw new Error('Expected custom harness call');
    expect(call.command).toBe('custom-agent');
    expect(call.args).toHaveLength(3);
    expect(call.args[1]).toBe(`--directory=${videoDir}`);
    expect(call.args[2]).toContain('$(touch nope)');
    expect(call.args[2]).toContain('`touch nope`');
    expect(call.args[2]).toContain('file:///work/videos/quoted "dir" $(touch nope) `touch nope`/frames/frame-001.jpg');
  });

  it('expands placeholders inside individual arguments without splitting them', () => {
    expect(expandHarnessArgs(
      ['before:{prompt}:after', '--dir={videoDir}'],
      { prompt: '"quoted" $(inert) `inert`', videoDir: '/video dir' },
    )).toEqual(['before:"quoted" $(inert) `inert`:after', '--dir=/video dir']);
  });

  it('detects custom harness availability with the configured binary version', async () => {
    const runner = new FakeAnalyzerCommandRunner('custom-agent 4.2.0\n');
    const adapter = new HarnessAnalyzerAdapter({
      commandRunner: runner,
      env: { PATH: '/custom/bin', NODE_OPTIONS: '--inspect' },
    });
    const provider = customHarnessProvider();

    const result = await adapter.test(provider);

    expect(result).toMatchObject({
      ok: true,
      value: { family: 'harness', providerId: 'custom-agent', available: true, version: 'custom-agent 4.2.0' },
    });
    expect(runner.calls[0]).toMatchObject({
      command: 'custom-agent',
      args: ['--version'],
      options: { env: { PATH: '/custom/bin' }, timeoutMs: 5000 },
    });
  });

  it('reports why a configured harness binary is unavailable', async () => {
    const runner = new FakeAnalyzerCommandRunner('');
    runner.onRun = () => Promise.resolve({
      ok: false,
      error: appError('processing_error', 'spawn custom-agent ENOENT'),
    });
    const adapter = new HarnessAnalyzerAdapter({ commandRunner: runner });

    const result = await adapter.test(customHarnessProvider());

    expect(result).toMatchObject({
      ok: true,
      value: {
        family: 'harness',
        providerId: 'custom-agent',
        available: false,
        version: null,
        message: 'spawn custom-agent ENOENT',
      },
    });
  });

  it.each(['timeout', 'cancel'] as const)('kills the harness process group on %s', async (cause) => {
    const controller = new AbortController();
    let childReady = false;
    const pending = childProcessAnalyzerCommandRunner.run(process.execPath, processGroupFixtureArgs(), {
      env: process.env,
      timeoutMs: cause === 'timeout' ? 500 : 5000,
      signal: controller.signal,
      onStdout: (chunk) => {
        if (cause === 'cancel' && !childReady && chunk.includes('CHILD_READY')) {
          childReady = true;
          controller.abort();
        }
      },
    });

    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(cause === 'timeout' ? 'timed out' : 'cancelled') },
    });
  }, 7000);
});

describe('OllamaAnalyzerAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('reports the configured local model as missing until it is installed', async () => {
    const runtime = new FakeLocalAiRuntime();
    const adapter = new OllamaAnalyzerAdapter({ runtime });
    const provider = { family: 'local', providerId: 'local', modelTag: 'gemma3:12b' } as const;

    const missing = await adapter.dependency({ backend: 'local', provider });
    runtime.statusValue = {
      runtimeUp: true,
      runtimeVersion: '1.0.0',
      installedModels: ['gemma3:12b'],
    };
    const ready = await adapter.dependency({ backend: 'local', provider });

    expect(missing).toMatchObject({
      ok: true,
      value: {
        name: 'gemma3:12b',
        available: false,
        installHint: 'Download the model. Run: ai-video-cataloger models pull gemma3:12b',
      },
    });
    expect(ready).toMatchObject({ ok: true, value: { available: true } });
  });

  it('tests local connectivity without starting the managed runtime', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: false, runtimeVersion: '', installedModels: [] };
    const adapter = new OllamaAnalyzerAdapter({ runtime });
    const provider = { family: 'local', providerId: 'local', modelTag: 'gemma3:12b' } as const;

    const result = await adapter.test(provider);

    expect(result).toMatchObject({
      ok: true,
      value: {
        runtimeAvailable: false,
        modelAvailable: false,
        message: expect.stringContaining('starts on demand'),
      },
    });
    expect(runtime.ensureSignals).toEqual([]);
  });

  it('keeps local readiness available for a manifest-backed model while the runtime is down', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = {
      runtimeUp: false,
      runtimeVersion: '1.0.0',
      installedModels: ['gemma3:12b'],
    };
    const adapter = new OllamaAnalyzerAdapter({ runtime });
    const provider = { family: 'local', providerId: 'local', modelTag: 'gemma3:12b' } as const;

    const result = await adapter.dependency({ backend: 'local', provider });

    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'ollama',
        available: true,
      },
    });
  });

  it('prechecks installed models before calling Ollama', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: [] };
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl: () => Promise.reject(new Error('fetch should not be called')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame-001.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 300,
      outputLanguage: 'auto',
      verbose: false,
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
    runtime.baseUrl = server.origin;
    const adapter = new OllamaAnalyzerAdapter({ runtime, fetchImpl: server.fetchImpl });

    try {
      const result = await adapter.analyze({
        videoPath: path.join(root, 'Clip One.mp4'),
        framePaths: [frameOne, frameTwo],
        transcript: 'local transcript',
        backend: 'local',
        localModel: 'gemma3:12b',
        timeoutSeconds: 300,
        outputLanguage: 'auto',
        verbose: false,
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
      expect(runtime.ensureSignals).toEqual([undefined]);
    } finally {
      await server.close();
    }
  });

  it('maps empty Ollama responses to ollama_unavailable', async () => {
    const server = await startFakeOllamaServer({ message: { content: '' } });
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    runtime.baseUrl = server.origin;
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl: server.fetchImpl,
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
        outputLanguage: 'auto',
        verbose: false,
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'ollama_unavailable' } });
    } finally {
      await server.close();
    }
  });

  it('maps unreadable local-analysis frames to read_error without making a chat request', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl,
      readFrame: () => Promise.reject(new Error('ENOENT')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/missing.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 300,
      outputLanguage: 'auto',
      verbose: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'read_error' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('includes the Ollama error body in non-model HTTP failures', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl: () => Promise.resolve(new Response('images are not supported by this model', { status: 400 })),
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 300,
      outputLanguage: 'auto',
      verbose: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ollama_unavailable', message: expect.stringContaining('HTTP 400: images are not supported by this model') },
    });
  });

  it('aborts the Ollama chat request when analysis is cancelled', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const requestSignals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        reject(new Error('Missing request signal'));
        return;
      }
      requestSignals.push(signal);
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });
    const controller = new AbortController();
    const analyzing = adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 300,
      outputLanguage: 'auto',
      verbose: false,
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    const result = await analyzing;

    expect(requestSignals[0]?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { code: 'processing_error', message: 'Local analysis cancelled' } });
    expect(runtime.ensureSignals).toEqual([controller.signal]);
  });

  it('reports a local chat timeout separately from an unreachable runtime', async () => {
    const runtime = new FakeLocalAiRuntime();
    runtime.statusValue = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: ['gemma3:12b'] };
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        reject(new Error('Missing signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
    });
    const adapter = new OllamaAnalyzerAdapter({
      runtime,
      fetchImpl,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'local',
      localModel: 'gemma3:12b',
      timeoutSeconds: 0.01,
      outputLanguage: 'auto',
      verbose: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_error', message: 'Local AI request timed out' } });
  });
});

describe('OpenAiCompatibleAnalyzerAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('posts OpenAI vision chat-completions with transcript and base64 image parts', async () => {
    const root = await tempRoot();
    const frameOne = path.join(root, 'frame-001.jpg');
    const frameTwo = path.join(root, 'frame-002.png');
    await writeFile(frameOne, Buffer.from('jpeg-frame'));
    await writeFile(frameTwo, Buffer.from('png-frame'));
    const server = await startFakeApiServer(200, {
      choices: [{ message: { content: 'DESCRIPTION: API clip.\nFILENAME: api-clip' } }],
    });
    const adapter = new OpenAiCompatibleAnalyzerAdapter({
      credentials: new FakeCredentialsStore('top-secret'),
      fetchImpl: server.fetchImpl,
    });

    try {
      const result = await adapter.analyze({
        videoPath: path.join(root, 'Clip.mp4'),
        framePaths: [frameOne, frameTwo],
        transcript: 'spoken transcript',
        backend: 'claude',
        localModel: 'unused',
        provider: apiProvider(server.origin),
        timeoutSeconds: 30,
        outputLanguage: 'auto',
        verbose: false,
      });

      expect(result).toEqual(ok({ rawResponse: 'DESCRIPTION: API clip.\nFILENAME: api-clip' }));
      const request = server.requests[0];
      if (request === undefined) throw new Error('Expected API request');
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.authorization).toBe('Bearer top-secret');
      const parsed = apiChatRequestSchema.parse(request.body);
      expect(parsed.model).toBe('vision-model');
      expect(parsed.messages[0]?.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('spoken transcript') });
      expect(parsed.messages[0]?.content[1]).toEqual({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${Buffer.from('jpeg-frame').toString('base64')}`, detail: 'high' },
      });
      expect(parsed.messages[0]?.content[2]).toEqual({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from('png-frame').toString('base64')}`, detail: 'high' },
      });
      expect(parsed.messages[0]?.content[0]).toMatchObject({ text: expect.stringContaining('DESCRIPTION:') });
      expect(parsed.messages[0]?.content[0]).toMatchObject({ text: expect.stringContaining('FILENAME:') });
    } finally {
      await server.close();
    }
  });

  it.each([
    [401, 'provider_auth_failed'],
    [429, 'rate_limited'],
    [400, 'provider_error'],
    [500, 'provider_error'],
  ])('maps HTTP %i to %s without leaking credentials', async (status, code) => {
    const server = await startFakeApiServer(status, { error: 'failure top-secret' }, { 'retry-after': '2' });
    const adapter = new OpenAiCompatibleAnalyzerAdapter({
      credentials: new FakeCredentialsStore('top-secret'),
      fetchImpl: server.fetchImpl,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });
    try {
      const result = await adapter.analyze({
        videoPath: '/work/clip.mp4',
        framePaths: ['/work/frame.jpg'],
        transcript: null,
        backend: 'claude',
        localModel: 'unused',
        provider: apiProvider(server.origin),
        timeoutSeconds: 30,
        outputLanguage: 'auto',
        verbose: false,
      });
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain('top-secret');
      if (status === 429) expect(JSON.stringify(result)).toContain('Retry after 2 seconds');
    } finally {
      await server.close();
    }
  });

  it('honors cancellation through the request AbortSignal', async () => {
    const server = await startFakeApiServer(200, { choices: [] }, {}, 10_000);
    const adapter = new OpenAiCompatibleAnalyzerAdapter({
      credentials: new FakeCredentialsStore('top-secret'),
      fetchImpl: server.fetchImpl,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });
    const controller = new AbortController();
    const analyzing = adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'claude',
      localModel: 'unused',
      provider: apiProvider(server.origin),
      timeoutSeconds: 30,
      outputLanguage: 'auto',
      verbose: false,
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    controller.abort();

    expect(await analyzing).toMatchObject({ ok: false, error: { code: 'processing_error', message: 'API analysis cancelled' } });
    await server.close();
  });

  it('honors the configured request timeout', async () => {
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        reject(new Error('Missing signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
    });
    const adapter = new OpenAiCompatibleAnalyzerAdapter({
      credentials: new FakeCredentialsStore('top-secret'),
      fetchImpl,
      readFrame: () => Promise.resolve(Buffer.from('frame')),
    });

    const result = await adapter.analyze({
      videoPath: '/work/clip.mp4',
      framePaths: ['/work/frame.jpg'],
      transcript: null,
      backend: 'claude',
      localModel: 'unused',
      provider: apiProvider('https://provider.example'),
      timeoutSeconds: 0.01,
      outputLanguage: 'auto',
      verbose: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_error', message: 'API provider request timed out' } });
  });

  it('reports missing credentials as unavailable with actionable readiness guidance', async () => {
    const adapter = new OpenAiCompatibleAnalyzerAdapter({ credentials: new FakeCredentialsStore(null) });

    const result = await adapter.dependency({ backend: 'claude', provider: apiProvider('https://provider.example') });

    expect(result).toEqual(ok({
      name: 'compatible',
      available: false,
      version: null,
      source: null,
      path: null,
      installHint: 'Run: ai-video-cataloger config set-credential compatible',
    }));
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
      outputLanguage: 'auto',
    });

    expect(prompt).toContain('Attached are 1 frame(s) extracted from the video (as images).');
    expect(prompt).toContain('DESCRIPTION: <text>');
  });

  it('omits any language directive when the output language is auto', () => {
    const prompt = buildAnalyzerPrompt({
      videoName: 'Clip.mp4',
      transcript: null,
      framePaths: ['/frame.jpg'],
      frameMode: 'attached-images',
      outputLanguage: 'auto',
    });

    expect(prompt).not.toContain('Write the DESCRIPTION');
  });

  it('instructs the model to write description and filename in the configured language while keeping tags in English', () => {
    const polish = buildAnalyzerPrompt({
      videoName: 'Clip.mp4',
      transcript: null,
      framePaths: ['/frame.jpg'],
      frameMode: 'attached-images',
      outputLanguage: 'pl',
    });
    const custom = buildAnalyzerPrompt({
      videoName: 'Clip.mp4',
      transcript: null,
      framePaths: ['/frame.jpg'],
      frameMode: 'attached-images',
      outputLanguage: 'pt-BR',
    });

    expect(polish).toContain('Write the DESCRIPTION and the FILENAME in Polish.');
    expect(polish).toContain('Keep the TAGS in ASCII kebab-case English');
    expect(custom).toContain('Write the DESCRIPTION and the FILENAME in pt-BR.');
  });
});

const analyzeInput = (provider: Extract<AnalyzerProviderConfig, { family: 'harness' }>) => ({
  videoPath: '/work/videos/clip.mp4',
  framePaths: ['/work/videos/frames/frame-001.jpg'],
  transcript: 'transcript',
  backend: 'claude' as const,
  localModel: 'unused',
  provider,
  timeoutSeconds: 30,
  outputLanguage: 'auto',
  verbose: false,
});

const customHarnessProvider = (): Extract<AnalyzerProviderConfig, { family: 'harness' }> => ({
  family: 'harness',
  providerId: 'custom-agent',
  command: 'custom-agent',
  argsTemplate: ['run', '{prompt}'],
  promptStyle: 'dir-access',
});

const processGroupFixtureArgs = (): string[] => [
  '-e',
  [
    "const { spawn } = require('node:child_process')",
    "process.on('SIGTERM', () => {})",
    "spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); process.stdout.write('CHILD_READY\\\\n'); setInterval(() => {}, 1000)\"], { stdio: 'inherit' })",
    'setInterval(() => {}, 1000)',
  ].join(';'),
];

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
  onRun: ((call: AnalyzerCommandCall) => Promise<Result<{ stdout: string; stderr: string }, AppError>>) | null = null;

  constructor(private readonly stdout: string) {}

  run(
    command: string,
    args: readonly string[],
    options: AnalyzerCommandRunnerOptions,
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>> {
    const call = { command, args: [...args], options };
    this.calls.push(call);
    if (this.onRun !== null) return this.onRun(call);
    return Promise.resolve(ok({ stdout: this.stdout, stderr: '' }));
  }
}

class FakeLocalAiRuntime implements LocalAiRuntimePort {
  machineValue: MachineProfile = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
  statusValue: LocalAiRuntimeStatus = { runtimeUp: true, runtimeVersion: '1.0.0', installedModels: [] };
  baseUrl = 'http://127.0.0.1:11434';
  ensureSignals: Array<AbortSignal | undefined> = [];

  machine(): Promise<Result<MachineProfile, AppError>> {
    return Promise.resolve(ok(this.machineValue));
  }

  status(): Promise<Result<LocalAiRuntimeStatus, AppError>> {
    return Promise.resolve(ok(this.statusValue));
  }

  ensure(signal?: AbortSignal): Promise<Result<{ baseUrl: string }, AppError>> {
    this.ensureSignals.push(signal);
    return Promise.resolve(ok({ baseUrl: this.baseUrl }));
  }

  async pull(
    tag: string,
    options?: { onRuntimeReady?: (() => Promise<Result<void, AppError>>) | undefined },
  ): Promise<Result<{ tag: string; status: 'installed' }, AppError>> {
    const ready = await options?.onRuntimeReady?.();
    if (ready !== undefined && !ready.ok) return ready;
    return ok({ tag, status: 'installed' });
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

const apiChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('image_url'),
        image_url: z.object({ url: z.string(), detail: z.string() }),
      }),
    ])),
  })),
});

const apiProvider = (origin: string) => ({
  family: 'api',
  providerId: 'compatible',
  baseUrl: `${origin}/v1`,
  apiKeyRef: 'compatible',
  model: 'vision-model',
  maxImageDetail: 'high',
} as const);

class FakeCredentialsStore implements CredentialsStore {
  constructor(private readonly value: string | null) {}

  get(): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.value));
  }

  set(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }
}

const startFakeApiServer = async (
  status: number,
  responseBody: unknown,
  headers: Record<string, string> = {},
  delayMs = 0,
): Promise<{
  origin: string;
  requests: Array<{ url: string; authorization: string | undefined; body: unknown }>;
  fetchImpl: typeof fetch;
  close: () => Promise<void>;
}> => {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const origin = 'https://fake-api.example';
  let closed = false;
  const fetchImpl: typeof fetch = (input, init) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error('Fake API server is closed'));
      return;
    }
    const url = new URL(input instanceof Request ? input.url : String(input));
    const requestHeaders = new Headers(init?.headers);
    requests.push({
      url: `${url.pathname}${url.search}`,
      authorization: requestHeaders.get('authorization') ?? undefined,
      body: init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body)),
    });
    const signal = init?.signal;
    const timer = setTimeout(() => {
      resolve(new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }));
    }, delayMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
  return {
    origin,
    requests,
    fetchImpl,
    close: async () => {
      closed = true;
    },
  };
};

const startFakeOllamaServer = async (
  responseBody: unknown,
): Promise<{
  origin: string;
  requests: Array<{ method: string; url: string; body: unknown }>;
  fetchImpl: typeof fetch;
  close: () => Promise<void>;
}> => {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const origin = 'http://fake-ollama.example';
  let closed = false;
  const fetchImpl: typeof fetch = (input, init) => {
    if (closed) return Promise.reject(new Error('Fake Ollama server is closed'));
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({
      method: init?.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      body: init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body)),
    });
    return Promise.resolve(new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  };
  return {
    origin,
    requests,
    fetchImpl,
    close: async () => {
      closed = true;
    },
  };
};
