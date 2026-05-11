/**
 * Doctor service - comprehensive system prerequisites check
 * Checks all dependencies: bundled ffmpeg, bundled whisper, claude CLI, ollama
 * Reports status, version, and installation suggestions for each
 */

import { execa } from 'execa';
import chalk from 'chalk';
import { getFFmpegInfo } from './ffmpeg-setup.js';
import { getWhisperInfo } from './whisper-setup.js';
import { getFilteredEnv } from './env-filter.js';
import {
  isJsonMode,
  emitStarted,
  emitCompleted,
  logHuman,
} from './json-output.js';

/**
 * Status of a single dependency
 */
export interface DependencyStatus {
  name: string;
  available: boolean;
  version: string | null;
  source: 'bundled' | 'system' | null;
  path: string | null;
  installHint: string;
}

/**
 * Result of the doctor command
 */
export interface DoctorResult {
  dependencies: DependencyStatus[];
  allAvailable: boolean;
}

/**
 * Check bundled/system ffmpeg status
 */
async function checkFfmpeg(): Promise<DependencyStatus> {
  const info = await getFFmpegInfo();

  return {
    name: 'ffmpeg',
    available: info.available,
    version: info.available ? info.version : null,
    source: info.available ? (info.bundled ? 'bundled' : 'system') : null,
    path: info.available ? info.ffmpegPath : null,
    installHint: 'FFmpeg is bundled with the CLI. If missing, try reinstalling the package.',
  };
}

/**
 * Check bundled/system whisper status
 */
async function checkWhisper(): Promise<DependencyStatus> {
  const info = await getWhisperInfo();

  return {
    name: 'whisper',
    available: info.available,
    version: info.available ? info.version : null,
    source: info.available ? (info.bundled ? 'bundled' : 'system') : null,
    path: info.available ? info.whisperPath : null,
    installHint: 'Whisper can be bundled or installed via: pip install openai-whisper',
  };
}

/**
 * Check Claude Code CLI status
 */
async function checkClaudeCli(): Promise<DependencyStatus> {
  try {
    const { stdout } = await execa('claude', ['--version'], { timeout: 5000, env: getFilteredEnv() });
    const version = stdout.trim();

    return {
      name: 'claude',
      available: true,
      version,
      source: 'system',
      path: null, // claude is typically installed globally
      installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
    };
  } catch {
    return {
      name: 'claude',
      available: false,
      version: null,
      source: null,
      path: null,
      installHint: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
    };
  }
}

/**
 * Check Ollama status
 */
async function checkOllama(): Promise<DependencyStatus> {
  try {
    const { stdout } = await execa('ollama', ['--version'], { timeout: 5000, env: getFilteredEnv() });
    // Output is typically "ollama version 0.1.xx" or similar
    const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : stdout.trim();

    return {
      name: 'ollama',
      available: true,
      version,
      source: 'system',
      path: null,
      installHint: 'Install Ollama from https://ollama.com or via: brew install ollama',
    };
  } catch {
    return {
      name: 'ollama',
      available: false,
      version: null,
      source: null,
      path: null,
      installHint: 'Install Ollama from https://ollama.com or via: brew install ollama',
    };
  }
}

/**
 * Display a single dependency status in human-readable format
 */
function displayDependencyStatus(dep: DependencyStatus): void {
  const statusIcon = dep.available ? chalk.green('✓') : chalk.red('✗');
  const statusText = dep.available ? chalk.green('available') : chalk.red('not found');

  // Build version/source info string
  let versionInfo = '';
  if (dep.available && dep.version) {
    versionInfo = chalk.gray(` (${dep.version})`);
  }

  // Show source (bundled vs system) for ffmpeg and whisper
  let sourceInfo = '';
  if (dep.available && dep.source) {
    const sourceLabel = dep.source === 'bundled' ? chalk.cyan('[bundled]') : chalk.yellow('[system]');
    sourceInfo = ` ${sourceLabel}`;
  }

  logHuman(`  ${statusIcon} ${chalk.bold(dep.name)}: ${statusText}${versionInfo}${sourceInfo}`);

  // Show install hint if not available
  if (!dep.available) {
    logHuman(chalk.gray(`    → ${dep.installHint}`));
  }
}

/**
 * Run the doctor command - check all dependencies
 */
export async function runDoctor(): Promise<DoctorResult> {
  // Emit started event for JSON mode
  emitStarted('doctor');

  logHuman(chalk.bold('\n🩺 System Prerequisites Check\n'));

  // Check all dependencies in parallel
  const [ffmpeg, whisper, claude, ollama] = await Promise.all([
    checkFfmpeg(),
    checkWhisper(),
    checkClaudeCli(),
    checkOllama(),
  ]);

  const dependencies = [ffmpeg, whisper, claude, ollama];
  const allAvailable = dependencies.every((dep) => dep.available);

  // Display results in human-readable format
  if (!isJsonMode()) {
    logHuman(chalk.underline('Dependencies:'));
    logHuman('');

    for (const dep of dependencies) {
      displayDependencyStatus(dep);
    }

    logHuman('');

    // Summary
    if (allAvailable) {
      logHuman(chalk.green('✓ All prerequisites are satisfied!\n'));
    } else {
      const missingCount = dependencies.filter((d) => !d.available).length;
      logHuman(chalk.yellow(`⚠ ${missingCount} prerequisite${missingCount === 1 ? '' : 's'} missing.\n`));
      logHuman(chalk.gray('Some features may not work without all prerequisites installed.\n'));
    }
  }

  const result: DoctorResult = {
    dependencies,
    allAvailable,
  };

  // Emit completed event with full data
  emitCompleted({
    dependencies: dependencies.map((dep) => ({
      name: dep.name,
      available: dep.available,
      version: dep.version,
      source: dep.source,
      path: dep.path,
      installHint: dep.installHint,
    })),
    allAvailable,
  });

  return result;
}
