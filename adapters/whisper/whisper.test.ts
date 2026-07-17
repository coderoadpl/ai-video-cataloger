import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReadStream } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import {
  HuggingFaceWhisperModelDownloader,
  WhisperTranscriberAdapter,
  directModelPath,
  legacyModelPath,
  primaryModelPath,
  resolveWhisperBinary,
  whisperModelDownloadUrl,
  type CommandRunner,
  type WhisperApiClient,
} from './index.js';

const tempRoots: string[] = [];

const requiredArg = (args: readonly string[], index: number): string => {
  const value = args[index];
  if (value === undefined) throw new Error(`Missing argument at index ${String(index)}`);
  return value;
};

const writeWhisperOutput = async (args: readonly string[], content: string): Promise<void> => {
  const outputPrefix = requiredArg(args, args.indexOf('-of') + 1);
  await mkdir(path.dirname(outputPrefix), { recursive: true });
  await writeFile(`${outputPrefix}.txt`, content, 'utf8');
};

const writeOpenAiWhisperOutput = async (args: readonly string[], content: string): Promise<void> => {
  const audioPath = requiredArg(args, 0);
  const outputDirectory = requiredArg(args, args.indexOf('--output_dir') + 1);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, `${path.basename(audioPath, path.extname(audioPath))}.txt`), content, 'utf8');
};

describe('WhisperTranscriberAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('prefers bundled whisper before probing system whisper', async () => {
    const runner = new FakeCommandRunner();
    const resolved = await resolveWhisperBinary({ bundledWhisperPath: () => '/home/.ai-video-cataloger/bin/whisper' }, runner);

    expect(resolved).toEqual({
      path: '/home/.ai-video-cataloger/bin/whisper',
      source: 'bundled',
      available: true,
    });
    expect(runner.commands).toEqual([]);
  });

  it('falls back to system whisper when bundled whisper is absent', async () => {
    const runner = new FakeCommandRunner({ whisper: 'whisper 1.2.3' });
    const resolved = await resolveWhisperBinary({ bundledWhisperPath: () => null }, runner);

    expect(resolved).toEqual({ path: 'whisper', source: 'system', available: true });
    expect(runner.commands).toEqual([{ command: 'whisper', args: ['--help'] }]);
  });

  it('constructs the local whisper command and reads the transcript file', async () => {
    const root = await tempRoot();
    const transcriptPath = path.join(root, 'transcripts', 'Clip One.txt');
    const runner = new FakeCommandRunner({ '/bundled/whisper': 'whisper installed' });
    runner.onRun = async (command, args) => {
      if (command === '/bundled/whisper' && args[0] !== '--help') {
        await writeWhisperOutput(args, ' hello transcript \n');
      }
      return ok({ stdout: '', stderr: '' });
    };
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    const result = await adapter.transcribe({
      audioPath: path.join(root, 'audio', 'Clip One.wav'),
      transcriptPath,
      mode: 'local',
      model: 'base',
    });

    expect(result).toEqual(ok({ transcriptPath, content: 'hello transcript' }));
    expect(runner.commands).toContainEqual({
      command: '/bundled/whisper',
      args: [
        '-m',
        path.join(root, '.ai-video-cataloger', 'models', 'whisper', 'ggml-base.bin'),
        '-f',
        path.join(root, 'audio', 'Clip One.wav'),
        '-otxt',
        '-of',
        transcriptPath.slice(0, -4),
        '--no-prints',
      ],
    });
  });

  it('transcribes with a direct-layout whisper.cpp model when the GGML-prefixed path is absent', async () => {
    const root = await tempRoot();
    const transcriptPath = path.join(root, 'transcripts', 'Clip One.txt');
    const directPath = directModelPath(root, 'small');
    await mkdir(path.dirname(directPath), { recursive: true });
    await writeFile(directPath, 'model', 'utf8');
    const runner = new FakeCommandRunner({ '/bundled/whisper': 'whisper installed' });
    runner.onRun = async (command, args) => {
      if (command === '/bundled/whisper' && args[0] !== '--help') await writeWhisperOutput(args, 'direct model transcript\n');
      return ok({ stdout: '', stderr: '' });
    };
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    const result = await adapter.transcribe({
      audioPath: path.join(root, 'audio.wav'),
      transcriptPath,
      mode: 'local',
      model: 'small',
    });

    expect(result).toEqual(ok({ transcriptPath, content: 'direct model transcript' }));
    const run = runner.commands.find((entry) => entry.command === '/bundled/whisper' && entry.args[0] !== '--help');
    expect(run?.args[run.args.indexOf('-m') + 1]).toBe(directPath);
  });

  it('relocates the whisper output when the temp audio name differs from the transcript name', async () => {
    const root = await tempRoot();
    const transcriptPath = path.join(root, 'transcripts', 'Clip One.txt');
    const runner = new FakeCommandRunner({ '/bundled/whisper': 'whisper installed' });
    runner.onRun = async (command, args) => {
      if (command === '/bundled/whisper' && args[0] !== '--help') {
        await writeWhisperOutput(args, 'hashed audio transcript\n');
      }
      return ok({ stdout: '', stderr: '' });
    };
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    const result = await adapter.transcribe({
      audioPath: path.join(root, 'audio', 'f1abec7d-Clip One.wav'),
      transcriptPath,
      mode: 'local',
      model: 'base',
    });

    expect(result).toEqual(ok({ transcriptPath, content: 'hashed audio transcript' }));
    expect(existsSync(path.join(root, 'transcripts', 'f1abec7d-Clip One.txt'))).toBe(false);
    expect(existsSync(transcriptPath)).toBe(true);
  });

  it('uses the OpenAI Whisper CLI dialect for the system fallback', async () => {
    const root = await tempRoot();
    const audioPath = path.join(root, 'audio', 'f1abec7d-Clip One.wav');
    const transcriptPath = path.join(root, 'transcripts', 'Clip One.txt');
    const runner = new FakeCommandRunner({ whisper: 'usage: whisper [--model MODEL] audio [audio ...]' });
    runner.onRun = async (command, args) => {
      if (command === 'whisper' && args[0] !== '--help') {
        await writeOpenAiWhisperOutput(args, ' system transcript \n');
      }
      return ok({ stdout: '', stderr: '' });
    };
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => null },
    });

    const result = await adapter.transcribe({
      audioPath,
      transcriptPath,
      mode: 'local',
      model: 'base',
    });

    expect(result).toEqual(ok({ transcriptPath, content: 'system transcript' }));
    expect(runner.commands).toContainEqual({
      command: 'whisper',
      args: [
        audioPath,
        '--model',
        'base',
        '--output_dir',
        path.dirname(transcriptPath),
        '--output_format',
        'txt',
      ],
    });
    expect(existsSync(path.join(root, 'transcripts', 'f1abec7d-Clip One.txt'))).toBe(false);
  });

  it('does not accept an OpenAI Whisper cache file for a whisper.cpp runtime', async () => {
    const root = await tempRoot();
    const cachedPath = legacyModelPath(root, 'medium');
    await mkdir(path.dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, 'model', 'utf8');
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    const result = await adapter.dependency({ mode: 'local', model: 'medium' });

    expect(result).toMatchObject({
      ok: true,
      value: { name: 'whisper-medium', available: false, path: primaryModelPath(root, 'medium') },
    });
  });

  it('retries a failed whisper.cpp run once with --no-gpu', async () => {
    const root = await tempRoot();
    const transcriptPath = path.join(root, 'transcripts', 'Clip One.txt');
    const runner = new FakeCommandRunner({ '/bundled/whisper': 'whisper installed' });
    runner.onRun = async (command, args) => {
      if (command !== '/bundled/whisper' || args[0] === '--help') return ok({ stdout: '', stderr: '' });
      if (!args.includes('--no-gpu')) {
        return { ok: false, error: appError('processing_error', 'ggml_metal_buffer_init: failed to allocate buffer') };
      }
      await writeWhisperOutput(args, 'cpu transcript\n');
      return ok({ stdout: '', stderr: '' });
    };
    const adapter = new WhisperTranscriberAdapter({
      homeDirectory: root,
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    const result = await adapter.transcribe({
      audioPath: path.join(root, 'audio', 'Clip One.wav'),
      transcriptPath,
      mode: 'local',
      model: 'base',
    });

    expect(result).toEqual(ok({ transcriptPath, content: 'cpu transcript' }));
    const whisperRuns = runner.commands.filter((entry) => entry.command === '/bundled/whisper' && entry.args[0] !== '--help');
    expect(whisperRuns).toHaveLength(2);
    expect(whisperRuns[1]?.args).toContain('--no-gpu');
  });

  it('passes cancellation to the local whisper process', async () => {
    const root = await tempRoot();
    const runner = new FakeCommandRunner({ '/bundled/whisper': 'whisper installed' });
    const controller = new AbortController();
    runner.onRun = () => Promise.resolve({
      ok: false,
      error: appError('processing_error', 'cancelled'),
    });
    const adapter = new WhisperTranscriberAdapter({
      commandRunner: runner,
      binaryResolver: { bundledWhisperPath: () => '/bundled/whisper' },
    });

    await adapter.transcribe({
      audioPath: path.join(root, 'audio.wav'),
      transcriptPath: path.join(root, 'transcript.txt'),
      mode: 'local',
      model: 'base',
      signal: controller.signal,
    });

    expect(runner.signals.at(-1)).toBe(controller.signal);
  });

  it('uses OpenAI whisper-1 and writes trimmed API transcripts', async () => {
    const root = await tempRoot();
    const audioPath = path.join(root, 'audio.wav');
    const transcriptPath = path.join(root, 'transcripts', 'audio.txt');
    await writeFile(audioPath, 'audio', 'utf8');
    const apiClient = new FakeWhisperApiClient(' api transcript \n');
    const adapter = new WhisperTranscriberAdapter({ apiKey: 'key', apiClient });

    const result = await adapter.transcribe({ audioPath, transcriptPath, mode: 'api', model: 'small' });

    expect(result).toEqual(ok({ transcriptPath, content: 'api transcript' }));
    expect(await readFile(transcriptPath, 'utf8')).toBe('api transcript');
    expect(apiClient.calls).toHaveLength(1);
    expect(apiClient.calls[0]?.model).toBe('whisper-1');
    expect(apiClient.calls[0]?.file).toBeInstanceOf(ReadStream);
  });

  it('uses the stored OpenAI credential when the environment key is absent', async () => {
    const root = await tempRoot();
    const audioPath = path.join(root, 'audio.wav');
    const transcriptPath = path.join(root, 'transcripts', 'audio.txt');
    await writeFile(audioPath, 'audio', 'utf8');
    const apiClient = new FakeWhisperApiClient('stored credential transcript');
    const credentials = {
      get: (providerId: string) => Promise.resolve(ok(providerId === 'openai' ? 'stored-key' : null)),
      set: () => Promise.resolve(ok(undefined)),
    };
    const adapter = new WhisperTranscriberAdapter({ apiKey: '', apiClient, credentials });

    const dependency = await adapter.dependency({ mode: 'api', model: 'base' });
    const result = await adapter.transcribe({ audioPath, transcriptPath, mode: 'api', model: 'base' });

    expect(dependency).toMatchObject({ ok: true, value: { available: true } });
    expect(result).toEqual(ok({ transcriptPath, content: 'stored credential transcript' }));
  });

  it('maps OpenAI API status errors to the app taxonomy', async () => {
    const root = await tempRoot();
    const audioPath = path.join(root, 'audio.wav');
    await writeFile(audioPath, 'audio', 'utf8');

    await expect(apiFailureStatus(audioPath, 401)).resolves.toMatchObject({ ok: false, error: { code: 'missing_api_key' } });
    await expect(apiFailureStatus(audioPath, 429)).resolves.toMatchObject({ ok: false, error: { code: 'processing_error' } });
    await expect(apiFailureStatus(audioPath, 413)).resolves.toMatchObject({ ok: false, error: { code: 'processing_error' } });
  });

  it('implements skip mode without touching command or API dependencies', async () => {
    const runner = new FakeCommandRunner();
    const apiClient = new FakeWhisperApiClient('unused');
    const adapter = new WhisperTranscriberAdapter({ commandRunner: runner, apiClient });

    const result = await adapter.transcribe({
      audioPath: '/tmp/audio.wav',
      transcriptPath: '/tmp/transcript.txt',
      mode: 'skip',
      model: 'tiny',
    });

    expect(result).toEqual(ok({ transcriptPath: '/tmp/transcript.txt', content: '' }));
    expect(runner.commands).toEqual([]);
    expect(apiClient.calls).toEqual([]);
  });
});

describe('HuggingFaceWhisperModelDownloader', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('constructs Hugging Face GGML model URLs and local parity paths', async () => {
    const home = await tempRoot();
    const downloader = new HuggingFaceWhisperModelDownloader({ homeDirectory: home });

    expect(whisperModelDownloadUrl('large-v3')).toBe('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin');
    expect(downloader.whisperModelPath('base')).toBe(path.join(home, '.ai-video-cataloger', 'models', 'whisper', 'ggml-base.bin'));
  });

  it('downloads through a temp file, verifies sha256, then renames to the final model path', async () => {
    const home = await tempRoot();
    const body = Buffer.from('model-data');
    const checksum = createHash('sha256').update(body).digest('hex');
    const fake = await startFakeModelServer(body, checksum);
    const progress: Array<{ downloadedBytes: number; percentage: number | null }> = [];
    let now = 0;
    const downloader = new HuggingFaceWhisperModelDownloader({
      homeDirectory: home,
      urlForModel: (model) => `${fake.origin}/ggml-${model}.bin`,
      nowMs: () => {
        now += 500;
        return now;
      },
      onProgress: (event) => progress.push({ downloadedBytes: event.downloadedBytes, percentage: event.percentage }),
    });

    try {
      const result = await downloader.downloadWhisperModel('base', { force: false });

      expect(result).toEqual(ok({
        model: 'base',
        path: primaryModelPath(home, 'base'),
        downloaded: true,
        skipped: false,
        sizeBytes: body.length,
      }));
      expect(await readFile(primaryModelPath(home, 'base'), 'utf8')).toBe('model-data');
      expect(existsSync(`${primaryModelPath(home, 'base')}.tmp`)).toBe(false);
      expect(fake.requests).toEqual([
        { method: 'HEAD', url: '/ggml-base.bin' },
        { method: 'GET', url: '/ggml-base.bin' },
      ]);
      expect(progress.at(-1)).toEqual({ downloadedBytes: body.length, percentage: 100 });
    } finally {
      await fake.close();
    }
  });

  it('deletes the temp file and keeps the final path absent on checksum mismatch', async () => {
    const home = await tempRoot();
    const fake = await startFakeModelServer(Buffer.from('model-data'), '0'.repeat(64));
    const downloader = new HuggingFaceWhisperModelDownloader({
      homeDirectory: home,
      urlForModel: (model) => `${fake.origin}/ggml-${model}.bin`,
    });

    try {
      const result = await downloader.downloadWhisperModel('small', { force: false });

      expect(result).toMatchObject({ ok: false, error: { code: 'download_error' } });
      expect(existsSync(primaryModelPath(home, 'small'))).toBe(false);
      expect(existsSync(`${primaryModelPath(home, 'small')}.tmp`)).toBe(false);
    } finally {
      await fake.close();
    }
  });

  it('skips existing downloads unless force is requested', async () => {
    const home = await tempRoot();
    await mkdir(path.dirname(primaryModelPath(home, 'tiny')), { recursive: true });
    await writeFile(primaryModelPath(home, 'tiny'), 'existing', 'utf8');
    const fake = await startFakeModelServer(Buffer.from('new'), createHash('sha256').update('new').digest('hex'));
    const downloader = new HuggingFaceWhisperModelDownloader({
      homeDirectory: home,
      urlForModel: (model) => `${fake.origin}/ggml-${model}.bin`,
    });

    try {
      const skipped = await downloader.downloadWhisperModel('tiny', { force: false });
      const forced = await downloader.downloadWhisperModel('tiny', { force: true });

      expect(skipped).toEqual(ok({ model: 'tiny', path: primaryModelPath(home, 'tiny'), downloaded: false, skipped: true }));
      expect(forced).toMatchObject({ ok: true, value: { downloaded: true, skipped: false, sizeBytes: 3 } });
      expect(await readFile(primaryModelPath(home, 'tiny'), 'utf8')).toBe('new');
    } finally {
      await fake.close();
    }
  });

  it('detects primary, direct, and legacy model locations in temp homes', async () => {
    await expect(statusForPath(primaryModelPath, 'base')).resolves.toBe(true);
    await expect(statusForPath(directModelPath, 'small')).resolves.toBe(true);
    await expect(statusForPath(legacyModelPath, 'medium')).resolves.toBe(true);

    const home = await tempRoot();
    const downloader = new HuggingFaceWhisperModelDownloader({ homeDirectory: home });
    await expect(downloader.isWhisperModelDownloaded('large-v3')).resolves.toEqual(ok(false));
  });

  it('deletes only the primary GGML model path', async () => {
    const home = await tempRoot();
    await mkdir(path.dirname(primaryModelPath(home, 'base')), { recursive: true });
    await writeFile(primaryModelPath(home, 'base'), 'model', 'utf8');
    const downloader = new HuggingFaceWhisperModelDownloader({ homeDirectory: home });

    const deleted = await downloader.deleteWhisperModel('base', { force: true });

    expect(deleted).toEqual(ok({ model: 'base', path: primaryModelPath(home, 'base'), deleted: true }));
    expect(existsSync(primaryModelPath(home, 'base'))).toBe(false);
  });
});

const apiFailureStatus = async (audioPath: string, status: number): Promise<Result<{ transcriptPath: string; content: string }, AppError>> => {
  const adapter = new WhisperTranscriberAdapter({
    apiKey: 'key',
    apiClient: {
      createTranscription: () => Promise.reject(new ApiStatusError(status)),
    },
  });
  return adapter.transcribe({
    audioPath,
    transcriptPath: path.join(path.dirname(audioPath), `${status}.txt`),
    mode: 'api',
    model: 'base',
  });
};

const statusForPath = async (
  pathForModel: (homeDirectory: string, model: 'base' | 'small' | 'medium') => string,
  model: 'base' | 'small' | 'medium',
): Promise<boolean> => {
  const home = await tempRoot();
  await mkdir(path.dirname(pathForModel(home, model)), { recursive: true });
  await writeFile(pathForModel(home, model), 'model', 'utf8');
  const downloader = new HuggingFaceWhisperModelDownloader({ homeDirectory: home });
  const result = await downloader.isWhisperModelDownloaded(model);
  return result.ok ? result.value : false;
};

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'whisper-adapter-'));
  tempRoots.push(root);
  return root;
};

class FakeCommandRunner implements CommandRunner {
  readonly commands: Array<{ command: string; args: string[] }> = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  onRun: ((command: string, args: readonly string[]) => Promise<Result<{ stdout: string; stderr: string }, AppError>>) | null = null;

  constructor(private readonly stdoutByCommand: Record<string, string> = {}) {}

  async run(
    command: string,
    args: readonly string[],
    options?: { signal?: AbortSignal | undefined },
  ): Promise<Result<{ stdout: string; stderr: string }, AppError>> {
    this.commands.push({ command, args: [...args] });
    this.signals.push(options?.signal);
    if (this.onRun !== null) return this.onRun(command, args);
    const stdout = this.stdoutByCommand[command];
    if (stdout === undefined) return { ok: false, error: appError('processing_error', `Command not found: ${command}`) };
    return ok({ stdout, stderr: '' });
  }
}

class FakeWhisperApiClient implements WhisperApiClient {
  readonly calls: Array<{ file: ReadStream; model: 'whisper-1' }> = [];

  constructor(private readonly text: string) {}

  createTranscription(input: { file: ReadStream; model: 'whisper-1' }): Promise<{ text: string }> {
    this.calls.push(input);
    return Promise.resolve({ text: this.text });
  }
}

class ApiStatusError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI status ${status}`);
  }
}

const startFakeModelServer = async (
  body: Buffer,
  checksum: string,
): Promise<{ origin: string; requests: Array<{ method: string; url: string }>; close: () => Promise<void> }> => {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' });
    response.setHeader('content-length', body.length.toString());
    response.setHeader('x-linked-etag', checksum);
    if (request.method === 'HEAD') {
      response.statusCode = 200;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.end(body);
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
