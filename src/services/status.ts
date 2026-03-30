/**
 * Status display service
 * Displays the processing status of all tracked videos
 */

import chalk from 'chalk';
import { getAllVideos } from '../db/index.js';
import type { VideoRecord, VideoStatus } from '../types/index.js';
import { isJsonMode, emitStarted, emitCompleted, outputJson } from './json-output.js';

/**
 * Status groups for organizing videos in display
 */
interface StatusGroup {
  label: string;
  color: (text: string) => string;
  videos: VideoRecord[];
}

/**
 * Get human-readable label for a status
 */
function getStatusLabel(status: VideoStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'frames_extracted':
      return 'In Progress (frames extracted)';
    case 'audio_extracted':
      return 'In Progress (audio extracted)';
    case 'transcribed':
      return 'In Progress (transcribed)';
    case 'analyzed':
      return 'In Progress (analyzed)';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

/**
 * Check if a status represents "in progress" (partial completion)
 */
function isInProgressStatus(status: VideoStatus): boolean {
  return ['frames_extracted', 'audio_extracted', 'transcribed', 'analyzed'].includes(status);
}

/**
 * Group videos by their status category
 */
function groupVideosByStatus(videos: VideoRecord[]): StatusGroup[] {
  const groups: StatusGroup[] = [
    { label: 'Completed', color: chalk.green, videos: [] },
    { label: 'In Progress', color: chalk.yellow, videos: [] },
    { label: 'Pending', color: chalk.blue, videos: [] },
    { label: 'Error', color: chalk.red, videos: [] },
  ];

  for (const video of videos) {
    if (video.status === 'completed') {
      groups[0].videos.push(video);
    } else if (isInProgressStatus(video.status)) {
      groups[1].videos.push(video);
    } else if (video.status === 'pending') {
      groups[2].videos.push(video);
    } else if (video.status === 'error') {
      groups[3].videos.push(video);
    }
  }

  return groups;
}

/**
 * Get status data for all videos (used by JSON output)
 */
export interface VideoStatusData {
  path: string;
  originalName: string;
  newName: string | null;
  status: VideoStatus;
  statusLabel: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get status summary data
 */
export interface StatusSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  error: number;
}

/**
 * Get all video status data as structured objects
 */
export function getStatusData(): { videos: VideoStatusData[]; summary: StatusSummary } {
  const videos = getAllVideos();
  const groups = groupVideosByStatus(videos);

  const videoData: VideoStatusData[] = videos.map((video) => ({
    path: video.original_path,
    originalName: video.original_name,
    newName: video.new_name,
    status: video.status,
    statusLabel: getStatusLabel(video.status),
    errorMessage: video.error_message,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
  }));

  const summary: StatusSummary = {
    total: videos.length,
    completed: groups[0].videos.length,
    inProgress: groups[1].videos.length,
    pending: groups[2].videos.length,
    error: groups[3].videos.length,
  };

  return { videos: videoData, summary };
}

/**
 * Display the status of all tracked videos
 * Groups by status: completed, in progress, pending, error
 * Shows counts for each group and individual video details
 * Supports JSON output mode
 */
export function displayStatus(): void {
  const videos = getAllVideos();

  // JSON mode - output structured data
  if (isJsonMode()) {
    emitStarted('status');
    const data = getStatusData();
    outputJson(data);
    emitCompleted(data);
    return;
  }

  // Handle empty database
  if (videos.length === 0) {
    console.log(chalk.yellow('\nNo videos are currently being tracked.'));
    console.log(chalk.gray('  Run "ai-video-cataloger <directory>" to scan and process videos.\n'));
    return;
  }

  // Group videos by status
  const groups = groupVideosByStatus(videos);

  // Display header
  console.log('\n' + chalk.bold('Video Processing Status'));
  console.log(chalk.gray('─────────────────────────────────────────────────────────────\n'));

  // Display summary counts
  console.log(chalk.bold('Summary:'));
  for (const group of groups) {
    const count = group.videos.length;
    if (count > 0) {
      console.log(`  ${group.color('●')} ${group.label}: ${chalk.bold(count.toString())}`);
    } else {
      console.log(`  ${chalk.gray('○')} ${group.label}: ${chalk.gray('0')}`);
    }
  }

  console.log('\n' + chalk.gray('─────────────────────────────────────────────────────────────\n'));

  // Display each group with videos
  for (const group of groups) {
    if (group.videos.length === 0) {
      continue;
    }

    console.log(group.color(chalk.bold(`${group.label} (${group.videos.length}):`)));

    for (const video of group.videos) {
      const displayName = video.new_name || video.original_name;

      if (video.status === 'error' && video.error_message) {
        // Show error message for failed videos
        console.log(`  ${chalk.red('✗')} ${displayName}`);
        console.log(`    ${chalk.gray('Error:')} ${chalk.red(video.error_message)}`);
      } else if (isInProgressStatus(video.status)) {
        // Show current step for in-progress videos
        console.log(`  ${chalk.yellow('○')} ${displayName}`);
        console.log(`    ${chalk.gray('Status:')} ${getStatusLabel(video.status)}`);
      } else if (video.status === 'completed') {
        // Show completed videos with optional renamed info
        console.log(`  ${chalk.green('✓')} ${displayName}`);
        if (video.new_name && video.new_name !== video.original_name) {
          console.log(`    ${chalk.gray('(was:')} ${video.original_name}${chalk.gray(')')}`);
        }
      } else {
        // Pending videos
        console.log(`  ${chalk.blue('○')} ${displayName}`);
      }
    }

    console.log();
  }

  console.log(chalk.gray('─────────────────────────────────────────────────────────────\n'));
}
