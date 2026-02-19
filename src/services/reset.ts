/**
 * Reset service for AI Video Cataloger
 * Handles database reset operations with confirmation
 */

import chalk from 'chalk';
import { confirm as confirmPrompt } from '@inquirer/prompts';
import { getAllVideos, clearAllVideos, resetVideoByFilename } from '../db/index.js';

/**
 * Options for reset operations
 */
export interface ResetOptions {
  force?: boolean;
}

/**
 * Display what will be reset and prompt for confirmation
 * Returns true if user confirms, false otherwise
 */
async function confirmReset(message: string, force: boolean): Promise<boolean> {
  if (force) {
    return true;
  }

  const result = await confirmPrompt({
    message,
    default: false,
  });

  return result;
}

/**
 * Reset all video records in the database
 * Preserves the config table
 */
export async function resetAllVideos(options: ResetOptions = {}): Promise<boolean> {
  const videos = getAllVideos();

  if (videos.length === 0) {
    console.log(chalk.yellow('\nNo video records in database. Nothing to reset.'));
    return true;
  }

  // Display what will be reset
  console.log(chalk.yellow('\nThis will reset the following video records:\n'));

  // Group by status for display
  const byStatus: Record<string, number> = {};
  for (const video of videos) {
    byStatus[video.status] = (byStatus[video.status] || 0) + 1;
  }

  for (const [status, count] of Object.entries(byStatus)) {
    console.log(chalk.gray(`  ${status}: ${count} video${count === 1 ? '' : 's'}`));
  }
  console.log(chalk.gray(`  ─────────────────`));
  console.log(chalk.bold(`  Total: ${videos.length} video${videos.length === 1 ? '' : 's'}`));
  console.log();

  // Confirm reset
  const confirmed = await confirmReset(
    chalk.red('Are you sure you want to clear all video records?'),
    options.force || false
  );

  if (!confirmed) {
    console.log(chalk.gray('\nReset cancelled.'));
    return false;
  }

  // Perform the reset
  const count = clearAllVideos();
  console.log(chalk.green(`\n✓ Cleared ${count} video record${count === 1 ? '' : 's'} from database.`));
  console.log(chalk.gray('  Config settings were preserved.'));

  return true;
}

/**
 * Reset a specific video to pending status
 */
export async function resetSingleVideo(filename: string, options: ResetOptions = {}): Promise<boolean> {
  // Try to find the video first
  const videos = getAllVideos();
  const video = videos.find(v => v.original_name === filename);

  if (!video) {
    console.log(chalk.red(`\n✗ Video not found: ${filename}`));
    console.log(chalk.gray('\nUse "ai-video-cataloger status" to see tracked videos.'));
    return false;
  }

  // Display what will be reset
  console.log(chalk.yellow('\nVideo to reset:\n'));
  console.log(chalk.gray(`  Filename: ${chalk.white(video.original_name)}`));
  console.log(chalk.gray(`  Current status: ${chalk.white(video.status)}`));
  if (video.error_message) {
    console.log(chalk.gray(`  Error: ${chalk.red(video.error_message)}`));
  }
  if (video.new_name) {
    console.log(chalk.gray(`  Renamed to: ${chalk.white(video.new_name)}`));
  }
  console.log();

  // If already pending, nothing to do
  if (video.status === 'pending') {
    console.log(chalk.yellow('Video is already in pending status. Nothing to reset.'));
    return true;
  }

  // Confirm reset
  const confirmed = await confirmReset(
    chalk.yellow(`Reset "${filename}" to pending status?`),
    options.force || false
  );

  if (!confirmed) {
    console.log(chalk.gray('\nReset cancelled.'));
    return false;
  }

  // Perform the reset
  const updatedVideo = resetVideoByFilename(filename);

  if (updatedVideo) {
    console.log(chalk.green(`\n✓ Reset "${filename}" to pending status.`));
    console.log(chalk.gray('  The video will be reprocessed on the next run.'));
    return true;
  } else {
    console.log(chalk.red(`\n✗ Failed to reset video.`));
    return false;
  }
}
