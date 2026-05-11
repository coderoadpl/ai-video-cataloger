/**
 * Folder scan service
 * Lists all video files in a folder with metadata and database status
 */

import ffmpeg from 'fluent-ffmpeg';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import chalk from 'chalk';
import { getVideoByPath, getDatabaseDir, getVideoByHash } from '../db/index.js';
import { hashFile } from '../utils/hash.js';
import type { VideoStatus } from '../types/index.js';
import { isJsonMode, emitStarted, emitCompleted, outputJson, logHuman, emitError } from './json-output.js';
import { configureFfmpeg } from './ffmpeg-setup.js';

// Configure ffmpeg to use bundled binaries (or fall back to system)
configureFfmpeg();

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

/**
 * Video file metadata with database status
 */
export interface ScannedVideo {
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  duration: number | null;
  durationFormatted: string | null;
  status: VideoStatus | 'not_tracked';
  errorMessage?: string | null;
  contentHash: string | null;  // Unique identifier based on file content (survives renames)
}

/**
 * Result of scanning a folder
 */
export interface FolderScanResult {
  folder: string;
  databasePath: string | null;
  videos: ScannedVideo[];
  summary: {
    total: number;
    tracked: number;
    pending: number;
    inProgress: number;
    completed: number;
    error: number;
    notTracked: number;
  };
}

/**
 * Format bytes to human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration in seconds to human-readable string (HH:MM:SS or MM:SS)
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get video duration in seconds using ffprobe
 */
function getVideoDuration(videoPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        resolve(null);
        return;
      }
      const duration = metadata.format.duration;
      if (duration === undefined) {
        resolve(null);
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Check if a status represents "in progress" (partial completion)
 */
function isInProgressStatus(status: VideoStatus): boolean {
  return ['frames_extracted', 'audio_extracted', 'transcribed', 'analyzed'].includes(status);
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
    if (isJsonMode()) {
      emitError(`Error reading directory: ${message}`, { code: 'READ_ERROR', data: { directory } });
    } else {
      console.error(chalk.red(`Error reading directory: ${message}`));
    }
    return [];
  }

  return videoFiles.sort();
}

/**
 * Scan a folder and list all video files with metadata and status
 *
 * @param folder - The folder to scan
 * @param options - Scan options (databaseInitialized: whether database is already initialized)
 * @returns Folder scan result with video list and summary
 */
export async function scanFolder(
  folder: string,
  options: { databaseInitialized?: boolean } = {}
): Promise<FolderScanResult> {
  const absoluteFolder = resolve(folder);
  const videoFiles = findVideoFiles(absoluteFolder);

  // Get database path if database exists
  let databasePath: string | null = null;
  if (options.databaseInitialized) {
    try {
      databasePath = join(getDatabaseDir(absoluteFolder), 'catalog.db');
    } catch {
      // Database not initialized, that's OK
    }
  }

  const videos: ScannedVideo[] = [];
  const summary = {
    total: 0,
    tracked: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    error: 0,
    notTracked: 0,
  };

  for (const videoPath of videoFiles) {
    const filename = basename(videoPath);
    const stats = statSync(videoPath);
    const size = stats.size;

    // Get video duration
    const duration = await getVideoDuration(videoPath);

    // Compute content hash for this file (fast partial hash)
    let contentHash: string | null = null;
    try {
      contentHash = await hashFile(videoPath);
    } catch {
      // If hashing fails, continue without hash
    }

    // Get database status if database is initialized
    let status: VideoStatus | 'not_tracked' = 'not_tracked';
    let errorMessage: string | null = null;

    if (options.databaseInitialized) {
      // First try to find by path (exact match for unchanged files)
      let videoRecord = getVideoByPath(videoPath);

      // If not found by path but we have a hash, try to find by hash
      // This handles renamed files - the content hash stays the same
      if (!videoRecord && contentHash) {
        videoRecord = getVideoByHash(contentHash);
      }

      if (videoRecord) {
        status = videoRecord.status;
        errorMessage = videoRecord.error_message;
        // Use the hash from database if available (should be same)
        contentHash = videoRecord.file_hash || contentHash;
      }
    }

    const video: ScannedVideo = {
      path: videoPath,
      filename,
      size,
      sizeFormatted: formatSize(size),
      duration,
      durationFormatted: duration !== null ? formatDuration(duration) : null,
      status,
      errorMessage,
      contentHash,
    };

    videos.push(video);

    // Update summary counts
    summary.total++;
    if (status === 'not_tracked') {
      summary.notTracked++;
    } else {
      summary.tracked++;
      if (status === 'pending') {
        summary.pending++;
      } else if (status === 'completed') {
        summary.completed++;
      } else if (status === 'error') {
        summary.error++;
      } else if (isInProgressStatus(status)) {
        summary.inProgress++;
      }
    }
  }

  return {
    folder: absoluteFolder,
    databasePath,
    videos,
    summary,
  };
}

/**
 * Get status badge for display
 */
function getStatusBadge(status: VideoStatus | 'not_tracked'): string {
  switch (status) {
    case 'completed':
      return chalk.green('✓ done');
    case 'pending':
      return chalk.blue('○ pending');
    case 'error':
      return chalk.red('✗ error');
    case 'not_tracked':
      return chalk.gray('- none');
    default:
      // In progress statuses
      return chalk.yellow('◑ in progress');
  }
}

/**
 * Display scan results to the user
 * Supports both human-readable and JSON output modes
 */
export function displayScanResult(result: FolderScanResult): void {
  if (isJsonMode()) {
    emitStarted('scan', { folder: result.folder });
    outputJson(result);
    emitCompleted({ ...result });
    return;
  }

  // Human-readable output
  logHuman(chalk.bold(`\nVideos in: ${result.folder}`));
  logHuman(chalk.gray('─────────────────────────────────────────────────────────────\n'));

  if (result.videos.length === 0) {
    logHuman(chalk.yellow('No video files found.'));
    logHuman(chalk.gray(`Supported formats: ${VIDEO_EXTENSIONS.join(', ')}\n`));
    return;
  }

  // Display each video
  for (const video of result.videos) {
    const badge = getStatusBadge(video.status);
    const duration = video.durationFormatted || chalk.gray('??:??');
    const size = video.sizeFormatted;

    logHuman(`  ${badge}  ${chalk.cyan(video.filename)}`);
    logHuman(chalk.gray(`          ${duration}  •  ${size}`));

    if (video.status === 'error' && video.errorMessage) {
      logHuman(chalk.red(`          Error: ${video.errorMessage}`));
    }
  }

  // Display summary
  logHuman(chalk.gray('\n─────────────────────────────────────────────────────────────'));
  logHuman(chalk.bold('\nSummary:'));

  const parts: string[] = [];
  parts.push(`${result.summary.total} total`);
  if (result.summary.completed > 0) {
    parts.push(chalk.green(`${result.summary.completed} done`));
  }
  if (result.summary.inProgress > 0) {
    parts.push(chalk.yellow(`${result.summary.inProgress} in progress`));
  }
  if (result.summary.pending > 0) {
    parts.push(chalk.blue(`${result.summary.pending} pending`));
  }
  if (result.summary.error > 0) {
    parts.push(chalk.red(`${result.summary.error} error`));
  }
  if (result.summary.notTracked > 0) {
    parts.push(chalk.gray(`${result.summary.notTracked} not tracked`));
  }

  logHuman(`  ${parts.join('  •  ')}\n`);
}
