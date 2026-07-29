import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

import {
  anchoredNodeModulesPath,
  FfmpegMediaAdapter,
  frameOutputPath,
  framesDirectoryForVideo,
  parseIso6709Location,
  resolveFfmpegBinaries,
  tempAudioPathForVideo,
  THUMBNAIL_CONCURRENCY,
  thumbnailPathForVideo,
  thumbnailScaleFilter,
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

describe('anchoredNodeModulesPath', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('finds the packaged ffprobe through the staged CLI node_modules symlink', async () => {
    const resources = await tempRoot();
    const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules', '@ffprobe-installer', 'darwin-arm64');
    await mkdir(unpacked, { recursive: true });
    await writeFile(path.join(unpacked, 'ffprobe'), 'binary');
    const cli = path.join(resources, 'cli');
    await mkdir(cli, { recursive: true });
    await symlink(path.join('..', 'app.asar.unpacked', 'node_modules'), path.join(cli, 'node_modules'));

    expect(anchoredNodeModulesPath(cli, ['@ffprobe-installer', 'darwin-arm64', 'ffprobe'])).toBe(
      path.join(cli, 'node_modules', '@ffprobe-installer', 'darwin-arm64', 'ffprobe'),
    );
  });

  it('returns null when no ancestor carries the binary', async () => {
    const root = await tempRoot();
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });

    expect(anchoredNodeModulesPath(nested, ['@ffprobe-installer', 'nowhere-arch', 'ffprobe'])).toBeNull();
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

    expect(first).toEqual(ok({ duration: 100, width: null, height: null, rotation: null, gpsLat: null, gpsLon: null }));
    expect(second).toEqual(ok({ duration: 100, width: null, height: null, rotation: null, gpsLat: null, gpsLon: null }));
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
      { name: 'videoFilters', value: thumbnailScaleFilter(128, 72) },
      { name: 'output', value: thumbnailPath },
      { name: 'run' },
    ]);
    expect(runtime.commands).toHaveLength(1);
  });

  it('generates a thumbnail from a stored frame without seeking, and skips existing thumbnails without force', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    const adapter = adapterWithFakeRuntime(runtime);
    const framePath = path.join(root, 'frames', 'clip', 'frame-001.jpg');
    const thumbnailPath = path.join(root, '.ai-video-cataloger', 'thumbnails', 'clip.jpg');

    const generated = await adapter.thumbnailFromFrame({
      framePath,
      thumbnailPath,
      width: 128,
      height: 72,
      force: false,
    });
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, 'existing');
    const skipped = await adapter.thumbnailFromFrame({
      framePath,
      thumbnailPath,
      width: 128,
      height: 72,
      force: false,
    });

    expect(generated).toEqual(ok({ path: thumbnailPath, generated: true, skipped: false }));
    expect(skipped).toEqual(ok({ path: thumbnailPath, generated: false, skipped: true }));
    expect(runtime.commands[0]?.operations).toEqual([
      { name: 'frames', value: 1 },
      { name: 'videoFilters', value: thumbnailScaleFilter(128, 72) },
      { name: 'output', value: thumbnailPath },
      { name: 'run' },
    ]);
    expect(runtime.commands).toHaveLength(1);
    expect(runtime.commands[0]?.videoPath).toBe(framePath);
  });

  it('bounds concurrent thumbnail generation to the worker-pool size', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    runtime.autoComplete = false;
    const adapter = adapterWithFakeRuntime(runtime);
    const count = THUMBNAIL_CONCURRENCY * 2 + 1;
    const thumbnails = Array.from({ length: count }, (_value, index) => adapter.thumbnail({
      videoPath: path.join(root, `${String(index)}.mp4`),
      thumbnailPath: path.join(root, `${String(index)}.jpg`),
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: true,
      priority: 'background',
    }));

    await expect.poll(() => runtime.commands.length).toBe(THUMBNAIL_CONCURRENCY);
    expect(runtime.maxActiveCommands).toBe(THUMBNAIL_CONCURRENCY);
    for (let index = 0; index < count; index += 1) {
      const command = runtime.commands[index];
      if (command === undefined) throw new Error(`missing thumbnail command ${String(index)}`);
      command.complete();
      if (index + THUMBNAIL_CONCURRENCY < count) {
        await expect.poll(() => runtime.commands.length).toBe(index + THUMBNAIL_CONCURRENCY + 1);
      }
    }
    await Promise.all(thumbnails);

    expect(runtime.maxActiveCommands).toBeLessThanOrEqual(THUMBNAIL_CONCURRENCY);
  });

  it('starts a queued foreground thumbnail before background backfill', async () => {
    const root = await tempRoot();
    const runtime = new FakeFfmpegRuntime();
    runtime.autoComplete = false;
    const adapter = adapterWithFakeRuntime(runtime);
    const background = Array.from({ length: THUMBNAIL_CONCURRENCY + 2 }, (_value, index) => adapter.thumbnail({
      videoPath: path.join(root, `background-${String(index)}.mp4`),
      thumbnailPath: path.join(root, `background-${String(index)}.jpg`),
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: true,
      priority: 'background',
    }));
    await expect.poll(() => runtime.commands.length).toBe(THUMBNAIL_CONCURRENCY);
    const foreground = adapter.thumbnail({
      videoPath: path.join(root, 'visible.mp4'),
      thumbnailPath: path.join(root, 'visible.jpg'),
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: true,
      priority: 'foreground',
    });

    runtime.commands[0]?.complete();
    await expect.poll(() => runtime.commands.length).toBe(THUMBNAIL_CONCURRENCY + 1);
    expect(runtime.commands[THUMBNAIL_CONCURRENCY]?.videoPath).toBe(path.join(root, 'visible.mp4'));

    const count = THUMBNAIL_CONCURRENCY + 3;
    for (let index = 1; index < count; index += 1) {
      const command = runtime.commands[index];
      if (command === undefined) throw new Error(`missing thumbnail command ${String(index)}`);
      command.complete();
      if (index + THUMBNAIL_CONCURRENCY < count) {
        await expect.poll(() => runtime.commands.length).toBe(index + THUMBNAIL_CONCURRENCY + 1);
      }
    }
    await Promise.all([...background, foreground]);
  });

  it('builds an aspect-preserving even-dimension scale filter bounded by the requested box', () => {
    const filter = thumbnailScaleFilter(128, 72);

    expect(filter).toBe(
      "scale=w='trunc(min(128/iw\\,72/ih)*iw/2)*2':h='trunc(min(128/iw\\,72/ih)*ih/2)*2'",
    );
    expect(filter).toContain('min(');
    expect(filter).toContain('/2)*2');
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

    expect(result).toEqual(ok({
      duration: 100,
      width: null,
      height: null,
      rotation: null,
      gpsLat: 69.6492,
      gpsLon: 18.9553,
    }));
  });

  it('extracts video dimensions and rotation metadata', async () => {
    const runtime = new FakeFfmpegRuntime();
    runtime.metadata = {
      format: { duration: 100 },
      streams: [{
        codec_type: 'video',
        width: 1920,
        height: 1080,
        tags: { rotate: '90' },
      }],
    };
    const adapter = adapterWithFakeRuntime(runtime);

    const result = await adapter.probe({ videoPath: '/video/portrait.mov' });

    expect(result).toEqual(ok({
      duration: 100,
      width: 1920,
      height: 1080,
      rotation: 90,
      gpsLat: null,
      gpsLon: null,
    }));
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
const canRunRealBinaries = realBinaries.ffmpeg.available && realBinaries.ffprobe.available;
const canRunRealSmoke = canRunRealBinaries && existsSync(realSample);

const probeDimensions = (videoPath: string): { width: number; height: number } => {
  const csv = execFileSync(realBinaries.ffprobe.path, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ]).toString().trim();
  const [width, height] = csv.split(',').map((value) => Number.parseInt(value, 10));
  return { width: width ?? 0, height: height ?? 0 };
};

const synthesizeVideo = (outputPath: string, size: string): void => {
  execFileSync(realBinaries.ffmpeg.path, [
    '-y', '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc=size=${size}:rate=30:duration=2`,
    '-pix_fmt', 'yuv420p',
    outputPath,
  ]);
};

describe('FfmpegMediaAdapter optional real-binary smoke', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it.skipIf(!canRunRealSmoke)('probes, decodes RGB, encodes JPEG, and generates one thumbnail with real binaries', async () => {
    const root = await tempRoot();
    const adapter = new FfmpegMediaAdapter();
    const thumbnailPath = path.join(root, 'thumb.jpg');
    const cropPath = path.join(root, 'crop.jpg');

    const probe = await adapter.probe({ videoPath: realSample });
    const decoded = await adapter.decodeFrameRgb({ kind: 'video-timestamp', videoPath: realSample, timestampS: 1 });
    const thumbnail = await adapter.thumbnail({
      videoPath: realSample,
      thumbnailPath,
      seekPercent: 0.25,
      width: 128,
      height: 72,
      force: true,
    });

    if (!probe.ok) throw new Error(probe.error.message);
    if (!decoded.ok) throw new Error(decoded.error.message);
    const encoded = await adapter.encodeRgbJpeg({
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 0, 0,
        0, 255, 0,
        0, 0, 255,
        255, 255, 255,
      ]),
    }, cropPath);
    if (!encoded.ok) throw new Error(encoded.error.message);
    if (!thumbnail.ok) throw new Error(thumbnail.error.message);
    expect(probe.value.duration).toBeGreaterThan(0);
    expect(decoded.value.width).toBeGreaterThan(0);
    expect(decoded.value.height).toBeGreaterThan(0);
    expect(decoded.value.data).toHaveLength(decoded.value.width * decoded.value.height * 3);
    expect(decoded.value.data.some((value) => value !== 0)).toBe(true);
    expect(existsSync(cropPath)).toBe(true);
    expect(existsSync(thumbnailPath)).toBe(true);
  }, scaledTimeout(30_000));

  it.skipIf(!canRunRealBinaries)('preserves source orientation and even dimensions when generating thumbnails', async () => {
    const root = await tempRoot();
    const adapter = new FfmpegMediaAdapter();
    const landscapeVideo = path.join(root, 'landscape.mp4');
    const portraitVideo = path.join(root, 'portrait.mp4');
    synthesizeVideo(landscapeVideo, '64x36');
    synthesizeVideo(portraitVideo, '36x64');
    const landscapeThumb = path.join(root, 'landscape.jpg');
    const portraitThumb = path.join(root, 'portrait.jpg');

    const landscape = await adapter.thumbnail({
      videoPath: landscapeVideo,
      thumbnailPath: landscapeThumb,
      seekPercent: 0.5,
      width: 128,
      height: 72,
      force: true,
    });
    const portrait = await adapter.thumbnail({
      videoPath: portraitVideo,
      thumbnailPath: portraitThumb,
      seekPercent: 0.5,
      width: 128,
      height: 72,
      force: true,
    });

    if (!landscape.ok) throw new Error(landscape.error.message);
    if (!portrait.ok) throw new Error(portrait.error.message);

    const landscapeDims = probeDimensions(landscapeThumb);
    const portraitDims = probeDimensions(portraitThumb);

    expect(landscapeDims.width).toBeGreaterThan(landscapeDims.height);
    expect(portraitDims.height).toBeGreaterThan(portraitDims.width);
    expect(landscapeDims.width).toBeLessThanOrEqual(128);
    expect(landscapeDims.height).toBeLessThanOrEqual(72);
    expect(portraitDims.width).toBeLessThanOrEqual(128);
    expect(portraitDims.height).toBeLessThanOrEqual(72);
    for (const dimension of [landscapeDims.width, landscapeDims.height, portraitDims.width, portraitDims.height]) {
      expect(dimension % 2).toBe(0);
    }
  }, scaledTimeout(30_000));

  it.skipIf(!canRunRealBinaries)('downscales a stored frame image to an aspect-preserving even-dimension thumbnail', async () => {
    const root = await tempRoot();
    const adapter = new FfmpegMediaAdapter();
    const framePath = path.join(root, 'frame-001.jpg');
    execFileSync(realBinaries.ffmpeg.path, [
      '-y', '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc=size=64x36:rate=1',
      '-frames:v', '1',
      framePath,
    ]);
    const thumbnailPath = path.join(root, 'from-frame.jpg');

    const result = await adapter.thumbnailFromFrame({
      framePath,
      thumbnailPath,
      width: 128,
      height: 72,
      force: true,
    });

    if (!result.ok) throw new Error(result.error.message);
    const dims = probeDimensions(thumbnailPath);
    expect(dims.width).toBeLessThanOrEqual(128);
    expect(dims.height).toBeLessThanOrEqual(72);
    expect(dims.width % 2).toBe(0);
    expect(dims.height % 2).toBe(0);
  }, scaledTimeout(30_000));
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
  activeCommands = 0;
  maxActiveCommands = 0;

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
    const command = new FakeFfmpegCommand(
      videoPath,
      this.autoComplete,
      () => {
        this.activeCommands += 1;
        this.maxActiveCommands = Math.max(this.maxActiveCommands, this.activeCommands);
      },
      () => {
        this.activeCommands -= 1;
      },
    );
    this.commands.push(command);
    return command;
  }
}

type CommandOperation =
  | { name: 'seekInput'; value: number }
  | { name: 'frames'; value: number }
  | { name: 'size'; value: string }
  | { name: 'videoFilters'; value: string }
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
  private finished = false;

  constructor(
    readonly videoPath: string,
    private readonly autoComplete: boolean,
    private readonly onStart: () => void,
    private readonly onFinish: () => void,
  ) {}

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

  videoFilters(filters: string | string[]): FfmpegCommand {
    this.operations.push({ name: 'videoFilters', value: Array.isArray(filters) ? filters.join(',') : filters });
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
    this.onStart();
    if (this.autoComplete && this.endListener !== null) {
      this.finish();
      this.endListener();
    }
  }

  fail(error: Error): void {
    this.finish();
    if (this.errorListener !== null) this.errorListener(error);
  }

  complete(): void {
    this.finish();
    if (this.endListener !== null) this.endListener();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onFinish();
  }
}
