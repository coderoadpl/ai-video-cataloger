/**
 * Folder scan service
 * Lists all video files in a folder with metadata and database status
 */

import ffmpeg from 'fluent-ffmpeg';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
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
 * Artifact data for processed videos
 */
export interface VideoArtifacts {
  // Extracted frames (available after 'frames_extracted' status)
  framePaths: string[] | null;
  // Transcript text (available after 'transcribed' status)
  transcriptContent: string | null;
  transcriptPath: string | null;
  // Summary/analysis (available after 'analyzed' or 'completed' status)
  summaryContent: string | null;
  summaryPath: string | null;
  // New filename if renamed (available after 'completed' status)
  newFilename: string | null;
}

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
  artifacts: VideoArtifacts;   // Processing artifacts (frames, transcript, summary)
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
 * Get artifact paths for a video
 * Uses newName if available (for renamed videos), otherwise uses original filename
 */
function getArtifactPaths(videoPath: string, folderPath: string, newName: string | null): {
  framesDir: string;
  transcriptPath: string;
  summaryPath: string;
} {
  // If video was renamed, artifacts are stored with the new name
  // Otherwise, use the original filename
  let videoName: string;
  if (newName) {
    // newName includes extension, so remove it
    videoName = newName.replace(/\.[^.]+$/, '');
  } else {
    const videoFilename = basename(videoPath);
    videoName = videoFilename.replace(/\.[^.]+$/, '');
  }

  return {
    framesDir: join(folderPath, 'frames', videoName),
    transcriptPath: join(folderPath, 'transcripts', `${videoName}.txt`),
    summaryPath: join(folderPath, 'summaries', `${videoName}.txt`),
  };
}

/**
 * Load artifacts for a video based on its status
 */
function loadArtifacts(
  videoPath: string,
  folderPath: string,
  status: VideoStatus | 'not_tracked',
  newName: string | null
): VideoArtifacts {
  const artifacts: VideoArtifacts = {
    framePaths: null,
    transcriptContent: null,
    transcriptPath: null,
    summaryContent: null,
    summaryPath: null,
    newFilename: newName,
  };

  // No artifacts for untracked or pending videos
  if (status === 'not_tracked' || status === 'pending') {
    return artifacts;
  }

  const paths = getArtifactPaths(videoPath, folderPath, newName);

  // Load frames if status is frames_extracted or beyond
  const hasFrames = ['frames_extracted', 'audio_extracted', 'transcribed', 'analyzed', 'completed'].includes(status);
  if (hasFrames && existsSync(paths.framesDir)) {
    try {
      const frameFiles = readdirSync(paths.framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .map(f => join(paths.framesDir, f));
      artifacts.framePaths = frameFiles.length > 0 ? frameFiles : null;
    } catch {
      // Ignore errors reading frames directory
    }
  }

  // Load transcript if status is transcribed or beyond
  const hasTranscript = ['transcribed', 'analyzed', 'completed'].includes(status);
  if (hasTranscript && existsSync(paths.transcriptPath)) {
    try {
      artifacts.transcriptContent = readFileSync(paths.transcriptPath, 'utf-8');
      artifacts.transcriptPath = paths.transcriptPath;
    } catch {
      // Ignore errors reading transcript
    }
  }

  // Load summary if status is analyzed or completed
  const hasSummary = ['analyzed', 'completed'].includes(status);
  if (hasSummary && existsSync(paths.summaryPath)) {
    try {
      artifacts.summaryContent = readFileSync(paths.summaryPath, 'utf-8');
      artifacts.summaryPath = paths.summaryPath;
    } catch {
      // Ignore errors reading summary
    }
  }

  return artifacts;
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
    let newName: string | null = null;

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
        newName = videoRecord.new_name;
        // Use the hash from database if available (should be same)
        contentHash = videoRecord.file_hash || contentHash;
      }
    }

    // Load artifacts based on status (frames, transcript, summary)
    const artifacts = loadArtifacts(videoPath, absoluteFolder, status, newName);

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
      artifacts,
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
