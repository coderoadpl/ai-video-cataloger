#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

import { Command } from 'commander';
import { checkPrerequisites, scanDirectory, extractFrames, extractAudio, transcribeAudio, analyzeVideo, renameVideo, getSuggestedFilenameFromSummary, cleanupTempAudio, getTempAudioPath, runInteractiveMenu, displayModelList, type WhisperModel } from './services/index.js';
import { initDatabase, closeDatabase, updateVideoStatus } from './db/index.js';
import chalk from 'chalk';
import type { VideoRecord, WhisperMode } from './types/index.js';
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
  retryErrors: boolean;
  timeout: number;
  whisper: WhisperMode;
  whisperModel: WhisperModel;
  yes: boolean;
}

// Global options object
let cliOptions: CliOptions = {
  frames: 3,
  skipRename: false,
  verbose: false,
  retryErrors: false,
  timeout: 120,
  whisper: 'local',
  whisperModel: 'base',
  yes: false,
};

// Progress tracking
interface ProcessingStats {
  totalVideos: number;
  currentIndex: number;
  processedCount: number;
  errorCount: number;
  errors: Array<{ videoName: string; error: string }>;
}

let processingStats: ProcessingStats = {
  totalVideos: 0,
  currentIndex: 0,
  processedCount: 0,
  errorCount: 0,
  errors: [],
};

/**
 * Log verbose output if --verbose flag is set
 */
function logVerbose(message: string): void {
  if (cliOptions.verbose) {
    console.log(chalk.gray(`[verbose] ${message}`));
  }
}

/**
 * Get progress prefix showing current video position (e.g., "[1/5]")
 */
function getProgressPrefix(): string {
  return chalk.blue(`[${processingStats.currentIndex}/${processingStats.totalVideos}]`);
}

/**
 * Log current step being processed
 */
function logStep(step: string, videoName: string): void {
  console.log(`\n${getProgressPrefix()} ${chalk.bold(step)} - ${chalk.cyan(videoName)}`);
}

/**
 * Display final processing summary
 */
function displaySummary(): void {
  console.log('\n' + chalk.bold('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold('                      Processing Summary'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════\n'));

  // Success count
  const successCount = processingStats.processedCount;
  if (successCount > 0) {
    console.log(chalk.green(`  ✓ ${successCount} video${successCount === 1 ? '' : 's'} processed successfully`));
  }

  // Error count
  if (processingStats.errorCount > 0) {
    console.log(chalk.red(`  ✗ ${processingStats.errorCount} video${processingStats.errorCount === 1 ? '' : 's'} failed`));

    // List errors
    console.log(chalk.red('\n  Errors:'));
    for (const error of processingStats.errors) {
      console.log(chalk.red(`    • ${error.videoName}: ${error.error}`));
    }
  }

  // No videos processed at all
  if (successCount === 0 && processingStats.errorCount === 0) {
    console.log(chalk.yellow('  No videos were processed'));
  }

  console.log('\n' + chalk.bold('═══════════════════════════════════════════════════════════\n'));
}

async function run(directory: string, options: CliOptions): Promise<void> {
  cliOptions = options;

  if (cliOptions.verbose) {
    console.log(chalk.gray('[verbose] Verbose mode enabled'));
    console.log(chalk.gray(`[verbose] Options: frames=${options.frames}, skipRename=${options.skipRename}, retryErrors=${options.retryErrors}, timeout=${options.timeout}s, whisper=${options.whisper}, whisperModel=${options.whisperModel}`));
  }

  // Validate OPENAI_API_KEY if using API mode
  if (cliOptions.whisper === 'api') {
    if (!process.env.OPENAI_API_KEY) {
      console.error(chalk.red('\n✗ Error: OPENAI_API_KEY environment variable is required when using --whisper api'));
      console.error(chalk.gray('  Set it with: export OPENAI_API_KEY=your-api-key'));
      process.exit(1);
    }
    logVerbose('OPENAI_API_KEY found');
  }

  // Check prerequisites
  const allPrerequisitesMet = await checkPrerequisites({ whisperMode: cliOptions.whisper });

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
  const scanResult = await scanDirectory(directory, { retryErrors: cliOptions.retryErrors });

  // Combine new, resuming, and retrying videos for processing
  const allVideos = [...scanResult.retryingVideos, ...scanResult.resumingVideos, ...scanResult.newVideos];

  // Exit gracefully if no videos to process
  if (allVideos.length === 0) {
    if (scanResult.totalFound === 0) {
      process.exit(0);
    }
    // All videos already completed
    console.log('\nNothing to do.');
    process.exit(0);
  }

  // Initialize processing stats
  processingStats = {
    totalVideos: allVideos.length,
    currentIndex: 0,
    processedCount: 0,
    errorCount: 0,
    errors: [],
  };

  // Process each video
  console.log(chalk.blue(`\nProcessing ${allVideos.length} video${allVideos.length === 1 ? '' : 's'}...\n`));

  for (const video of allVideos) {
    processingStats.currentIndex++;

    try {
      await processVideo(video);
      processingStats.processedCount++;
    } catch (error) {
      // Track the error for summary
      const errorMessage = error instanceof Error ? error.message : String(error);
      processingStats.errorCount++;
      processingStats.errors.push({
        videoName: video.original_name,
        error: errorMessage,
      });
      // Update video status to 'error' with error message in database
      updateVideoStatus(video.id, 'error', errorMessage);
      // Best-effort cleanup of temporary audio file on error
      const tempAudioPath = getTempAudioPath(video.original_path);
      cleanupTempAudio(tempAudioPath);
      // Continue with next video
      continue;
    }
  }

  // Display final summary
  displaySummary();
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
    .option('-r, --retry-errors', 'Re-process videos that previously failed with errors', false)
    .option('-t, --timeout <seconds>', 'Timeout for Claude analysis in seconds', (value) => parseInt(value, 10), 120)
    .option('-w, --whisper <mode>', 'Transcription mode: local, api, or skip', (value: string) => {
      const validModes = ['local', 'api', 'skip'];
      if (!validModes.includes(value)) {
        console.error(chalk.red(`\nInvalid whisper mode: ${value}`));
        console.error(chalk.gray(`  Valid modes: ${validModes.join(', ')}`));
        process.exit(1);
      }
      return value as WhisperMode;
    }, 'local')
    .option('--skip-transcribe', 'Skip transcription (alias for --whisper skip)', false)
    .option('-y, --yes', 'Skip interactive menu and use defaults', false)
    .option('--non-interactive', 'Skip interactive menu (alias for --yes)', false)
    .action(async (directory: string, options: { frames: number; skipRename: boolean; verbose: boolean; retryErrors: boolean; timeout: number; whisper: WhisperMode; skipTranscribe: boolean; yes: boolean; nonInteractive: boolean }) => {
      // Handle --skip-transcribe alias
      const whisperMode = options.skipTranscribe ? 'skip' : options.whisper;
      // Handle --non-interactive alias
      const skipMenu = options.yes || options.nonInteractive;

      // Check if any configuration flags were explicitly provided
      const hasConfigFlags = process.argv.some(arg =>
        arg.startsWith('-f') || arg.startsWith('--frames') ||
        arg.startsWith('-s') || arg === '--skip-rename' ||
        arg.startsWith('-r') || arg === '--retry-errors' ||
        arg.startsWith('-t') || arg.startsWith('--timeout') ||
        arg.startsWith('-w') || arg.startsWith('--whisper') ||
        arg === '--skip-transcribe'
      );

      // If running without any flags and not --yes, show interactive menu
      if (!skipMenu && !hasConfigFlags) {
        const defaultSettings = {
          frames: options.frames,
          skipRename: options.skipRename,
          whisper: whisperMode,
          whisperModel: 'base' as WhisperModel,
          timeout: options.timeout,
        };

        const menuResult = await runInteractiveMenu(directory, defaultSettings);

        if (menuResult === null) {
          // User chose to exit
          process.exit(0);
        }

        // Use settings from menu
        await run(directory, {
          frames: menuResult.frames,
          skipRename: menuResult.skipRename,
          verbose: options.verbose,
          retryErrors: options.retryErrors,
          timeout: menuResult.timeout,
          whisper: menuResult.whisper,
          whisperModel: menuResult.whisperModel,
          yes: true,
        });
      } else {
        // Run directly with CLI options
        await run(directory, { ...options, whisper: whisperMode, whisperModel: 'base', yes: skipMenu });
      }
    });

  // Models subcommand
  const modelsCommand = program
    .command('models')
    .description('Manage Whisper models');

  modelsCommand
    .command('list')
    .description('List available Whisper models and their download status')
    .action(async () => {
      // Initialize database to read active model from config
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      displayModelList();
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
    logStep('Extracting frames', video.original_name);
    logVerbose(`Extracting ${cliOptions.frames} frames...`);
    await extractFrames(video, cliOptions.frames);
    video.status = 'frames_extracted';
  }

  // Step 2: Extract audio (if not already done)
  // Note: When resuming, we assume audio was extracted if past this stage
  let hasAudio = true;
  if (video.status === 'frames_extracted') {
    logStep('Extracting audio', video.original_name);
    logVerbose('Extracting audio...');
    const audioResult = await extractAudio(video);
    hasAudio = audioResult.hasAudio;
    video.status = 'audio_extracted';
  }

  // Step 3: Transcribe audio (if not already done)
  // Note: When resuming, we check for transcript file existence
  let hasTranscript = hasAudio;
  if (video.status === 'audio_extracted') {
    logStep('Transcribing audio', video.original_name);
    logVerbose(`Transcribing audio (mode: ${cliOptions.whisper}, model: ${cliOptions.whisperModel})...`);
    const transcriptionResult = await transcribeAudio(video, hasAudio, { mode: cliOptions.whisper, model: cliOptions.whisperModel });
    hasTranscript = transcriptionResult.transcribed;
    video.status = 'transcribed';

    // Clean up temporary audio file after transcription
    const tempAudioPath = getTempAudioPath(video.original_path);
    cleanupTempAudio(tempAudioPath);
    logVerbose(`Cleaned up temporary audio file: ${tempAudioPath}`);
  }

  // Step 4: Analyze video with Claude (if not already done)
  let suggestedFilename = '';
  if (video.status === 'transcribed') {
    logStep('Analyzing with Claude', video.original_name);
    logVerbose(`Analyzing with Claude (timeout: ${cliOptions.timeout}s)...`);
    const analysis = await analyzeVideo(video, hasTranscript, { timeoutSeconds: cliOptions.timeout });
    suggestedFilename = analysis.suggestedFilename;
    video.status = 'analyzed';
  }

  // Step 5: Rename video file (if not already done and --skip-rename not set)
  if (video.status === 'analyzed') {
    if (cliOptions.skipRename) {
      logStep('Skipping rename', video.original_name);
      logVerbose('Skipping rename (--skip-rename flag set)');
      console.log(chalk.yellow(`  Skipped renaming (--skip-rename flag set)`));
      // Mark as completed without renaming
      updateVideoStatus(video.id, 'completed');
      video.status = 'completed';
    } else {
      logStep('Renaming video', video.original_name);
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
