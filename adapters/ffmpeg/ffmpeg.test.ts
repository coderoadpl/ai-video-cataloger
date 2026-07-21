import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import {
  FfmpegMediaAdapter,
  frameOutputPath,
  framesDirectoryForVideo,
  parseIso6709Location,
  resolveFfmpegBinaries,
  tempAudioPathForVideo,
  thumbnailPathForVideo,
  type BinaryResolver,
  type CommandProbe,
  type FfmpegCommand,
  type FfmpegMetadata,
  type FfmpegRuntime,
} from './index.js';

const tempRoots: string[] = [];

describe('resolveFfmpegBinaries', () => {
  it('prefers bundled ffmpeg and ffprobe paths before probing system commands', async () => {
    const probe = new FakeCommandProbe();
    const resolved = await resolveFfmpegBinaries(
      {
        bundledFfmpegPath: () => '/bundled/ffmpeg',
        bundledFfprobePath: () => '/bundled/ffprobe',
      },
      probe,
    );

    expect(resolved).toEqual({
      ffmpeg: { path: '/bundled/ffmpeg', source: 'bundled', available: true },
      ffprobe: { path: '/bundled/ffprobe', source: 'bundled', available: true },
    });
    expect(probe.commands).toEqual([]);
  });

  it('falls back to system commands when bundled paths are unavailable', async () => {
    const probe = new FakeCommandProbe({
      ffmpeg: 'ffmpeg version 6.1',
      ffprobe: 'ffprobe version 6.1',
    });

    const resolved = await resolveFfmpegBinaries(emptyResolver, probe);

    expect(resolved).toEqual({
      ffmpeg: { path: 'ffmpeg', source: 'system', available: true },
      ffprobe: { path: 'ffprobe', source: 'system', available: true },
    });
    expect(probe.commands).toEqual([
      { command: 'ffmpeg', args: ['-version'] },
      { command: 'ffprobe', args: ['-version'] },
    ]);
  });
});

describe('FfmpegMediaAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('configures fluent-ffmpeg once per runtime and exposes dependency status', async () => {
    const runtime = new FakeFfmpegRuntime();
    const probe = new FakeCommandProbe({
      '/bundled/ffmpeg': 'ffmpeg version n7.1.1-static',
      '/bundled/ffprobe': 'ffprobe version n7.1.1-static',
    });
    const adapter = new FfmpegMediaAdapter({
      runtime,
      binaryResolver: {
        bundledFfmpegPath: () => '/bundled/ffmpeg',
        bundledFfprobePath: () => '/bundled/ffprobe',
      },
      commandProbe: probe,
    });

    const first = await adapter.probe({ videoPath: '/video/clip.mp4' });
    const second = await adapter.probe({ videoPath: '/video/clip.mp4' });
    const dependencies = await adapter.dependencies();

    expect(first).toEqual(ok({ duration: 100, gpsLat: null, gpsLon: null }));
    expect(second).toEqual(ok({ duration: 100, gpsLat: null, gpsLon: null }));
    expect(runtime.configurations).toEqual([{ ffmpegPath: '/bundled/ffmpeg', ffprobePath: '/bundled/ffprobe' }]);
    expect(dependencies).toEqual(ok([
      {
        name: 'ffmpeg',
        available: true,
        version: 'n7.1.1-static',
        source: 'bundled',
        path: '/bundled/ffmpeg',
        installHint: '',
      },
      {
        name: 'ffprobe',
        available: true,
        version: 'n7.1.1-static',
        source: 'bundled',
        path: '/bundled/ffprobe',
        installHint: '',
      },
    ]));
  });

  it('extracts frames at even offsets to frame-NNN jpg paths', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    const adapter = adapterWithFakeRuntime(runtime);
    const outputDirectory = path.join(root, 'frames', 'clip');

    const extracted = await adapter.extractFrames({
      videoPath: path.join(root, 'clip.mp4'),
      outputDirectory,
      frameCount: 3,
    });

    expect(extracted).toEqual(ok({
      framePaths: [
        path.join(outputDirectory, 'frame-001.jpg'),
        path.join(outputDirectory, 'frame-002.jpg'),
        path.join(outputDirectory, 'frame-003.jpg'),
      ],
    }));
    expect(runtime.commands.map((command) => command.operations)).toEqual([
      [
        { name: 'seekInput', value: 25 },
        { name: 'frames', value: 1 },
        { name: 'output', value: path.join(outputDirectory, 'frame-001.jpg') },
        { name: 'run' },
      ],
      [
        { name: 'seekInput', value: 50 },
        { name: 'frames', value: 1 },
        { name: 'output', value: path.join(outputDirectory, 'frame-002.jpg') },
        { name: 'run' },
      ],
      [
        { name: 'seekInput', value: 75 },
        { name: 'frames', value: 1 },
        { name: 'output', value: path.join(outputDirectory, 'frame-003.jpg') },
        { name: 'run' },
      ],
    ]);
  });

  it('extracts mono 16k WAV audio to the requested temp path', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    const adapter = adapterWithFakeRuntime(runtime);
    const audioPath = path.join(root, 'ai-video-cataloger', 'audio', 'clip.wav');

    const extracted = await adapter.extractAudio({
      videoPath: path.join(root, 'clip.mp4'),
      outputPath: audioPath,
    });

    expect(extracted).toEqual(ok({ hasAudio: true, audioPath }));
    expect(runtime.commands[0]?.operations).toEqual([
      { name: 'noVideo' },
      { name: 'audioCodec', value: 'pcm_s16le' },
      { name: 'audioFrequency', value: 16000 },
      { name: 'audioChannels', value: 1 },
      { name: 'output', value: audioPath },
      { name: 'run' },
    ]);
  });

  it('probes audio streams and skips ffmpeg extraction for a silent video', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    runtime.metadata = { format: { duration: 100 }, streams: [{ codec_type: 'video' }] };
    const adapter = adapterWithFakeRuntime(runtime);

    const extracted = await adapter.extractAudio({
      videoPath: path.join(root, 'silent.mp4'),
      outputPath: path.join(root, 'silent.wav'),
    });

    expect(extracted).toEqual(ok({ hasAudio: false, audioPath: null }));
    expect(runtime.commands).toEqual([]);
  });

  it('kills an active ffmpeg command when extraction is aborted', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    runtime.autoComplete = false;
    const adapter = adapterWithFakeRuntime(runtime);
    const controller = new AbortController();
    const extracting = adapter.extractAudio({
      videoPath: path.join(root, 'clip.mp4'),
      outputPath: path.join(root, 'clip.wav'),
      signal: controller.signal,
    });
    await Promise.resolve();

    controller.abort();
    const result = await extracting;

    expect(result).toMatchObject({ ok: false, error: { code: 'processing_error' } });
    expect(runtime.commands[0]?.operations).toContainEqual({ name: 'kill', value: 'SIGTERM' });
  });

  it('generates a 128x72 thumbnail at 25 percent duration and skips existing thumbnails without force', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    const adapter = adapterWithFakeRuntime(runtime);
    const videoPath = path.join(root, 'clip.mp4');
    const thumbnailPath = path.join(root, '.ai-video-cataloger', 'thumbnails', 'clip.jpg');

    const generated = await adapter.thumbnail({
      videoPath,
      thumbnailPath,
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: false,
    });
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, 'existing');
    const skipped = await adapter.thumbnail({
      videoPath,
      thumbnailPath,
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: false,
    });

    expect(generated).toEqual(ok({ path: thumbnailPath, generated: true, skipped: false }));
    expect(skipped).toEqual(ok({ path: thumbnailPath, generated: false, skipped: true }));
    expect(runtime.commands[0]?.operations).toEqual([
      { name: 'seekInput', value: 25 },
      { name: 'frames', value: 1 },
      { name: 'size', value: '128x72' },
      { name: 'output', value: thumbnailPath },
      { name: 'run' },
    ]);
    expect(runtime.commands).toHaveLength(1);
  });

  it('constructs parity output paths for frames, temp audio, and thumbnails', () => {
    const videoPath = path.join('/work', 'Clip One.mp4');

    expect(framesDirectoryForVideo(videoPath)).toBe(path.join('/work', 'frames', 'Clip One'));
    expect(frameOutputPath(path.join('/work', 'frames', 'Clip One'), 7)).toBe(path.join('/work', 'frames', 'Clip One', 'frame-007.jpg'));
    expect(tempAudioPathForVideo(videoPath, '/tmp')).toBe(path.join('/tmp', 'ai-video-cataloger', 'audio', '1903b0a3-Clip One.wav'));
    expect(thumbnailPathForVideo(videoPath)).toBe(path.join('/work', '.ai-video-cataloger', 'thumbnails', 'Clip One.jpg'));
  });

  it('extracts GPS coordinates from QuickTime ISO6709 metadata', async () => {
    const runtime = new FakeFfmpegRuntime();
    runtime.metadata = {
      format: {
        duration: 100,
        tags: { 'com.apple.quicktime.location.ISO6709': '+69.6492+018.9553+010.500/' },
      },
      streams: [{ codec_type: 'video' }],
    };
    const adapter = adapterWithFakeRuntime(runtime);

    const result = await adapter.probe({ videoPath: '/video/clip.mov' });

    expect(result).toEqual(ok({ duration: 100, gpsLat: 69.6492, gpsLon: 18.9553 }));
  });
});

describe('parseIso6709Location', () => {
  it('parses both hemispheres and optional altitude', () => {
    expect(parseIso6709Location('+69.6492+018.9553+010.500/')).toEqual({ lat: 69.6492, lon: 18.9553 });
    expect(parseIso6709Location('-33.8568+151.2153/')).toEqual({ lat: -33.8568, lon: 151.2153 });
    expect(parseIso6709Location('+37.3317-122.0307/')).toEqual({ lat: 37.3317, lon: -122.0307 });
  });

  it('rejects garbage and out-of-range coordinates', () => {
    expect(parseIso6709Location('not a location')).toBeNull();
    expect(parseIso6709Location('+91.0000+018.0000/')).toBeNull();
    expect(parseIso6709Location('+69.0000+181.0000/')).toBeNull();
  });
});

const realBinaries = await resolveFfmpegBinaries();
const realSample = path.resolve('test/BigBuckBunny480p30s.mp4');
const canRunRealSmoke = realBinaries.ffmpeg.available && realBinaries.ffprobe.available && existsSync(realSample);

describe('FfmpegMediaAdapter optional real-binary smoke', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it.skipIf(!canRunRealSmoke)('probes and generates one thumbnail with real binaries', async () => {
    const root = await tempRoot();
    const adapter = new FfmpegMediaAdapter();
    const thumbnailPath = path.join(root, 'thumb.jpg');

    const probe = await adapter.probe({ videoPath: realSample });
    const thumbnail = await adapter.thumbnail({
      videoPath: realSample,
      thumbnailPath,
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: true,
    });

    if (!probe.ok) throw new Error(probe.error.message);
    if (!thumbnail.ok) throw new Error(thumbnail.error.message);
    expect(probe.value.duration).toBeGreaterThan(0);
    expect(existsSync(thumbnailPath)).toBe(true);
  });
});

const emptyResolver: BinaryResolver = {
  bundledFfmpegPath: () => null,
  bundledFfprobePath: () => null,
};

const adapterWithFakeRuntime = (runtime: FakeFfmpegRuntime): FfmpegMediaAdapter =>
  new FfmpegMediaAdapter({
    runtime,
    binaryResolver: emptyResolver,
    commandProbe: new FakeCommandProbe({
      ffmpeg: 'ffmpeg version 6.1',
      ffprobe: 'ffprobe version 6.1',
    }),
  });

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-ffmpeg-'));
  tempRoots.push(root);
  return root;
};

interface ProbeCommand {
  command: string;
  args: string[];
}

class FakeCommandProbe implements CommandProbe {
  readonly commands: ProbeCommand[] = [];

  constructor(private readonly stdoutByCommand: Record<string, string> = {}) {}

  run(command: string, args: readonly string[]): Promise<Result<{ stdout: string }, AppError>> {
    this.commands.push({ command, args: [...args] });
    const stdout = this.stdoutByCommand[command];
    if (stdout === undefined) return Promise.resolve({ ok: false, error: appError('processing_error', `missing ${command}`) });
    return Promise.resolve(ok({ stdout }));
  }
}

interface RuntimeConfiguration {
  ffmpegPath: string;
  ffprobePath: string;
}

class FakeFfmpegRuntime implements FfmpegRuntime {
  readonly configurations: RuntimeConfiguration[] = [];
  readonly commands: FakeFfmpegCommand[] = [];
  readonly probes: string[] = [];
  metadata: FfmpegMetadata = {
    format: { duration: 100 },
    streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
  };
  autoComplete = true;

  setFfmpegPath(ffmpegPath: string): void {
    const last = this.configurations[this.configurations.length - 1];
    if (last === undefined || last.ffmpegPath !== ffmpegPath) {
      this.configurations.push({ ffmpegPath, ffprobePath: '' });
      return;
    }
  }

  setFfprobePath(ffprobePath: string): void {
    const last = this.configurations[this.configurations.length - 1];
    if (last === undefined) {
      this.configurations.push({ ffmpegPath: '', ffprobePath });
      return;
    }
    last.ffprobePath = ffprobePath;
  }

  ffprobe(videoPath: string, callback: (error: Error | null, metadata: FfmpegMetadata | null) => void): void {
    this.probes.push(videoPath);
    callback(null, this.metadata);
  }

  command(videoPath: string): FfmpegCommand {
    const command = new FakeFfmpegCommand(videoPath, this.autoComplete);
    this.commands.push(command);
    return command;
  }
}

type CommandOperation =
  | { name: 'seekInput'; value: number }
  | { name: 'frames'; value: number }
  | { name: 'size'; value: string }
  | { name: 'noVideo' }
  | { name: 'audioCodec'; value: string }
  | { name: 'audioFrequency'; value: number }
  | { name: 'audioChannels'; value: number }
  | { name: 'output'; value: string }
  | { name: 'kill'; value: string | undefined }
  | { name: 'run' };

class FakeFfmpegCommand implements FfmpegCommand {
  readonly operations: CommandOperation[] = [];
  private endListener: (() => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  constructor(readonly videoPath: string, private readonly autoComplete: boolean) {}

  seekInput(seconds: number): FfmpegCommand {
    this.operations.push({ name: 'seekInput', value: seconds });
    return this;
  }

  frames(count: number): FfmpegCommand {
    this.operations.push({ name: 'frames', value: count });
    return this;
  }

  size(size: string): FfmpegCommand {
    this.operations.push({ name: 'size', value: size });
    return this;
  }

  noVideo(): FfmpegCommand {
    this.operations.push({ name: 'noVideo' });
    return this;
  }

  audioCodec(codec: string): FfmpegCommand {
    this.operations.push({ name: 'audioCodec', value: codec });
    return this;
  }

  audioFrequency(frequency: number): FfmpegCommand {
    this.operations.push({ name: 'audioFrequency', value: frequency });
    return this;
  }

  audioChannels(channels: number): FfmpegCommand {
    this.operations.push({ name: 'audioChannels', value: channels });
    return this;
  }

  output(outputPath: string): FfmpegCommand {
    this.operations.push({ name: 'output', value: outputPath });
    return this;
  }

  on(event: 'end' | 'error', listener: (error?: Error) => void): FfmpegCommand {
    if (event === 'end') {
      this.endListener = () => listener();
    } else {
      this.errorListener = (error) => {
        listener(error);
      };
    }
    return this;
  }

  kill(signal?: string): FfmpegCommand {
    this.operations.push({ name: 'kill', value: signal });
    this.fail(new Error('killed'));
    return this;
  }

  run(): void {
    this.operations.push({ name: 'run' });
    if (this.autoComplete && this.endListener !== null) this.endListener();
  }

  fail(error: Error): void {
    if (this.errorListener !== null) this.errorListener(error);
  }
}
