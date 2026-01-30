#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

import { Command } from 'commander';
import { checkPrerequisites, scanDirectory, extractFrames, extractAudio, transcribeAudio, analyzeVideo, renameVideo, getSuggestedFilenameFromSummary } from './services/index.js';
import { initDatabase, closeDatabase, updateVideoStatus } from './db/index.js';
import chalk from 'chalk';
import type { VideoRecord } from './types/index.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read package.json for version
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

/**
 * CLI options interface
 */
interface CliOptions {
  frames: number;
  skipRename: boolean;
  verbose: boolean;
}

// Global options object
let cliOptions: CliOptions = {
  frames: 3,
  skipRename: false,
  verbose: false,
};

/**
 * Log verbose output if --verbose flag is set
 */
function logVerbose(message: string): void {
  if (cliOptions.verbose) {
    console.log(chalk.gray(`[verbose] ${message}`));
  }
}

async function run(directory: string, options: CliOptions): Promise<void> {
  cliOptions = options;

  if (cliOptions.verbose) {
    console.log(chalk.gray('[verbose] Verbose mode enabled'));
    console.log(chalk.gray(`[verbose] Options: frames=${options.frames}, skipRename=${options.skipRename}`));
  }

  // Check prerequisites
  const allPrerequisitesMet = await checkPrerequisites();

  if (!allPrerequisitesMet) {
    process.exit(1);
  }

  // Initialize database
  await initDatabase();

  // Register cleanup handler
  process.on('exit', () => {
    closeDatabase();
  });

  logVerbose(`Scanning directory: ${directory}`);

  // Scan directory for videos
  const scanResult = await scanDirectory(directory);

  // Combine new and resuming videos for processing
  const allVideos = [...scanResult.resumingVideos, ...scanResult.newVideos];

  // Exit gracefully if no videos to process
  if (allVideos.length === 0) {
    if (scanResult.totalFound === 0) {
      process.exit(0);
    }
    // All videos already completed
    console.log('\nNothing to do.');
    process.exit(0);
  }

  // Process each video
  console.log(chalk.blue('\nProcessing videos...'));

  for (const video of allVideos) {
    try {
      await processVideo(video);
    } catch (error) {
      // Error already logged by the respective service
      // Continue with next video (error handling to be improved in US-013)
      continue;
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('ai-video-cataloger')
    .description('CLI tool that analyzes videos, transcribes with local Whisper, generates summaries via Claude Code CLI, and renames files based on content')
    .version(packageJson.version)
    .argument('[directory]', 'Directory to scan for videos', process.cwd())
    .option('-f, --frames <number>', 'Number of frames to extract', (value) => parseInt(value, 10), 3)
    .option('-s, --skip-rename', 'Only generate summaries, do not rename files', false)
    .option('-v, --verbose', 'Show detailed output', false)
    .action(async (directory: string, options: { frames: number; skipRename: boolean; verbose: boolean }) => {
      await run(directory, options);
    });

  await program.parseAsync(process.argv);
}

/**
 * Process a single video through all required steps
 * Resumes from the last successful step based on current status
 */
async function processVideo(video: VideoRecord): Promise<void> {
  logVerbose(`Processing video: ${video.original_name} (status: ${video.status})`);

  // Step 1: Extract frames (if not already done)
  if (video.status === 'pending') {
    logVerbose(`Extracting ${cliOptions.frames} frames...`);
    await extractFrames(video, cliOptions.frames);
    video.status = 'frames_extracted';
  }

  // Step 2: Extract audio (if not already done)
  // Note: When resuming, we assume audio was extracted if past this stage
  let hasAudio = true;
  if (video.status === 'frames_extracted') {
    logVerbose('Extracting audio...');
    const audioResult = await extractAudio(video);
    hasAudio = audioResult.hasAudio;
    video.status = 'audio_extracted';
  }

  // Step 3: Transcribe audio (if not already done)
  // Note: When resuming, we check for transcript file existence
  let hasTranscript = hasAudio;
  if (video.status === 'audio_extracted') {
    logVerbose('Transcribing audio...');
    const transcriptionResult = await transcribeAudio(video, hasAudio);
    hasTranscript = transcriptionResult.transcribed;
    video.status = 'transcribed';
  }

  // Step 4: Analyze video with Claude (if not already done)
  let suggestedFilename = '';
  if (video.status === 'transcribed') {
    logVerbose('Analyzing with Claude...');
    const analysis = await analyzeVideo(video, hasTranscript);
    suggestedFilename = analysis.suggestedFilename;
    video.status = 'analyzed';
  }

  // Step 5: Rename video file (if not already done and --skip-rename not set)
  if (video.status === 'analyzed') {
    if (cliOptions.skipRename) {
      logVerbose('Skipping rename (--skip-rename flag set)');
      console.log(chalk.yellow(`Skipped renaming ${video.original_name} (--skip-rename)`));
      // Mark as completed without renaming
      updateVideoStatus(video.id, 'completed');
      video.status = 'completed';
    } else {
      // When resuming from analyzed status, get the filename from the saved summary
      if (!suggestedFilename) {
        suggestedFilename = getSuggestedFilenameFromSummary(video.original_path) || 'video-content';
      }
      logVerbose(`Renaming to: ${suggestedFilename}`);
      await renameVideo(video, suggestedFilename);
      video.status = 'completed';
    }
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
