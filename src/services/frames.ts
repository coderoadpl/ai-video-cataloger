/**
 * Frame extraction service
 * Extracts frames from videos using ffmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus } from '../db/index.js';
import type { VideoRecord } from '../types/index.js';

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
 * Extract a single frame at a specific timestamp
 */
function extractFrameAtTime(
  videoPath: string,
  outputPath: string,
  timeInSeconds: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timeInSeconds)
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Get the frames directory path for a video
 */
export function getFramesDir(videoPath: string): string {
  const videoDir = dirname(videoPath);
  const videoName = basename(videoPath, extname(videoPath));
  return join(videoDir, 'frames', videoName);
}

/**
 * Extract frames from a video at 25%, 50%, and 75% of duration
 * @param video - The video record to extract frames from
 * @param frameCount - Number of frames to extract (default: 3)
 * @returns Array of paths to extracted frames
 */
export async function extractFrames(
  video: VideoRecord,
  frameCount: number = 3
): Promise<string[]> {
  const videoPath = video.original_path;

  const spinner = ora({
    text: `Extracting frames from ${chalk.cyan(video.original_name)}`,
    color: 'blue',
  }).start();

  try {
    // Get video duration
    const duration = await getVideoDuration(videoPath);

    // Create frames directory
    const framesDir = getFramesDir(videoPath);
    if (!existsSync(framesDir)) {
      mkdirSync(framesDir, { recursive: true });
    }

    // Calculate timestamps for frame extraction
    // Extract at evenly distributed points (25%, 50%, 75% for 3 frames)
    const timestamps: number[] = [];
    for (let i = 1; i <= frameCount; i++) {
      const percentage = i / (frameCount + 1);
      timestamps.push(duration * percentage);
    }

    // Extract frames
    const framePaths: string[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const frameNum = String(i + 1).padStart(3, '0');
      const framePath = join(framesDir, `frame-${frameNum}.jpg`);

      spinner.text = `Extracting frame ${i + 1}/${frameCount} from ${chalk.cyan(video.original_name)}`;

      await extractFrameAtTime(videoPath, framePath, timestamps[i]);
      framePaths.push(framePath);
    }

    // Update video status in database
    updateVideoStatus(video.id, 'frames_extracted');

    spinner.succeed(`Extracted ${frameCount} frames from ${chalk.cyan(video.original_name)}`);

    return framePaths;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Failed to extract frames from ${chalk.cyan(video.original_name)}: ${message}`);
    throw error;
  }
}
