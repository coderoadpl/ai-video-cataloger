/**
 * Thumbnail generation service
 * Generates video thumbnails using ffmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { configureFfmpeg } from './ffmpeg-setup.js';

// Configure ffmpeg to use bundled binaries (or fall back to system)
configureFfmpeg();

const DB_DIR_NAME = '.ai-video-cataloger';
const THUMBNAILS_DIR_NAME = 'thumbnails';
const THUMBNAIL_WIDTH = 128;
const THUMBNAIL_HEIGHT = 72;

/**
 * Get the thumbnails directory path for a given working directory
 */
export function getThumbnailsDir(workingDir: string): string {
  return join(workingDir, DB_DIR_NAME, THUMBNAILS_DIR_NAME);
}

/**
 * Get the thumbnail filename for a video
 * Uses the video filename (without extension) + .jpg
 */
export function getThumbnailFilename(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return `${videoName}.jpg`;
}

/**
 * Get the full thumbnail path for a video
 */
export function getThumbnailPath(videoPath: string): string {
  const workingDir = dirname(videoPath);
  const thumbnailsDir = getThumbnailsDir(workingDir);
  const thumbnailFilename = getThumbnailFilename(videoPath);
  return join(thumbnailsDir, thumbnailFilename);
}

/**
 * Check if a thumbnail already exists for a video
 */
export function thumbnailExists(videoPath: string): boolean {
  const thumbnailPath = getThumbnailPath(videoPath);
  return existsSync(thumbnailPath);
}

/**
 * Get video duration in seconds using ffprobe
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = metadata.format.duration;
      if (duration === undefined) {
        reject(new Error('Could not determine video duration'));
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Generate a thumbnail for a video
 * Extracts a frame at 25% of the video duration and scales to 128x72
 *
 * @param videoPath - Path to the video file
 * @param options - Options for thumbnail generation
 * @returns Path to the generated thumbnail
 */
export async function generateThumbnail(
  videoPath: string,
  options: { force?: boolean } = {}
): Promise<{ path: string; generated: boolean; skipped: boolean }> {
  const thumbnailPath = getThumbnailPath(videoPath);
  const workingDir = dirname(videoPath);
  const thumbnailsDir = getThumbnailsDir(workingDir);

  // Check if thumbnail already exists
  if (existsSync(thumbnailPath) && !options.force) {
    return {
      path: thumbnailPath,
      generated: false,
      skipped: true,
    };
  }

  // Create thumbnails directory if it doesn't exist
  if (!existsSync(thumbnailsDir)) {
    mkdirSync(thumbnailsDir, { recursive: true });
  }

  // Get video duration to calculate 25% position
  const duration = await getVideoDuration(videoPath);
  const seekTime = duration * 0.25;

  // Generate thumbnail
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(seekTime)
      .frames(1)
      .size(`${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`)
      .output(thumbnailPath)
      .on('end', () => {
        resolve({
          path: thumbnailPath,
          generated: true,
          skipped: false,
        });
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

/**
 * Result type for thumbnail generation
 */
export interface ThumbnailResult {
  path: string;
  generated: boolean;
  skipped: boolean;
}
