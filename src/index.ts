#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

import { checkPrerequisites, scanDirectory } from './services/index.js';
import { initDatabase, closeDatabase } from './db/index.js';

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

  // Further processing will be added in subsequent user stories
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
