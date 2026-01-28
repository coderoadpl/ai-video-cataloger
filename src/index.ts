#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

import { checkPrerequisites, scanDirectory, extractFrames, extractAudio, transcribeAudio } from './services/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import chalk from 'chalk';

/**
 * Check if we should skip prerequisite checks (for --help and --version)
 */
function shouldSkipPrerequisites(): boolean {
  const args = process.argv.slice(2);
  return args.includes('--help') || args.includes('-h') ||
         args.includes('--version') || args.includes('-V');
}

async function main(): Promise<void> {
  console.log('AI Video Cataloger - Starting...');

  // Skip prerequisite checks for help and version flags
  if (!shouldSkipPrerequisites()) {
    const allPrerequisitesMet = await checkPrerequisites();

    if (!allPrerequisitesMet) {
      process.exit(1);
    }
  }

  // Initialize database
  await initDatabase();

  // Register cleanup handler
  process.on('exit', () => {
    closeDatabase();
  });

  // Get directory from arguments (default: current directory)
  const args = process.argv.slice(2);
  const directory = args.find(arg => !arg.startsWith('-')) || process.cwd();

  // Scan directory for videos
  const scanResult = await scanDirectory(directory);

  // Exit gracefully if no videos to process
  if (scanResult.newVideos.length === 0) {
    if (scanResult.totalFound === 0) {
      process.exit(0);
    }
    // All videos already completed
    console.log('\nNothing to do.');
    process.exit(0);
  }

  // Process each video
  console.log(chalk.blue('\nProcessing videos...'));

  for (const video of scanResult.newVideos) {
    try {
      // Step 1: Extract frames (if not already done)
      if (video.status === 'pending') {
        await extractFrames(video);
        video.status = 'frames_extracted';
      }

      // Step 2: Extract audio (if not already done)
      let hasAudio = true;
      if (video.status === 'frames_extracted') {
        const audioResult = await extractAudio(video);
        hasAudio = audioResult.hasAudio;
        video.status = 'audio_extracted';
      }

      // Step 3: Transcribe audio (if not already done)
      if (video.status === 'audio_extracted') {
        await transcribeAudio(video, hasAudio);
        video.status = 'transcribed';
      }

      // Further processing will be added in subsequent user stories
    } catch (error) {
      // Error already logged by the respective service
      // Continue with next video (error handling to be improved in US-013)
      continue;
    }
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
