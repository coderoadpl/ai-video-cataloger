/**
 * Video scanner service
 * Scans directories for video files and registers them in the database
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import chalk from 'chalk';
import { getVideoByPath, insertVideo, getVideosByStatus } from '../db/index.js';
import { hashFile } from '../utils/hash.js';
import type { VideoRecord } from '../types/index.js';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export interface ScanResult {
  newVideos: VideoRecord[];
  skippedCompleted: number;
  totalFound: number;
}

/**
 * Scan a directory for video files
 * @param directory - The directory to scan (default: current working directory)
 * @returns ScanResult with new videos to process and statistics
 */
export async function scanDirectory(directory: string = process.cwd()): Promise<ScanResult> {
  const absoluteDir = resolve(directory);

  console.log(chalk.blue(`\nScanning for videos in: ${absoluteDir}`));

  // Find all video files in the directory
  const videoFiles = findVideoFiles(absoluteDir);

  if (videoFiles.length === 0) {
    console.log(chalk.yellow('\nNo video files found.'));
    console.log(chalk.gray(`Supported formats: ${VIDEO_EXTENSIONS.join(', ')}`));
    return {
      newVideos: [],
      skippedCompleted: 0,
      totalFound: 0,
    };
  }

  console.log(chalk.gray(`Found ${videoFiles.length} video file(s)`));

  // Get completed videos from database
  const completedVideos = getVideosByStatus('completed');
  const completedPaths = new Set(completedVideos.map(v => v.original_path));

  const newVideos: VideoRecord[] = [];
  let skippedCompleted = 0;

  for (const filePath of videoFiles) {
    // Skip already completed videos
    if (completedPaths.has(filePath)) {
      skippedCompleted++;
      continue;
    }

    // Check if video already exists in database (but not completed)
    const existingVideo = getVideoByPath(filePath);
    if (existingVideo) {
      // Video exists but not completed - add to processing queue
      newVideos.push(existingVideo);
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
    console.log(chalk.green(`✓ ${newVideos.length} video(s) to process`));
  }
  if (skippedCompleted > 0) {
    console.log(chalk.gray(`  ${skippedCompleted} already completed (skipped)`));
  }
  if (newVideos.length === 0 && skippedCompleted > 0) {
    console.log(chalk.yellow('\nAll videos have already been processed.'));
  }

  return {
    newVideos,
    skippedCompleted,
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
