/**
 * FFmpeg Setup for CLI
 * Provides bundled ffmpeg/ffprobe binaries for the CLI tool
 * Falls back to system ffmpeg if bundled binaries are unavailable
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execa } from 'execa';

// Create require function for CommonJS modules
const require = createRequire(import.meta.url);

let isConfigured = false;

/**
 * Get the CLI bin directory for storing extracted binaries
 */
export function getCliBinDir(): string {
  return join(homedir(), '.ai-video-cataloger', 'bin');
}

/**
 * Get the path to the bundled FFmpeg binary from ffmpeg-static
 * Returns null if bundled binary is not available
 */
function getBundledFFmpegPath(): string | null {
  try {
    // ffmpeg-static exports the path as default
    const ffmpegStatic = require('ffmpeg-static') as string | null;
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // Package not available
  }
  return null;
}

/**
 * Get the path to the bundled FFprobe binary from @ffprobe-installer/ffprobe
 * Returns null if bundled binary is not available
 */
function getBundledFFprobePath(): string | null {
  try {
    const ffprobe = require('@ffprobe-installer/ffprobe') as { path: string };
    if (ffprobe?.path && existsSync(ffprobe.path)) {
      return ffprobe.path;
    }
  } catch {
    // Package not available
  }
  return null;
}

/**
 * Check if system ffmpeg is available
 */
async function isSystemFFmpegAvailable(): Promise<boolean> {
  try {
    await execa('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if system ffprobe is available
 */
async function isSystemFFprobeAvailable(): Promise<boolean> {
  try {
    await execa('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the best available FFmpeg path (bundled first, then system)
 */
export function getFFmpegPath(): string {
  // Try bundled first
  const bundled = getBundledFFmpegPath();
  if (bundled) {
    return bundled;
  }

  // Fall back to system ffmpeg
  return 'ffmpeg';
}

/**
 * Get the best available FFprobe path (bundled first, then system)
 */
export function getFFprobePath(): string {
  // Try bundled first
  const bundled = getBundledFFprobePath();
  if (bundled) {
    return bundled;
  }

  // Fall back to system ffprobe
  return 'ffprobe';
}

/**
 * Check if bundled FFmpeg is available
 */
export function isBundledFFmpegAvailable(): boolean {
  return getBundledFFmpegPath() !== null;
}

/**
 * Check if bundled FFprobe is available
 */
export function isBundledFFprobeAvailable(): boolean {
  return getBundledFFprobePath() !== null;
}

/**
 * Configure fluent-ffmpeg to use the best available binaries
 * This should be called before any ffmpeg operations
 */
export function configureFfmpeg(): void {
  if (isConfigured) {
    return;
  }

  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();

  // Set the paths for fluent-ffmpeg
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  isConfigured = true;
}

/**
 * Get FFmpeg version info
 */
export async function getFFmpegVersion(): Promise<{ version: string; bundled: boolean; path: string }> {
  const ffmpegPath = getFFmpegPath();
  const bundled = isBundledFFmpegAvailable();

  try {
    const { stdout } = await execa(ffmpegPath, ['-version']);
    const match = stdout.match(/ffmpeg version (\S+)/);
    const version = match ? match[1] : 'unknown';
    return { version, bundled, path: ffmpegPath };
  } catch {
    return { version: 'not found', bundled, path: ffmpegPath };
  }
}

/**
 * Check if FFmpeg is available (either bundled or system)
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  // Check bundled first
  if (isBundledFFmpegAvailable()) {
    return true;
  }

  // Fall back to checking system
  return isSystemFFmpegAvailable();
}

/**
 * Check if FFprobe is available (either bundled or system)
 */
export async function isFFprobeAvailable(): Promise<boolean> {
  // Check bundled first
  if (isBundledFFprobeAvailable()) {
    return true;
  }

  // Fall back to checking system
  return isSystemFFprobeAvailable();
}

/**
 * Get information about the current FFmpeg configuration
 */
export async function getFFmpegInfo(): Promise<{
  available: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  version: string;
  bundled: boolean;
}> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();
  const versionInfo = await getFFmpegVersion();
  const available = await isFFmpegAvailable();

  return {
    available,
    ffmpegPath,
    ffprobePath,
    version: versionInfo.version,
    bundled: versionInfo.bundled,
  };
}
