import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';

import {
  appError,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type {
  DependencyStatus,
  ExtractAudioInput,
  ExtractFramesInput,
  MediaPort,
  MediaProbe,
  ThumbnailFromFrameInput,
  ThumbnailGeneration,
  ThumbnailInput,
} from '@core/server/index.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const ffprobeInstallerSchema = z.object({ path: z.string() });
const ffprobeDimensionsSchema = z.object({
  streams: z.array(z.object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })),
});
const configuredRuntimes = new WeakMap<FfmpegRuntime, string>();

export interface FfmpegMetadata {
  format: {
    duration?: number | null | undefined;
    tags?: Record<string, string | number | null | undefined> | undefined;
  };
  streams: Array<{
    codec_type?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    tags?: Record<string, string | number | null | undefined> | undefined;
    side_data_list?: Array<Record<string, string | number | null | undefined>> | undefined;
  }>;
}

export interface FfmpegCommand {
  seekInput(seconds: number): FfmpegCommand;
  frames(count: number): FfmpegCommand;
  size(size: string): FfmpegCommand;
  videoFilters(filters: string | string[]): FfmpegCommand;
  noVideo(): FfmpegCommand;
  audioCodec(codec: string): FfmpegCommand;
  audioFrequency(frequency: number): FfmpegCommand;
  audioChannels(channels: number): FfmpegCommand;
  output(outputPath: string): FfmpegCommand;
  on(event: 'end' | 'error', listener: (error?: Error) => void): FfmpegCommand;
  kill(signal?: string): FfmpegCommand;
  run(): void;
}

export interface FfmpegRuntime {
  setFfmpegPath(ffmpegPath: string): void;
  setFfprobePath(ffprobePath: string): void;
  ffprobe(videoPath: string, callback: (error: Error | null, metadata: FfmpegMetadata | null) => void): void;
  command(videoPath: string): FfmpegCommand;
}

export interface CommandProbe {
  run(command: string, args: readonly string[]): Promise<Result<{ stdout: string }, AppError>>;
}

export interface BinaryResolver {
  bundledFfmpegPath(): string | null;
  bundledFfprobePath(): string | null;
}

export interface FfmpegMediaAdapterOptions {
  runtime?: FfmpegRuntime | undefined;
  binaryResolver?: BinaryResolver | undefined;
  commandProbe?: CommandProbe | undefined;
}

type ThumbnailJob =
  | { kind: 'video'; input: ThumbnailInput }
  | { kind: 'frame'; input: ThumbnailFromFrameInput };

interface ThumbnailTask {
  job: ThumbnailJob;
  resolve: (result: Result<ThumbnailGeneration, AppError>) => void;
}

export const THUMBNAIL_CONCURRENCY = 4;

export interface ResolvedBinary {
  path: string;
  source: 'bundled' | 'system' | null;
  available: boolean;
}

export interface ResolvedFfmpegBinaries {
  ffmpeg: ResolvedBinary;
  ffprobe: ResolvedBinary;
}

export interface RgbFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export type DecodeFrameRgbInput =
  | { kind: 'image-path'; imagePath: string }
  | { kind: 'jpeg-buffer'; jpegBuffer: Uint8Array }
  | { kind: 'video-timestamp'; videoPath: string; timestampS: number };

export class FfmpegMediaAdapter implements MediaPort {
  private readonly runtime: FfmpegRuntime;
  private readonly binaryResolver: BinaryResolver;
  private readonly commandProbe: CommandProbe;
  private readonly foregroundThumbnails: ThumbnailTask[] = [];
  private readonly backgroundThumbnails: ThumbnailTask[] = [];
  private activeThumbnails = 0;

  constructor(options: FfmpegMediaAdapterOptions = {}) {
    this.runtime = options.runtime ?? fluentFfmpegRuntime;
    this.binaryResolver = options.binaryResolver ?? nodeModuleBinaryResolver;
    this.commandProbe = options.commandProbe ?? childProcessCommandProbe;
  }

  async probe(input: { videoPath: string }): Promise<Result<MediaProbe, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    const metadata = await probeMetadata(this.runtime, input.videoPath);
    if (!metadata.ok) return metadata;
    const gps = gpsFromMetadata(metadata.value);
    const dimensions = videoDimensionsFromMetadata(metadata.value);
    return ok({
      duration: metadata.value.format.duration ?? null,
      width: dimensions.width,
      height: dimensions.height,
      rotation: dimensions.rotation,
      gpsLat: gps?.lat ?? null,
      gpsLon: gps?.lon ?? null,
    });
  }

  async extractFrames(input: ExtractFramesInput): Promise<Result<{ framePaths: string[] }, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    if (input.frameCount < 1) return { ok: false, error: appError('validation', 'Frame count must be at least 1') };
    const duration = await probeDuration(this.runtime, input.videoPath);
    if (!duration.ok) return duration;

    try {
      mkdirSync(input.outputDirectory, { recursive: true });
      const framePaths: string[] = [];
      for (let index = 1; index <= input.frameCount; index += 1) {
        const timestamp = duration.value * (index / (input.frameCount + 1));
        const framePath = frameOutputPath(input.outputDirectory, index);
        const extracted = await runCommand(
          this.runtime
            .command(input.videoPath)
            .seekInput(timestamp)
            .frames(1)
            .output(framePath),
          input.signal,
        );
        if (!extracted.ok) return extracted;
        framePaths.push(framePath);
      }
      return ok({ framePaths });
    } catch (cause) {
      return mediaFailure(cause, 'Failed to extract frames');
    }
  }

  async extractAudio(input: ExtractAudioInput): Promise<Result<{ hasAudio: boolean; audioPath: string | null }, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;

    try {
      const metadata = await probeMetadata(this.runtime, input.videoPath);
      if (!metadata.ok) return metadata;
      if (!metadata.value.streams.some((stream) => stream.codec_type === 'audio')) {
        return ok({ hasAudio: false, audioPath: null });
      }
      mkdirSync(path.dirname(input.outputPath), { recursive: true });
      const extracted = await runCommand(
        this.runtime
          .command(input.videoPath)
          .noVideo()
          .audioCodec('pcm_s16le')
          .audioFrequency(16000)
          .audioChannels(1)
          .output(input.outputPath),
        input.signal,
      );
      if (!extracted.ok) return extracted;
      return ok({ hasAudio: true, audioPath: input.outputPath });
    } catch (cause) {
      return mediaFailure(cause, 'Failed to extract audio');
    }
  }

  thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>> {
    return new Promise((resolve) => {
      const queue = input.priority === 'foreground'
        ? this.foregroundThumbnails
        : this.backgroundThumbnails;
      queue.push({ job: { kind: 'video', input }, resolve });
      this.drainThumbnails();
    });
  }

  thumbnailFromFrame(input: ThumbnailFromFrameInput): Promise<Result<ThumbnailGeneration, AppError>> {
    return new Promise((resolve) => {
      const queue = input.priority === 'foreground'
        ? this.foregroundThumbnails
        : this.backgroundThumbnails;
      queue.push({ job: { kind: 'frame', input }, resolve });
      this.drainThumbnails();
    });
  }

  private drainThumbnails(): void {
    while (this.activeThumbnails < THUMBNAIL_CONCURRENCY) {
      const task = this.foregroundThumbnails.shift() ?? this.backgroundThumbnails.shift();
      if (task === undefined) return;
      this.activeThumbnails += 1;
      void this.runThumbnailJob(task.job)
        .catch((cause: unknown) => mediaFailure(cause, 'Failed to generate thumbnail'))
        .then(task.resolve)
        .finally(() => {
          this.activeThumbnails -= 1;
          this.drainThumbnails();
        });
    }
  }

  private async runThumbnailJob(job: ThumbnailJob): Promise<Result<ThumbnailGeneration, AppError>> {
    return job.kind === 'video' ? this.generateThumbnail(job.input) : this.generateThumbnailFromFrame(job.input);
  }

  private async generateThumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    if (existsSync(input.thumbnailPath) && !input.force) {
      return ok({ path: input.thumbnailPath, generated: false, skipped: true });
    }
    const duration = await probeDuration(this.runtime, input.videoPath);
    if (!duration.ok) return duration;

    try {
      mkdirSync(path.dirname(input.thumbnailPath), { recursive: true });
      const generated = await runCommand(
        this.runtime
          .command(input.videoPath)
          .seekInput(duration.value * input.seekPercent)
          .frames(1)
          .videoFilters(thumbnailScaleFilter(input.width, input.height))
          .output(input.thumbnailPath),
      );
      if (!generated.ok) return generated;
      return ok({ path: input.thumbnailPath, generated: true, skipped: false });
    } catch (cause) {
      return mediaFailure(cause, 'Failed to generate thumbnail');
    }
  }

  private async generateThumbnailFromFrame(input: ThumbnailFromFrameInput): Promise<Result<ThumbnailGeneration, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    if (existsSync(input.thumbnailPath) && !input.force) {
      return ok({ path: input.thumbnailPath, generated: false, skipped: true });
    }

    try {
      mkdirSync(path.dirname(input.thumbnailPath), { recursive: true });
      const generated = await runCommand(
        this.runtime
          .command(input.framePath)
          .frames(1)
          .videoFilters(thumbnailScaleFilter(input.width, input.height))
          .output(input.thumbnailPath),
      );
      if (!generated.ok) return generated;
      return ok({ path: input.thumbnailPath, generated: true, skipped: false });
    } catch (cause) {
      return mediaFailure(cause, 'Failed to generate thumbnail from frame');
    }
  }

  async dependencies(): Promise<Result<DependencyStatus[], AppError>> {
    const binaries = await resolveFfmpegBinaries(this.binaryResolver, this.commandProbe);
    const ffmpegStatus = await dependencyStatus('ffmpeg', binaries.ffmpeg, this.commandProbe);
    const ffprobeStatus = await dependencyStatus('ffprobe', binaries.ffprobe, this.commandProbe);
    return ok([ffmpegStatus, ffprobeStatus]);
  }

  async decodeFrameRgb(input: DecodeFrameRgbInput): Promise<Result<RgbFrame, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    const binaries = await resolveFfmpegBinaries(this.binaryResolver, this.commandProbe);
    if (!binaries.ffmpeg.available || !binaries.ffprobe.available) {
      return { ok: false, error: appError('prerequisites_failed', 'FFmpeg and ffprobe are required to decode RGB frames') };
    }
    const dimensions = await frameDimensions(input, this.runtime, binaries.ffprobe.path);
    if (!dimensions.ok) return dimensions;
    const decoded = await decodeRawRgb(input, binaries.ffmpeg.path);
    if (!decoded.ok) return decoded;
    const expected = dimensions.value.width * dimensions.value.height * 3;
    if (decoded.value.length !== expected) {
      return { ok: false, error: appError('processing_error', `Decoded RGB frame size mismatch: expected ${expected}, got ${decoded.value.length}`) };
    }
    return ok({ ...dimensions.value, data: decoded.value });
  }

  async encodeRgbJpeg(frame: RgbFrame, outputPath: string): Promise<Result<void, AppError>> {
    const configured = await this.configure();
    if (!configured.ok) return configured;
    const binaries = await resolveFfmpegBinaries(this.binaryResolver, this.commandProbe);
    if (!binaries.ffmpeg.available) {
      return { ok: false, error: appError('prerequisites_failed', 'FFmpeg is required to encode RGB JPEG crops') };
    }
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const encoded = await runProcess(
      binaries.ffmpeg.path,
      [
        '-v', 'error',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-s', `${frame.width}x${frame.height}`,
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ],
      frame.data,
    );
    if (!encoded.ok) return encoded;
    return ok(undefined);
  }

  private async configure(): Promise<Result<void, AppError>> {
    const binaries = await resolveFfmpegBinaries(this.binaryResolver, this.commandProbe);
    configureRuntimeOnce(this.runtime, binaries);
    return ok(undefined);
  }
}

export const resolveFfmpegBinaries = async (
  resolver: BinaryResolver = nodeModuleBinaryResolver,
  probe: CommandProbe = childProcessCommandProbe,
): Promise<ResolvedFfmpegBinaries> => ({
  ffmpeg: await resolveBinary('ffmpeg', resolver.bundledFfmpegPath(), probe),
  ffprobe: await resolveBinary('ffprobe', resolver.bundledFfprobePath(), probe),
});

export const framesDirectoryForVideo = (videoPath: string): string =>
  path.join(path.dirname(videoPath), 'frames', path.basename(videoPath, path.extname(videoPath)));

export const frameOutputPath = (outputDirectory: string, frameNumber: number): string =>
  path.join(outputDirectory, `frame-${frameNumber.toString().padStart(3, '0')}.jpg`);

export const tempAudioPathForVideo = (videoPath: string, tempRoot = tmpdir()): string =>
  path.join(
    tempRoot,
    'ai-video-cataloger',
    'audio',
    `${pathHash(videoPath)}-${path.basename(videoPath, path.extname(videoPath))}.wav`,
  );

export const thumbnailPathForVideo = (videoPath: string): string =>
  path.join(path.dirname(videoPath), '.ai-video-cataloger', 'thumbnails', `${path.basename(videoPath, path.extname(videoPath))}.jpg`);

export const thumbnailScaleFilter = (width: number, height: number): string =>
  `scale=w='trunc(min(${width}/iw\\,${height}/ih)*iw/2)*2':h='trunc(min(${width}/iw\\,${height}/ih)*ih/2)*2'`;

export const parseIso6709Location = (value: string): { lat: number; lon: number } | null => {
  const trimmed = value.trim();
  const match = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/.exec(trimmed);
  if (match === null) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
};

const resolveBinary = async (
  systemCommand: 'ffmpeg' | 'ffprobe',
  bundledPath: string | null,
  probe: CommandProbe,
): Promise<ResolvedBinary> => {
  if (bundledPath !== null) return { path: bundledPath, source: 'bundled', available: true };
  const system = await probe.run(systemCommand, ['-version']);
  if (system.ok) return { path: systemCommand, source: 'system', available: true };
  return { path: systemCommand, source: null, available: false };
};

const configureRuntimeOnce = (runtime: FfmpegRuntime, binaries: ResolvedFfmpegBinaries): void => {
  const key = `${binaries.ffmpeg.path}\n${binaries.ffprobe.path}`;
  if (configuredRuntimes.get(runtime) === key) return;
  runtime.setFfmpegPath(binaries.ffmpeg.path);
  runtime.setFfprobePath(binaries.ffprobe.path);
  configuredRuntimes.set(runtime, key);
};

const probeMetadata = (runtime: FfmpegRuntime, videoPath: string): Promise<Result<FfmpegMetadata, AppError>> =>
  new Promise((resolve) => {
    runtime.ffprobe(videoPath, (error, metadata) => {
      if (error !== null) {
        resolve(mediaFailure(error, 'Failed to probe video'));
        return;
      }
      if (metadata === null) {
        resolve({ ok: false, error: appError('processing_error', 'Failed to probe video') });
        return;
      }
      resolve(ok(metadata));
    });
  });

const probeDuration = async (runtime: FfmpegRuntime, videoPath: string): Promise<Result<number, AppError>> => {
  const metadata = await probeMetadata(runtime, videoPath);
  if (!metadata.ok) return metadata;
  const duration = metadata.value.format.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    return { ok: false, error: appError('processing_error', 'Could not determine video duration') };
  }
  return ok(duration);
};

const videoDimensionsFromMetadata = (metadata: FfmpegMetadata): {
  width: number | null;
  height: number | null;
  rotation: number | null;
} => {
  const stream = metadata.streams.find((candidate) =>
    candidate.codec_type === 'video' && typeof candidate.width === 'number' && typeof candidate.height === 'number');
  if (stream === undefined || stream.width === undefined || stream.height === undefined) {
    return { width: null, height: null, rotation: null };
  }
  return {
    width: stream.width,
    height: stream.height,
    rotation: rotationFromStream(stream),
  };
};

const rotationFromStream = (stream: FfmpegMetadata['streams'][number]): number | null => {
  const tagged = numericMetadataValue(stream.tags?.rotate);
  if (tagged !== null) return normalizeRotation(tagged);
  for (const item of stream.side_data_list ?? []) {
    const rotation = numericMetadataValue(item.rotation);
    if (rotation !== null) return normalizeRotation(rotation);
  }
  return null;
};

const numericMetadataValue = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeRotation = (value: number): number => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const frameDimensions = async (
  input: DecodeFrameRgbInput,
  runtime: FfmpegRuntime,
  ffprobePath: string,
): Promise<Result<{ width: number; height: number }, AppError>> => {
  if (input.kind === 'jpeg-buffer') return probeBufferDimensions(ffprobePath, input.jpegBuffer);
  const mediaPath = input.kind === 'image-path' ? input.imagePath : input.videoPath;
  const metadata = await probeMetadata(runtime, mediaPath);
  if (!metadata.ok) return metadata;
  const stream = metadata.value.streams.find((candidate) =>
    candidate.codec_type === 'video' && typeof candidate.width === 'number' && typeof candidate.height === 'number');
  if (stream === undefined || stream.width === undefined || stream.height === undefined) {
    return { ok: false, error: appError('processing_error', 'Could not determine frame dimensions') };
  }
  return ok({ width: stream.width, height: stream.height });
};

const probeBufferDimensions = async (
  ffprobePath: string,
  jpegBuffer: Uint8Array,
): Promise<Result<{ width: number; height: number }, AppError>> => {
  const probed = await runProcess(
    ffprobePath,
    [
      '-v', 'error',
      '-f', 'image2pipe',
      '-i', 'pipe:0',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
    ],
    jpegBuffer,
  );
  if (!probed.ok) return probed;
  try {
    const parsed = ffprobeDimensionsSchema.parse(JSON.parse(Buffer.from(probed.value).toString('utf8')));
    const first = parsed.streams[0];
    if (first?.width === undefined || first.height === undefined) {
      return { ok: false, error: appError('processing_error', 'Could not determine JPEG dimensions') };
    }
    return ok({ width: first.width, height: first.height });
  } catch (cause) {
    return mediaFailure(cause, 'Could not parse JPEG dimensions');
  }
};

const decodeRawRgb = async (input: DecodeFrameRgbInput, ffmpegPath: string): Promise<Result<Uint8Array, AppError>> => {
  const args = decodeArgs(input);
  const decoded = await runProcess(ffmpegPath, args, input.kind === 'jpeg-buffer' ? input.jpegBuffer : undefined);
  if (!decoded.ok) return decoded;
  return ok(decoded.value);
};

const decodeArgs = (input: DecodeFrameRgbInput): string[] => {
  const outputArgs = ['-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  if (input.kind === 'image-path') return ['-v', 'error', '-i', input.imagePath, ...outputArgs];
  if (input.kind === 'jpeg-buffer') return ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', ...outputArgs];
  return ['-v', 'error', '-ss', String(input.timestampS), '-i', input.videoPath, ...outputArgs];
};

const gpsFromMetadata = (metadata: FfmpegMetadata): { lat: number; lon: number } | null => {
  for (const tags of [metadata.format.tags, ...metadata.streams.map((stream) => stream.tags)]) {
    const gps = gpsFromTags(tags);
    if (gps !== null) return gps;
  }
  return null;
};

const gpsFromTags = (tagsValue: Record<string, string | number | null | undefined> | undefined): { lat: number; lon: number } | null => {
  if (tagsValue === undefined) return null;
  const keys = [
    'com.apple.quicktime.location.ISO6709',
    'location',
    'location-eng',
  ];
  for (const key of keys) {
    const value = tagsValue[key];
    if (typeof value !== 'string') continue;
    const parsed = parseIso6709Location(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const runCommand = (command: FfmpegCommand, signal?: AbortSignal): Promise<Result<void, AppError>> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<void, AppError>): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = (): void => {
      command.kill('SIGTERM');
    };
    command
      .on('end', () => finish(ok(undefined)))
      .on('error', (error) => finish(mediaFailure(error, 'FFmpeg command failed')))
      .run();
    if (signal?.aborted === true) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });

const runProcess = (
  command: string,
  args: readonly string[],
  input?: Uint8Array | undefined,
): Promise<Result<Uint8Array, AppError>> =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => resolve(mediaFailure(error, `Failed to run ${command}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(ok(new Uint8Array(Buffer.concat(stdout))));
        return;
      }
      const message = Buffer.concat(stderr).toString('utf8').trim();
      resolve({ ok: false, error: appError('processing_error', message.length === 0 ? `Failed to run ${command}` : message) });
    });
    if (input !== undefined) child.stdin.end(Buffer.from(input));
    else child.stdin.end();
  });

const pathHash = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const dependencyStatus = async (
  name: 'ffmpeg' | 'ffprobe',
  binary: ResolvedBinary,
  probe: CommandProbe,
): Promise<DependencyStatus> => {
  if (!binary.available) {
    return {
      name,
      available: false,
      version: null,
      source: null,
      path: null,
      installHint: `Install ${name} or reinstall dependencies for the bundled binary`,
    };
  }
  const versionProbe = await probe.run(binary.path, ['-version']);
  return {
    name,
    available: true,
    version: versionProbe.ok ? parseVersion(name, versionProbe.value.stdout) : null,
    source: binary.source,
    path: binary.path,
    installHint: '',
  };
};

const parseVersion = (name: 'ffmpeg' | 'ffprobe', stdout: string): string | null => {
  const match = new RegExp(`${name} version (\\S+)`).exec(stdout);
  return match?.[1] ?? null;
};

const mediaFailure = (cause: unknown, fallbackMessage: string): Result<never, AppError> => {
  const message = cause instanceof Error ? cause.message : fallbackMessage;
  return { ok: false, error: appError('processing_error', message, cause) };
};

const nodeModuleBinaryResolver: BinaryResolver = {
  bundledFfmpegPath: () => {
    const packagedPath = packagedFfmpegPath();
    if (packagedPath !== null) return packagedPath;
    const required = requiredFfmpegStaticPath();
    if (required !== null) return required;
    return anchoredNodeModulesPath(adapterDirectory, ffmpegStaticSegments);
  },
  bundledFfprobePath: () => {
    const packagedPath = packagedFfprobePath();
    if (packagedPath !== null) return packagedPath;
    const required = requiredFfprobeInstallerPath();
    if (required !== null) return required;
    return anchoredNodeModulesPath(adapterDirectory, ffprobeInstallerSegments);
  },
};

const requiredFfmpegStaticPath = (): string | null => {
  try {
    const loaded: unknown = require('ffmpeg-static');
    if (typeof loaded === 'string' && existsSync(loaded)) return loaded;
  } catch {
    return null;
  }
  return null;
};

const requiredFfprobeInstallerPath = (): string | null => {
  try {
    const loaded: unknown = require('@ffprobe-installer/ffprobe');
    const parsed = ffprobeInstallerSchema.safeParse(loaded);
    if (parsed.success && existsSync(parsed.data.path)) return parsed.data.path;
  } catch {
    return null;
  }
  return null;
};

const adapterDirectory = path.dirname(fileURLToPath(import.meta.url));

const ffmpegStaticSegments = ['ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'];

const ffprobeInstallerSegments = [
  '@ffprobe-installer',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
];

const packagedFfmpegPath = (): string | null => packagedResourcePath('node_modules', ...ffmpegStaticSegments);

const packagedFfprobePath = (): string | null => packagedResourcePath('node_modules', ...ffprobeInstallerSegments);

const packagedResourcePath = (...segments: string[]): string | null => {
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) return null;
  const candidate = path.join(resourcesPath, 'app.asar.unpacked', ...segments);
  return existsSync(candidate) ? candidate : null;
};

export const anchoredNodeModulesPath = (
  startDirectory: string,
  segments: readonly string[],
): string | null => {
  let directory = startDirectory;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};

const childProcessCommandProbe: CommandProbe = {
  run: async (command, args) => {
    try {
      const { stdout } = await execFileAsync(command, [...args]);
      return ok({ stdout });
    } catch (cause) {
      return mediaFailure(cause, `Failed to run ${command}`);
    }
  },
};

const fluentFfmpegRuntime: FfmpegRuntime = {
  setFfmpegPath: (ffmpegPath) => {
    ffmpeg.setFfmpegPath(ffmpegPath);
  },
  setFfprobePath: (ffprobePath) => {
    ffmpeg.setFfprobePath(ffprobePath);
  },
  ffprobe: (videoPath, callback) => {
    ffmpeg.ffprobe(videoPath, (error: Error | null, metadata: FfmpegMetadata) => {
      callback(error, metadata);
    });
  },
  command: (videoPath) => ffmpeg(videoPath),
};
