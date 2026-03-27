/**
 * Prerequisites checker service
 * Verifies all required dependencies are installed before running
 */

import { execa } from 'execa';
import chalk from 'chalk';
import { getFFmpegInfo } from './ffmpeg-setup.js';
import { getWhisperInfo } from './whisper-setup.js';
import type { WhisperMode } from '../types/index.js';

export interface PrerequisiteOptions {
  whisperMode: WhisperMode;
}

interface PrerequisiteResult {
  name: string;
  found: boolean;
  version?: string;
  installHint: string;
}

/**
 * Check Node.js version (>= 18.0.0)
 */
async function checkNodeVersion(): Promise<PrerequisiteResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  return {
    name: 'Node.js',
    found: major >= 18,
    version: version,
    installHint: 'Install Node.js >= 18.0.0 from https://nodejs.org'
  };
}

/**
 * Check for ffmpeg (bundled or system)
 */
async function checkFfmpeg(): Promise<PrerequisiteResult> {
  const info = await getFFmpegInfo();

  if (info.available) {
    const bundledText = info.bundled ? ' [bundled]' : ' [system]';
    return {
      name: 'ffmpeg',
      found: true,
      version: info.version + bundledText,
      installHint: 'FFmpeg is bundled with the CLI'
    };
  }

  return {
    name: 'ffmpeg',
    found: false,
    installHint: 'FFmpeg should be bundled with the CLI. Try reinstalling.'
  };
}

/**
 * Check for Claude Code CLI
 */
async function checkClaudeCli(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await execa('claude', ['--version']);
    const version = stdout.trim();

    return {
      name: 'Claude Code CLI',
      found: true,
      version: version,
      installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code'
    };
  } catch {
    return {
      name: 'Claude Code CLI',
      found: false,
      installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code'
    };
  }
}

/**
 * Check for local Whisper installation (bundled or system)
 */
async function checkWhisper(): Promise<PrerequisiteResult> {
  const info = await getWhisperInfo();

  if (info.available) {
    const bundledText = info.bundled ? ' [bundled]' : ' [system]';
    return {
      name: 'Whisper',
      found: true,
      version: info.version + bundledText,
      installHint: 'Whisper can be bundled or installed via: pip install openai-whisper'
    };
  }

  return {
    name: 'Whisper',
    found: false,
    installHint: 'Install Whisper: pip install openai-whisper'
  };
}

/**
 * Display a single prerequisite result
 */
function displayResult(result: PrerequisiteResult): void {
  if (result.found) {
    const versionText = result.version ? ` (${result.version})` : '';
    console.log(`${chalk.green('✓')} ${result.name}${versionText}`);
  } else {
    console.log(`${chalk.red('✗')} ${result.name}`);
    console.log(`  ${chalk.gray(result.installHint)}`);
  }
}

/**
 * Check all prerequisites and return whether all are met
 * @param options - Optional prerequisite options (e.g., whisperMode)
 */
export async function checkPrerequisites(options?: PrerequisiteOptions): Promise<boolean> {
  const whisperMode = options?.whisperMode ?? 'local';

  console.log(chalk.bold('\nChecking prerequisites...\n'));

  // Base prerequisites (always required)
  const baseChecks = [
    checkNodeVersion(),
    checkFfmpeg(),
    checkClaudeCli(),
  ];

  // Only check for local Whisper if using local mode
  if (whisperMode === 'local') {
    baseChecks.push(checkWhisper());
  }

  const results = await Promise.all(baseChecks);

  for (const result of results) {
    displayResult(result);
  }

  // If using API or skip mode, show that Whisper check was skipped
  if (whisperMode === 'api') {
    console.log(`${chalk.blue('○')} Whisper (skipped - using OpenAI API)`);
  } else if (whisperMode === 'skip') {
    console.log(`${chalk.blue('○')} Whisper (skipped - transcription disabled)`);
  }

  console.log('');

  const allFound = results.every(r => r.found);

  if (!allFound) {
    console.log(chalk.red('Some prerequisites are missing. Please install them and try again.\n'));
  } else {
    console.log(chalk.green('All prerequisites satisfied!\n'));
  }

  return allFound;
}
