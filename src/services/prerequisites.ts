/**
 * Prerequisites checker service
 * Verifies all required dependencies are installed before running
 */

import { execa } from 'execa';
import chalk from 'chalk';

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
 * Check for ffmpeg installation
 */
async function checkFfmpeg(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await execa('ffmpeg', ['-version']);
    const versionMatch = stdout.match(/ffmpeg version (\S+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    return {
      name: 'ffmpeg',
      found: true,
      version: version,
      installHint: 'Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)'
    };
  } catch {
    return {
      name: 'ffmpeg',
      found: false,
      installHint: 'Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)'
    };
  }
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
 * Check for local Whisper installation
 */
async function checkWhisper(): Promise<PrerequisiteResult> {
  try {
    // Whisper doesn't have a --version flag, so we just check if it runs
    await execa('whisper', ['--help']);

    return {
      name: 'Whisper',
      found: true,
      version: 'installed',
      installHint: 'Install Whisper: pip install openai-whisper'
    };
  } catch {
    return {
      name: 'Whisper',
      found: false,
      installHint: 'Install Whisper: pip install openai-whisper'
    };
  }
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
 */
export async function checkPrerequisites(): Promise<boolean> {
  console.log(chalk.bold('\nChecking prerequisites...\n'));

  const results = await Promise.all([
    checkNodeVersion(),
    checkFfmpeg(),
    checkClaudeCli(),
    checkWhisper()
  ]);

  for (const result of results) {
    displayResult(result);
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
