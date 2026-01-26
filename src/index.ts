#!/usr/bin/env node

/**
 * AI Video Cataloger
 * CLI tool that analyzes videos, transcribes with local Whisper,
 * generates summaries via Claude Code CLI, and renames files based on content.
 */

async function main(): Promise<void> {
  console.log('AI Video Cataloger - Starting...');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
