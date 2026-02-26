/**
 * FFmpeg Binary Path Resolution
 * Provides paths to bundled FFmpeg and FFprobe binaries for Electron app
 */
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// Create require function for CommonJS modules
const require = createRequire(import.meta.url);

/**
 * Get the path to the bundled FFmpeg binary
 * Handles both development and packaged app scenarios
 */
export function getFFmpegPath(): string {
  // In development, use the ffmpeg-static package directly
  if (!app.isPackaged) {
    try {
      // ffmpeg-static exports the path as default
      const ffmpegStatic = require('ffmpeg-static') as string | null;
      if (ffmpegStatic) {
        return ffmpegStatic;
      }
    } catch {
      // Fall through to fallback
    }
  }

  // In packaged app, ffmpeg-static is in the unpacked asar resources
  // The path structure is: app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
  const unpackedPath = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    'ffmpeg'
  );

  if (existsSync(unpackedPath)) {
    return unpackedPath;
  }

  // Fallback: try system ffmpeg
  return 'ffmpeg';
}

/**
 * Get the path to the bundled FFprobe binary
 * Handles both development and packaged app scenarios
 */
export function getFFprobePath(): string {
  // In development, use the @ffprobe-installer/ffprobe package directly
  if (!app.isPackaged) {
    try {
      const ffprobe = require('@ffprobe-installer/ffprobe') as { path: string };
      if (ffprobe?.path) {
        return ffprobe.path;
      }
    } catch {
      // Fall through to fallback
    }
  }

  // In packaged app, ffprobe is in the unpacked asar resources
  // ffprobe-installer uses platform-specific subdirectories like darwin-arm64
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform;
  const arch = process.arch; // arm64, x64, etc.
  const unpackedPath = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@ffprobe-installer',
    `${platform}-${arch}`,
    'ffprobe'
  );

  if (existsSync(unpackedPath)) {
    return unpackedPath;
  }

  // Fallback: try system ffprobe
  return 'ffprobe';
}

/**
 * Check if bundled FFmpeg is available and working
 */
export function isBundledFFmpegAvailable(): boolean {
  const ffmpegPath = getFFmpegPath();
  return ffmpegPath !== 'ffmpeg' && existsSync(ffmpegPath);
}

/**
 * Check if bundled FFprobe is available and working
 */
export function isBundledFFprobeAvailable(): boolean {
  const ffprobePath = getFFprobePath();
  return ffprobePath !== 'ffprobe' && existsSync(ffprobePath);
}

/**
 * Get FFmpeg version info
 */
export async function getFFmpegVersion(): Promise<{ version: string; bundled: boolean }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const ffmpegPath = getFFmpegPath();
  const bundled = ffmpegPath !== 'ffmpeg';

  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-version']);
    const match = stdout.match(/ffmpeg version (\S+)/);
    const version = match ? match[1] : 'unknown';
    return { version, bundled };
  } catch {
    return { version: 'not found', bundled };
  }
}
