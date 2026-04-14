#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

import { Command } from 'commander';
import { checkPrerequisites, scanDirectory, extractFrames, extractAudio, transcribeAudio, analyzeVideo, renameVideo, getSuggestedFilenameFromSummary, cleanupTempAudio, getTempAudioPath, runInteractiveMenu, displayModelList, setActiveModel, displayStatus, resetAllVideos, resetSingleVideo, checkExistingFrames, checkExistingTranscript, setJsonMode, isJsonMode, emitStarted, emitProgress, emitCompleted, emitError, logHuman, generateThumbnail, downloadModel, deleteModel, displayAllConfig, displayConfigKey, setConfigCommand, runNestedCheck, checkForNestedDatabasesAndError, scanFolder, displayScanResult, type WhisperModel } from './services/index.js';
import { initDatabase, closeDatabase, updateVideoStatus, getVideoByPath, insertVideo } from './db/index.js';
import chalk from 'chalk';
import type { VideoRecord, WhisperMode } from './types/index.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname, basename, resolve } from 'node:path';
import { hashFile } from './utils/hash.js';
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
  json: boolean;
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
  json: false,
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
 * In JSON mode, emits a progress event instead of console output
 */
function logStep(step: string, videoName: string): void {
  if (isJsonMode()) {
    // Calculate percentage based on steps (5 total steps per video)
    const stepsMap: Record<string, number> = {
      'Extracting frames': 1,
      'Extracting audio': 2,
      'Transcribing audio': 3,
      'Analyzing with Claude': 4,
      'Renaming video': 5,
      'Skipping rename': 5,
    };
    const stepNumber = stepsMap[step] || 0;
    const percentage = Math.round((stepNumber / 5) * 100);

    emitProgress(step.toLowerCase().replace(/ /g, '_'), {
      percentage,
      current: processingStats.currentIndex,
      total: processingStats.totalVideos,
      data: { video: videoName, stepNumber, totalSteps: 5 },
    });
  } else {
    console.log(`\n${getProgressPrefix()} ${chalk.bold(step)} - ${chalk.cyan(videoName)}`);
  }
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

  // Emit started event for JSON mode
  emitStarted('process', {
    directory,
    options: {
      frames: options.frames,
      skipRename: options.skipRename,
      retryErrors: options.retryErrors,
      timeout: options.timeout,
      whisper: options.whisper,
      whisperModel: options.whisperModel,
    },
  });

  if (cliOptions.verbose && !isJsonMode()) {
    console.log(chalk.gray('[verbose] Verbose mode enabled'));
    console.log(chalk.gray(`[verbose] Options: frames=${options.frames}, skipRename=${options.skipRename}, retryErrors=${options.retryErrors}, timeout=${options.timeout}s, whisper=${options.whisper}, whisperModel=${options.whisperModel}`));
  }

  // Validate OPENAI_API_KEY if using API mode
  if (cliOptions.whisper === 'api') {
    if (!process.env.OPENAI_API_KEY) {
      if (isJsonMode()) {
        emitError('OPENAI_API_KEY environment variable is required when using --whisper api', { code: 'MISSING_API_KEY' });
      } else {
        console.error(chalk.red('\n✗ Error: OPENAI_API_KEY environment variable is required when using --whisper api'));
        console.error(chalk.gray('  Set it with: export OPENAI_API_KEY=your-api-key'));
      }
      process.exit(1);
    }
    logVerbose('OPENAI_API_KEY found');
  }

  // Check for nested databases before proceeding
  const canProceed = checkForNestedDatabasesAndError(directory);
  if (!canProceed) {
    process.exit(1);
  }

  // Check prerequisites
  const allPrerequisitesMet = await checkPrerequisites({ whisperMode: cliOptions.whisper });

  if (!allPrerequisitesMet) {
    if (isJsonMode()) {
      emitError('Prerequisites check failed', { code: 'PREREQUISITES_FAILED' });
    }
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
      emitCompleted({ videosProcessed: 0, totalFound: 0 });
      process.exit(0);
    }
    // All videos already completed
    logHuman('\nNothing to do.');
    emitCompleted({ videosProcessed: 0, totalFound: scanResult.totalFound, message: 'All videos already completed' });
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
  logHuman(chalk.blue(`\nProcessing ${allVideos.length} video${allVideos.length === 1 ? '' : 's'}...\n`));
  emitProgress('scanning', { total: allVideos.length, data: { totalFound: scanResult.totalFound } });

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
      // Emit error event for this video
      emitProgress('video_error', {
        current: processingStats.currentIndex,
        total: processingStats.totalVideos,
        data: { video: video.original_name, error: errorMessage },
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

  // Display final summary or emit completed event
  if (isJsonMode()) {
    emitCompleted({
      videosProcessed: processingStats.processedCount,
      errorCount: processingStats.errorCount,
      errors: processingStats.errors,
    });
  } else {
    displaySummary();
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
    .option('--json', 'Output results as newline-delimited JSON events', false)
    .action(async (directory: string, options: { frames: number; skipRename: boolean; verbose: boolean; retryErrors: boolean; timeout: number; whisper: WhisperMode; skipTranscribe: boolean; yes: boolean; nonInteractive: boolean; json: boolean }) => {
      // Handle --skip-transcribe alias
      const whisperMode = options.skipTranscribe ? 'skip' : options.whisper;
      // Handle --non-interactive alias
      const skipMenu = options.yes || options.nonInteractive;

      // Enable JSON output mode if --json flag is set
      if (options.json) {
        setJsonMode(true);
      }

      // Check if any configuration flags were explicitly provided
      const hasConfigFlags = process.argv.some(arg =>
        arg.startsWith('-f') || arg.startsWith('--frames') ||
        arg.startsWith('-s') || arg === '--skip-rename' ||
        arg.startsWith('-r') || arg === '--retry-errors' ||
        arg.startsWith('-t') || arg.startsWith('--timeout') ||
        arg.startsWith('-w') || arg.startsWith('--whisper') ||
        arg === '--skip-transcribe' ||
        arg === '--json'
      );

      // If running without any flags and not --yes, show interactive menu
      // JSON mode also skips the interactive menu
      if (!skipMenu && !hasConfigFlags && !options.json) {
        // Initialize database early so menu can check for errored videos
        await initDatabase(directory);

        const defaultSettings = {
          frames: options.frames,
          skipRename: options.skipRename,
          whisper: whisperMode,
          whisperModel: 'base' as WhisperModel,
          timeout: options.timeout,
          retryErrors: false,
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
          retryErrors: menuResult.retryErrors,
          timeout: menuResult.timeout,
          whisper: menuResult.whisper,
          whisperModel: menuResult.whisperModel,
          yes: true,
          json: options.json,
        });
      } else {
        // Run directly with CLI options
        await run(directory, { ...options, whisper: whisperMode, whisperModel: 'base', yes: skipMenu, json: options.json });
      }
    });

  // Models subcommand
  const modelsCommand = program
    .command('models')
    .description('Manage Whisper models');

  modelsCommand
    .command('list')
    .description('List available Whisper models and their download status')
    .option('--json', 'Output results as JSON', false)
    .action(async (_options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database to read active model from config
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      displayModelList();
    });

  modelsCommand
    .command('use <model-name>')
    .description('Set the active Whisper model to use by default')
    .option('--json', 'Output results as JSON', false)
    .action(async (modelName: string, _options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database to store active model in config
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      const success = setActiveModel(modelName);
      process.exit(success ? 0 : 1);
    });

  modelsCommand
    .command('download <model-name>')
    .description('Download a Whisper GGML model from Hugging Face')
    .option('--force', 'Re-download even if model already exists', false)
    .option('--json', 'Output results as newline-delimited JSON events', false)
    .action(async (modelName: string, options: { force: boolean; json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      try {
        await downloadModel(modelName, { force: options.force });
      } catch {
        // Error already logged by downloadModel
        process.exit(1);
      }
    });

  modelsCommand
    .command('delete <model-name>')
    .description('Delete a downloaded Whisper model')
    .option('--force', 'Skip confirmation and delete immediately', false)
    .option('--json', 'Output results as newline-delimited JSON events', false)
    .action(async (modelName: string, options: { force: boolean; json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      try {
        const result = await deleteModel(modelName, { force: options.force });
        // If deletion was skipped (requires --force), exit with 0 but don't process further
        if (!result.deleted) {
          process.exit(0);
        }
      } catch {
        // Error already logged by deleteModel
        process.exit(1);
      }
    });

  // Status command
  program
    .command('status')
    .description('Show processing status of all tracked videos')
    .option('--json', 'Output results as JSON', false)
    .action(async (_options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database to read video records
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      displayStatus();
    });

  // Reset command
  program
    .command('reset [filename]')
    .description('Reset video records. Without filename: clears all records. With filename: resets specific video to pending.')
    .option('--force', 'Skip confirmation prompt', false)
    .option('--json', 'Output results as JSON', false)
    .action(async (filename: string | undefined, options: { force: boolean; json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      let success: boolean;

      if (filename) {
        // Reset specific video
        success = await resetSingleVideo(filename, { force: options.force });
      } else {
        // Reset all videos
        success = await resetAllVideos({ force: options.force });
      }

      process.exit(success ? 0 : 1);
    });

  // Process single video command
  program
    .command('process <video-path>')
    .description('Process a single video file')
    .option('-f, --frames <number>', 'Number of frames to extract', (value) => parseInt(value, 10), 3)
    .option('-s, --skip-rename', 'Only generate summaries, do not rename files', false)
    .option('-v, --verbose', 'Show detailed output', false)
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
    .option('--whisper-model <model>', 'Whisper model to use', 'base')
    .option('--json', 'Output results as newline-delimited JSON events', false)
    .action(async (videoPath: string, options: { frames: number; skipRename: boolean; verbose: boolean; timeout: number; whisper: WhisperMode; whisperModel: string; json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      const absolutePath = resolve(videoPath);

      // Validate file exists
      if (!existsSync(absolutePath)) {
        if (isJsonMode()) {
          emitError(`File not found: ${absolutePath}`, { code: 'FILE_NOT_FOUND', data: { path: absolutePath } });
        } else {
          console.error(chalk.red(`\n✗ Error: File not found: ${absolutePath}`));
        }
        process.exit(1);
      }

      // Validate file is a video
      const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const ext = extname(absolutePath).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        if (isJsonMode()) {
          emitError(`Not a video file: ${absolutePath}`, {
            code: 'INVALID_FILE_TYPE',
            data: {
              path: absolutePath,
              extension: ext,
              supportedExtensions: VIDEO_EXTENSIONS
            }
          });
        } else {
          console.error(chalk.red(`\n✗ Error: Not a video file: ${absolutePath}`));
          console.error(chalk.gray(`  Supported formats: ${VIDEO_EXTENSIONS.join(', ')}`));
        }
        process.exit(1);
      }

      // Validate file is actually a file (not a directory)
      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        if (isJsonMode()) {
          emitError(`Path is not a file: ${absolutePath}`, { code: 'NOT_A_FILE', data: { path: absolutePath } });
        } else {
          console.error(chalk.red(`\n✗ Error: Path is not a file: ${absolutePath}`));
        }
        process.exit(1);
      }

      // Get video's parent directory and initialize database there
      const parentDir = dirname(absolutePath);
      const fileName = basename(absolutePath);

      // Set CLI options
      cliOptions = {
        frames: options.frames,
        skipRename: options.skipRename,
        verbose: options.verbose,
        retryErrors: true, // Always retry errors for single video processing
        timeout: options.timeout,
        whisper: options.whisper,
        whisperModel: options.whisperModel as WhisperModel,
        yes: true,
        json: options.json,
      };

      // Emit started event for JSON mode
      emitStarted('process_single', {
        videoPath: absolutePath,
        options: {
          frames: options.frames,
          skipRename: options.skipRename,
          timeout: options.timeout,
          whisper: options.whisper,
          whisperModel: options.whisperModel,
        },
      });

      // Validate OPENAI_API_KEY if using API mode
      if (cliOptions.whisper === 'api') {
        if (!process.env.OPENAI_API_KEY) {
          if (isJsonMode()) {
            emitError('OPENAI_API_KEY environment variable is required when using --whisper api', { code: 'MISSING_API_KEY' });
          } else {
            console.error(chalk.red('\n✗ Error: OPENAI_API_KEY environment variable is required when using --whisper api'));
            console.error(chalk.gray('  Set it with: export OPENAI_API_KEY=your-api-key'));
          }
          process.exit(1);
        }
      }

      // Check prerequisites
      const allPrerequisitesMet = await checkPrerequisites({ whisperMode: cliOptions.whisper });

      if (!allPrerequisitesMet) {
        if (isJsonMode()) {
          emitError('Prerequisites check failed', { code: 'PREREQUISITES_FAILED' });
        }
        process.exit(1);
      }

      // Initialize database in video's parent folder
      await initDatabase(parentDir);

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      // Initialize processing stats for single video
      processingStats = {
        totalVideos: 1,
        currentIndex: 0,
        processedCount: 0,
        errorCount: 0,
        errors: [],
      };

      try {
        // Check if video already exists in database
        let video = getVideoByPath(absolutePath);

        if (!video) {
          // New video - hash and insert
          logHuman(chalk.gray(`  Hashing: ${fileName}`));
          const fileHash = await hashFile(absolutePath);
          video = insertVideo(absolutePath, fileName, fileHash);
        }

        processingStats.currentIndex = 1;

        logHuman(chalk.blue(`\nProcessing: ${fileName}\n`));

        await processVideo(video);
        processingStats.processedCount = 1;

        // Emit completed event
        if (isJsonMode()) {
          emitCompleted({
            video: fileName,
            path: absolutePath,
            status: 'completed',
          });
        } else {
          console.log(chalk.green(`\n✓ Successfully processed: ${fileName}`));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        processingStats.errorCount = 1;
        processingStats.errors.push({
          videoName: fileName,
          error: errorMessage,
        });

        if (isJsonMode()) {
          emitError(errorMessage, {
            code: 'PROCESSING_ERROR',
            data: {
              video: fileName,
              path: absolutePath,
            }
          });
        } else {
          console.error(chalk.red(`\n✗ Error processing ${fileName}: ${errorMessage}`));
        }
        process.exit(1);
      }
    });

  // Thumbnail subcommand
  program
    .command('thumbnail <video-path>')
    .description('Generate a thumbnail for a video file')
    .option('--force', 'Regenerate thumbnail even if it already exists', false)
    .option('--json', 'Output results as newline-delimited JSON events', false)
    .action(async (videoPath: string, options: { force: boolean; json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      const absolutePath = resolve(videoPath);

      // Validate file exists
      if (!existsSync(absolutePath)) {
        if (isJsonMode()) {
          emitError(`File not found: ${absolutePath}`, { code: 'FILE_NOT_FOUND', data: { path: absolutePath } });
        } else {
          console.error(chalk.red(`\n✗ Error: File not found: ${absolutePath}`));
        }
        process.exit(1);
      }

      // Validate file is a video
      const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const ext = extname(absolutePath).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        if (isJsonMode()) {
          emitError(`Not a video file: ${absolutePath}`, {
            code: 'INVALID_FILE_TYPE',
            data: {
              path: absolutePath,
              extension: ext,
              supportedExtensions: VIDEO_EXTENSIONS
            }
          });
        } else {
          console.error(chalk.red(`\n✗ Error: Not a video file: ${absolutePath}`));
          console.error(chalk.gray(`  Supported formats: ${VIDEO_EXTENSIONS.join(', ')}`));
        }
        process.exit(1);
      }

      // Validate file is actually a file (not a directory)
      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        if (isJsonMode()) {
          emitError(`Path is not a file: ${absolutePath}`, { code: 'NOT_A_FILE', data: { path: absolutePath } });
        } else {
          console.error(chalk.red(`\n✗ Error: Path is not a file: ${absolutePath}`));
        }
        process.exit(1);
      }

      const fileName = basename(absolutePath);

      // Emit started event for JSON mode
      emitStarted('thumbnail', {
        videoPath: absolutePath,
        force: options.force,
      });

      try {
        const result = await generateThumbnail(absolutePath, { force: options.force });

        if (isJsonMode()) {
          emitCompleted({
            video: fileName,
            path: absolutePath,
            thumbnailPath: result.path,
            generated: result.generated,
            skipped: result.skipped,
          });
        } else {
          if (result.skipped) {
            console.log(chalk.yellow(`Thumbnail already exists for ${chalk.cyan(fileName)}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
            console.log(chalk.gray(`  Use --force to regenerate`));
          } else {
            console.log(chalk.green(`✓ Generated thumbnail for ${chalk.cyan(fileName)}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (isJsonMode()) {
          emitError(errorMessage, {
            code: 'THUMBNAIL_ERROR',
            data: {
              video: fileName,
              path: absolutePath,
            }
          });
        } else {
          console.error(chalk.red(`\n✗ Error generating thumbnail for ${fileName}: ${errorMessage}`));
        }
        process.exit(1);
      }
    });

  // Config subcommand
  const configCommand = program
    .command('config')
    .description('Manage per-folder configuration');

  configCommand
    .command('get [key]')
    .description('Get configuration value(s). Without key: show all config.')
    .option('--json', 'Output results as JSON', false)
    .action(async (key: string | undefined, _options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database to read config
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      if (key) {
        // Get specific key
        const success = displayConfigKey(key);
        process.exit(success ? 0 : 1);
      } else {
        // Get all config
        displayAllConfig();
      }
    });

  configCommand
    .command('set <key> <value>')
    .description('Set a configuration value')
    .option('--json', 'Output results as JSON', false)
    .action(async (key: string, value: string, _options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Initialize database to write config
      await initDatabase();

      // Register cleanup handler
      process.on('exit', () => {
        closeDatabase();
      });

      const success = setConfigCommand(key, value);
      process.exit(success ? 0 : 1);
    });

  // Check command - scan for nested databases
  program
    .command('check [folder]')
    .description('Check for nested .ai-video-cataloger/ database folders')
    .option('--json', 'Output results as JSON', false)
    .action(async (folder: string | undefined, _options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      // Default to current directory if no folder specified
      const targetFolder = folder ? resolve(folder) : process.cwd();

      // Validate folder exists
      if (!existsSync(targetFolder)) {
        if (isJsonMode()) {
          emitError(`Folder not found: ${targetFolder}`, { code: 'FOLDER_NOT_FOUND', data: { path: targetFolder } });
        } else {
          console.error(chalk.red(`\n✗ Error: Folder not found: ${targetFolder}`));
        }
        process.exit(1);
      }

      // Validate it's a directory
      const stats = statSync(targetFolder);
      if (!stats.isDirectory()) {
        if (isJsonMode()) {
          emitError(`Path is not a directory: ${targetFolder}`, { code: 'NOT_A_DIRECTORY', data: { path: targetFolder } });
        } else {
          console.error(chalk.red(`\n✗ Error: Path is not a directory: ${targetFolder}`));
        }
        process.exit(1);
      }

      const result = runNestedCheck(targetFolder);

      // Exit with non-zero code if nested databases found
      process.exit(result.hasNestedDatabases ? 1 : 0);
    });

  // Scan command - list videos in a folder with metadata and status
  program
    .command('scan <folder>')
    .description('List all video files in a folder with metadata and database status')
    .option('--json', 'Output results as JSON', false)
    .action(async (folder: string, _options: { json: boolean }, command: Command) => {
      // Enable JSON output mode if --json flag is set (check with optsWithGlobals for parent option inheritance)
      const globalOpts = command.optsWithGlobals<{ json: boolean }>();
      if (globalOpts.json) {
        setJsonMode(true);
      }

      const absoluteFolder = resolve(folder);

      // Validate folder exists
      if (!existsSync(absoluteFolder)) {
        if (isJsonMode()) {
          emitError(`Folder not found: ${absoluteFolder}`, { code: 'FOLDER_NOT_FOUND', data: { path: absoluteFolder } });
        } else {
          console.error(chalk.red(`\n✗ Error: Folder not found: ${absoluteFolder}`));
        }
        process.exit(1);
      }

      // Validate it's a directory
      const stats = statSync(absoluteFolder);
      if (!stats.isDirectory()) {
        if (isJsonMode()) {
          emitError(`Path is not a directory: ${absoluteFolder}`, { code: 'NOT_A_DIRECTORY', data: { path: absoluteFolder } });
        } else {
          console.error(chalk.red(`\n✗ Error: Path is not a directory: ${absoluteFolder}`));
        }
        process.exit(1);
      }

      // Try to initialize database if one exists
      let databaseInitialized = false;
      try {
        await initDatabase(absoluteFolder);
        databaseInitialized = true;

        // Register cleanup handler
        process.on('exit', () => {
          closeDatabase();
        });
      } catch {
        // No database exists, that's OK - we'll still list videos
      }

      const result = await scanFolder(absoluteFolder, { databaseInitialized });
      displayScanResult(result);
    });

  await program.parseAsync(process.argv);
}

/**
 * Process a single video through all required steps
 * Resumes from the last successful step based on current status
 * For error status, implements smart retry by checking existing artifacts
 */
async function processVideo(video: VideoRecord): Promise<void> {
  logVerbose(`Processing video: ${video.original_name} (status: ${video.status})`);

  // Smart retry handling for errored videos
  // Check what artifacts exist and determine where to resume
  let effectiveStatus = video.status;

  if (video.status === 'error') {
    // Check existing artifacts to determine where to resume
    const framesCheck = checkExistingFrames(video.original_path, cliOptions.frames);
    const hasTranscript = checkExistingTranscript(video.original_path);

    if (framesCheck.exists && hasTranscript) {
      // Both frames (with correct count) and transcript exist - skip to analysis
      effectiveStatus = 'transcribed';
      logVerbose(`Smart retry: Found ${framesCheck.count} frames and transcript, skipping to analysis`);
    } else if (framesCheck.exists) {
      // Frames exist with correct count but no transcript - skip to transcription
      effectiveStatus = 'frames_extracted';
      logVerbose(`Smart retry: Found ${framesCheck.count} frames, skipping to audio extraction`);
    } else if (framesCheck.count > 0 && framesCheck.count < cliOptions.frames) {
      // Frames exist but wrong count - need to re-extract
      effectiveStatus = 'pending';
      logVerbose(`Smart retry: Found ${framesCheck.count} frames but need ${cliOptions.frames}, re-extracting`);
    } else {
      // No frames - start from beginning
      effectiveStatus = 'pending';
      logVerbose(`Smart retry: No existing artifacts found, starting from beginning`);
    }
  }

  // Step 1: Extract frames (if not already done)
  if (effectiveStatus === 'pending') {
    logStep('Extracting frames', video.original_name);
    logVerbose(`Extracting ${cliOptions.frames} frames...`);
    await extractFrames(video, cliOptions.frames);
    effectiveStatus = 'frames_extracted';
  }

  // Step 2: Extract audio (if not already done)
  // Note: When resuming, we assume audio was extracted if past this stage
  let hasAudio = true;
  if (effectiveStatus === 'frames_extracted') {
    logStep('Extracting audio', video.original_name);
    logVerbose('Extracting audio...');
    const audioResult = await extractAudio(video);
    hasAudio = audioResult.hasAudio;
    effectiveStatus = 'audio_extracted';
  }

  // Step 3: Transcribe audio (if not already done)
  // Note: When resuming, we check for transcript file existence
  let hasTranscript = hasAudio;
  if (effectiveStatus === 'audio_extracted') {
    // Check if transcript already exists (smart retry optimization)
    if (checkExistingTranscript(video.original_path)) {
      logVerbose('Transcript already exists, skipping transcription');
      hasTranscript = true;
      effectiveStatus = 'transcribed';
      updateVideoStatus(video.id, 'transcribed');
    } else {
      logStep('Transcribing audio', video.original_name);
      logVerbose(`Transcribing audio (mode: ${cliOptions.whisper}, model: ${cliOptions.whisperModel})...`);
      const transcriptionResult = await transcribeAudio(video, hasAudio, { mode: cliOptions.whisper, model: cliOptions.whisperModel });
      hasTranscript = transcriptionResult.transcribed;
      effectiveStatus = 'transcribed';
    }

    // Clean up temporary audio file after transcription
    const tempAudioPath = getTempAudioPath(video.original_path);
    cleanupTempAudio(tempAudioPath);
    logVerbose(`Cleaned up temporary audio file: ${tempAudioPath}`);
  }

  // Step 4: Analyze video with Claude (if not already done)
  let suggestedFilename = '';
  if (effectiveStatus === 'transcribed') {
    logStep('Analyzing with Claude', video.original_name);
    logVerbose(`Analyzing with Claude (timeout: ${cliOptions.timeout}s)...`);
    const analysis = await analyzeVideo(video, hasTranscript, { timeoutSeconds: cliOptions.timeout, verbose: cliOptions.verbose });
    suggestedFilename = analysis.suggestedFilename;
    effectiveStatus = 'analyzed';
  }

  // Step 5: Rename video file (if not already done and --skip-rename not set)
  if (effectiveStatus === 'analyzed') {
    if (cliOptions.skipRename) {
      logStep('Skipping rename', video.original_name);
      logVerbose('Skipping rename (--skip-rename flag set)');
      logHuman(chalk.yellow(`  Skipped renaming (--skip-rename flag set)`));
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
