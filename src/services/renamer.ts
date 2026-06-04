/**
 * Video renamer service
 * Renames video files based on Claude's analysis with date prefix
 */

import { existsSync, renameSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { format } from 'date-fns';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus, updateVideoNewName } from '../db/index.js';
import { getFramesDir } from './frames.js';
import { getTranscriptPath } from './transcription.js';
import { getSummaryPath, getSummaryJsonPath } from './summary-format.js';
import { getThumbnailPath, getThumbnailsDir } from './thumbnail.js';
import type { VideoRecord } from '../types/index.js';

export interface RenameResult {
  oldPath: string;
  newPath: string;
  newName: string;
}

/**
 * Sanitize a string to be a valid kebab-case filename slug
 */
function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'video';
}

/**
 * Generate a unique filename by appending -2, -3, etc. if needed
 */
function getUniqueFilename(directory: string, baseName: string, extension: string): string {
  let finalName = `${baseName}${extension}`;
  let counter = 1;

  while (existsSync(join(directory, finalName))) {
    counter++;
    finalName = `${baseName}-${counter}${extension}`;
  }

  return finalName;
}

/**
 * Get the date prefix from file modification time
 */
function getDatePrefix(filePath: string): string {
  const stats = statSync(filePath);
  return format(stats.mtime, 'yyyy-MM-dd');
}

/**
 * Rename a directory if it exists
 */
function renameDirectoryIfExists(oldPath: string, newPath: string): void {
  if (existsSync(oldPath)) {
    // Ensure parent directory exists
    const parentDir = dirname(newPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    renameSync(oldPath, newPath);
  }
}

/**
 * Rename a file if it exists
 */
function renameFileIfExists(oldPath: string, newPath: string): void {
  if (existsSync(oldPath)) {
    // Ensure parent directory exists
    const parentDir = dirname(newPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    renameSync(oldPath, newPath);
  }
}

/**
 * Get the new frames directory path based on new video name
 */
function getNewFramesDir(videoDir: string, newVideoBaseName: string): string {
  return join(videoDir, 'frames', newVideoBaseName);
}

/**
 * Get the new transcript path based on new video name
 */
function getNewTranscriptPath(videoDir: string, newVideoBaseName: string): string {
  return join(videoDir, 'transcripts', `${newVideoBaseName}.txt`);
}

/**
 * Get the new summary path based on new video name
 */
function getNewSummaryPath(videoDir: string, newVideoBaseName: string): string {
  return join(videoDir, 'summaries', `${newVideoBaseName}.txt`);
}

/**
 * Get the new summary JSON path based on new video name
 */
function getNewSummaryJsonPath(videoDir: string, newVideoBaseName: string): string {
  return join(videoDir, 'summaries', `${newVideoBaseName}.json`);
}

/**
 * Get the new thumbnail path based on new video name
 */
function getNewThumbnailPath(videoDir: string, newVideoBaseName: string): string {
  return join(getThumbnailsDir(videoDir), `${newVideoBaseName}.jpg`);
}

/**
 * Rename a video file and its associated files (frames, transcript, summary)
 * @param video - The video record to rename
 * @param suggestedFilename - The suggested filename from Claude's analysis (kebab-case slug)
 * @returns Result containing old and new paths
 */
export async function renameVideo(
  video: VideoRecord,
  suggestedFilename: string
): Promise<RenameResult> {
  const videoPath = video.original_path;
  const videoDir = dirname(videoPath);
  const extension = extname(videoPath);

  const spinner = ora({
    text: `Renaming ${chalk.cyan(video.original_name)}`,
    color: 'blue',
  }).start();

  try {
    // Get date prefix from file modification time
    const datePrefix = getDatePrefix(videoPath);

    // Sanitize the suggested filename
    const sanitizedSlug = sanitizeSlug(suggestedFilename);

    // Build base name with date prefix
    const newBaseName = `${datePrefix}_${sanitizedSlug}`;

    // Get unique filename to handle conflicts
    const newFileName = getUniqueFilename(videoDir, newBaseName, extension);
    const newPath = join(videoDir, newFileName);
    const newVideoBaseName = basename(newFileName, extension);

    // Rename the video file
    renameSync(videoPath, newPath);

    // Rename associated files and directories
    // 1. Frames directory: frames/{old-name}/ -> frames/{new-name}/
    const oldFramesDir = getFramesDir(videoPath);
    const newFramesDir = getNewFramesDir(videoDir, newVideoBaseName);
    renameDirectoryIfExists(oldFramesDir, newFramesDir);

    // 2. Transcript file: transcripts/{old-name}.txt -> transcripts/{new-name}.txt
    const oldTranscriptPath = getTranscriptPath(videoPath);
    const newTranscriptPath = getNewTranscriptPath(videoDir, newVideoBaseName);
    renameFileIfExists(oldTranscriptPath, newTranscriptPath);

    // 3. Summary file: summaries/{old-name}.txt -> summaries/{new-name}.txt
    const oldSummaryPath = getSummaryPath(videoPath);
    const newSummaryPath = getNewSummaryPath(videoDir, newVideoBaseName);
    renameFileIfExists(oldSummaryPath, newSummaryPath);

    // 4. Summary JSON: summaries/{old-name}.json -> summaries/{new-name}.json
    const oldSummaryJsonPath = getSummaryJsonPath(videoPath);
    const newSummaryJsonPath = getNewSummaryJsonPath(videoDir, newVideoBaseName);
    renameFileIfExists(oldSummaryJsonPath, newSummaryJsonPath);

    // 5. Thumbnail: .ai-video-cataloger/thumbnails/{old-name}.jpg -> {new-name}.jpg
    const oldThumbnailPath = getThumbnailPath(videoPath);
    const newThumbnailPath = getNewThumbnailPath(videoDir, newVideoBaseName);
    renameFileIfExists(oldThumbnailPath, newThumbnailPath);

    // Update database: set new name and status to completed
    updateVideoNewName(video.id, newFileName);
    updateVideoStatus(video.id, 'completed');

    spinner.succeed(`Renamed ${chalk.cyan(video.original_name)} to ${chalk.green(newFileName)}`);

    return {
      oldPath: videoPath,
      newPath,
      newName: newFileName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Failed to rename ${chalk.cyan(video.original_name)}: ${message}`);
    throw error;
  }
}
