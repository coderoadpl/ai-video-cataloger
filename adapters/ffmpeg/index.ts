import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  ThumbnailGeneration,
  ThumbnailInput,
} from '@core/server/index.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const ffprobeInstallerSchema = z.object({ path: z.string() });
const configuredRuntimes = new WeakMap<FfmpegRuntime, string>();

export interface FfmpegMetadata {
  format: {
    duration?: number | null | undefined;
    tags?: Record<string, string | number | null | undefined> | undefined;
  };
  streams: Array<{
    codec_type?: string | undefined;
    tags?: Record<string, string | number | null | undefined> | undefined;
  }>;
}

export interface FfmpegCommand {
  seekInput(seconds: number): FfmpegCommand;
  frames(count: number): FfmpegCommand;
  size(size: string): FfmpegCommand;
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

export interface ResolvedBinary {
  path: string;
  source: 'bundled' | 'system' | null;
  available: boolean;
}

export interface ResolvedFfmpegBinaries {
  ffmpeg: ResolvedBinary;
  ffprobe: ResolvedBinary;
}

export class FfmpegMediaAdapter implements MediaPort {
  private readonly runtime: FfmpegRuntime;
  private readonly binaryResolver: BinaryResolver;
  private readonly commandProbe: CommandProbe;

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
    return ok({
      duration: metadata.value.format.duration ?? null,
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

  async thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>> {
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
          .size(`${input.width}x${input.height}`)
          .output(input.thumbnailPath),
      );
      if (!generated.ok) return generated;
      return ok({ path: input.thumbnailPath, generated: true, skipped: false });
    } catch (cause) {
      return mediaFailure(cause, 'Failed to generate thumbnail');
    }
  }

  async dependencies(): Promise<Result<DependencyStatus[], AppError>> {
    const binaries = await resolveFfmpegBinaries(this.binaryResolver, this.commandProbe);
    const ffmpegStatus = await dependencyStatus('ffmpeg', binaries.ffmpeg, this.commandProbe);
    const ffprobeStatus = await dependencyStatus('ffprobe', binaries.ffprobe, this.commandProbe);
    return ok([ffmpegStatus, ffprobeStatus]);
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
    try {
      const loaded: unknown = require('ffmpeg-static');
      if (typeof loaded === 'string' && existsSync(loaded)) return loaded;
    } catch {
      return null;
    }
    return null;
  },
  bundledFfprobePath: () => {
    const packagedPath = packagedFfprobePath();
    if (packagedPath !== null) return packagedPath;
    try {
      const loaded: unknown = require('@ffprobe-installer/ffprobe');
      const parsed = ffprobeInstallerSchema.safeParse(loaded);
      if (parsed.success && existsSync(parsed.data.path)) return parsed.data.path;
    } catch {
      return null;
    }
    return null;
  },
};

const packagedFfmpegPath = (): string | null =>
  packagedResourcePath('node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

const packagedFfprobePath = (): string | null =>
  packagedResourcePath(
    'node_modules',
    '@ffprobe-installer',
    `${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
  );

const packagedResourcePath = (...segments: string[]): string | null => {
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) return null;
  const candidate = path.join(resourcesPath, 'app.asar.unpacked', ...segments);
  return existsSync(candidate) ? candidate : null;
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
