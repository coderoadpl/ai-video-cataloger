/**
 * Video scanner service
 * Scans directories for video files and registers them in the database
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import chalk from 'chalk';
import { getVideoByPath, insertVideo, getVideosByStatus, updateVideoStatus } from '../db/index.js';
import { hashFile } from '../utils/hash.js';
import type { VideoRecord } from '../types/index.js';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export interface ScanResult {
  newVideos: VideoRecord[];
  resumingVideos: VideoRecord[];
  retryingVideos: VideoRecord[];
  skippedCompleted: number;
  skippedErrors: number;
  totalFound: number;
}

export interface ScanOptions {
  retryErrors?: boolean;
}

/**
 * Scan a directory for video files
 * @param directory - The directory to scan (default: current working directory)
 * @param options - Scan options (e.g., retryErrors to include errored videos)
 * @returns ScanResult with new videos to process and statistics
 */
export async function scanDirectory(directory: string = process.cwd(), options: ScanOptions = {}): Promise<ScanResult> {
  const absoluteDir = resolve(directory);

  console.log(chalk.blue(`\nScanning for videos in: ${absoluteDir}`));

  // Find all video files in the directory
  const videoFiles = findVideoFiles(absoluteDir);

  if (videoFiles.length === 0) {
    console.log(chalk.yellow('\nNo video files found.'));
    console.log(chalk.gray(`Supported formats: ${VIDEO_EXTENSIONS.join(', ')}`));
    return {
      newVideos: [],
      resumingVideos: [],
      retryingVideos: [],
      skippedCompleted: 0,
      skippedErrors: 0,
      totalFound: 0,
    };
  }

  console.log(chalk.gray(`Found ${videoFiles.length} video file(s)`));

  // Get completed videos from database
  const completedVideos = getVideosByStatus('completed');
  const completedPaths = new Set(completedVideos.map(v => v.original_path));

  // Get errored videos from database
  const erroredVideos = getVideosByStatus('error');
  const erroredPaths = new Set(erroredVideos.map(v => v.original_path));

  const newVideos: VideoRecord[] = [];
  const resumingVideos: VideoRecord[] = [];
  const retryingVideos: VideoRecord[] = [];
  let skippedCompleted = 0;
  let skippedErrors = 0;

  for (const filePath of videoFiles) {
    // Skip already completed videos
    if (completedPaths.has(filePath)) {
      skippedCompleted++;
      continue;
    }

    // Handle errored videos
    if (erroredPaths.has(filePath)) {
      if (options.retryErrors) {
        // Retry errored video - reset status to 'pending' and clear error message
        const erroredVideo = erroredVideos.find(v => v.original_path === filePath);
        if (erroredVideo) {
          updateVideoStatus(erroredVideo.id, 'pending');
          erroredVideo.status = 'pending';
          erroredVideo.error_message = null;
          retryingVideos.push(erroredVideo);
        }
      } else {
        // Skip errored videos without --retry-errors flag
        skippedErrors++;
      }
      continue;
    }

    // Check if video already exists in database (but not completed or errored)
    const existingVideo = getVideoByPath(filePath);
    if (existingVideo) {
      // Video exists but not completed - add to resuming queue
      if (existingVideo.status !== 'pending') {
        // Has made some progress, this is a resume
        resumingVideos.push(existingVideo);
      } else {
        // Still pending, treat as new
        newVideos.push(existingVideo);
      }
      continue;
    }

    // New video - hash and insert
    const fileName = basename(filePath);
    console.log(chalk.gray(`  Hashing: ${fileName}`));
    const fileHash = await hashFile(filePath);
    const videoRecord = insertVideo(filePath, fileName, fileHash);
    newVideos.push(videoRecord);
  }

  // Display results
  console.log('');
  if (newVideos.length > 0) {
    console.log(chalk.green(`✓ ${newVideos.length} new video(s) to process`));
  }
  if (resumingVideos.length > 0) {
    console.log(chalk.yellow(`↻ ${resumingVideos.length} video(s) to resume`));
    for (const video of resumingVideos) {
      console.log(chalk.gray(`    ${video.original_name} (${video.status})`));
    }
  }
  if (retryingVideos.length > 0) {
    console.log(chalk.magenta(`⟳ ${retryingVideos.length} errored video(s) to retry`));
    for (const video of retryingVideos) {
      console.log(chalk.gray(`    ${video.original_name}`));
    }
  }
  if (skippedCompleted > 0) {
    console.log(chalk.gray(`  ${skippedCompleted} already completed (skipped)`));
  }
  if (skippedErrors > 0) {
    console.log(chalk.gray(`  ${skippedErrors} previously errored (use --retry-errors to retry)`));
  }
  if (newVideos.length === 0 && resumingVideos.length === 0 && retryingVideos.length === 0 && (skippedCompleted > 0 || skippedErrors > 0)) {
    console.log(chalk.yellow('\nAll videos have already been processed.'));
  }

  return {
    newVideos,
    resumingVideos,
    retryingVideos,
    skippedCompleted,
    skippedErrors,
    totalFound: videoFiles.length,
  };
}

/**
 * Find all video files in a directory (non-recursive)
 */
function findVideoFiles(directory: string): string[] {
  const videoFiles: string[] = [];

  try {
    const entries = readdirSync(directory);

    for (const entry of entries) {
      const fullPath = join(directory, entry);

      try {
        const stats = statSync(fullPath);

        if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            videoFiles.push(fullPath);
          }
        }
      } catch {
        // Skip files we can't stat (permission issues, etc.)
        continue;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error reading directory: ${message}`));
    return [];
  }

  return videoFiles.sort();
}
