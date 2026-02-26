/**
 * FFmpeg Setup for Electron
 * Configures fluent-ffmpeg to use bundled binaries
 */
import ffmpeg from 'fluent-ffmpeg';
import { getFFmpegPath, getFFprobePath, getFFmpegVersion } from './ffmpeg-paths.js';

let isConfigured = false;

/**
 * Configure fluent-ffmpeg to use bundled binaries
 * This must be called before any ffmpeg operations
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

  console.log('[FFmpeg Setup] Configured paths:');
  console.log(`  FFmpeg: ${ffmpegPath}`);
  console.log(`  FFprobe: ${ffprobePath}`);
}

/**
 * Get information about FFmpeg configuration
 */
export async function getFFmpegInfo(): Promise<{
  ffmpegPath: string;
  ffprobePath: string;
  version: string;
  bundled: boolean;
}> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();
  const versionInfo = await getFFmpegVersion();

  return {
    ffmpegPath,
    ffprobePath,
    version: versionInfo.version,
    bundled: versionInfo.bundled,
  };
}

/**
 * Check if FFmpeg is properly configured and available
 */
export function isFFmpegConfigured(): boolean {
  return isConfigured;
}
