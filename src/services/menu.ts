/**
 * Interactive menu service
 * Provides interactive prompts for configuration when running without flags
 */

import { select, number, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import type { WhisperMode } from '../types/index.js';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface MenuSettings {
  frames: number;
  skipRename: boolean;
  whisper: WhisperMode;
  whisperModel: WhisperModel;
  timeout: number;
}

export type MenuAction = 'start' | 'configure' | 'view' | 'exit';

/**
 * Count video files in a directory (non-recursive)
 */
export function countVideosInDirectory(directory: string): number {
  const absoluteDir = resolve(directory);
  let count = 0;

  try {
    const entries = readdirSync(absoluteDir);

    for (const entry of entries) {
      const fullPath = join(absoluteDir, entry);

      try {
        const stats = statSync(fullPath);

        if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            count++;
          }
        }
      } catch {
        // Skip files we can't stat
        continue;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return 0;
  }

  return count;
}

/**
 * Display the main interactive menu
 */
export async function showMainMenu(videoCount: number, _currentSettings: MenuSettings): Promise<MenuAction> {
  console.log('\n' + chalk.bold('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold('                    AI Video Cataloger'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════\n'));

  if (videoCount === 0) {
    console.log(chalk.yellow('  No video files found in the current directory.\n'));
  } else {
    console.log(chalk.cyan(`  Found ${videoCount} video${videoCount === 1 ? '' : 's'} in directory\n`));
  }

  const action = await select<MenuAction>({
    message: 'What would you like to do?',
    choices: [
      { name: 'Start with defaults', value: 'start' },
      { name: 'Configure settings', value: 'configure' },
      { name: 'View current settings', value: 'view' },
      { name: 'Exit', value: 'exit' },
    ],
  });

  return action;
}

/**
 * Display current settings
 */
export function displayCurrentSettings(settings: MenuSettings): void {
  console.log('\n' + chalk.bold('Current Settings:'));
  console.log(chalk.gray('─────────────────────────────────────'));
  console.log(`  Frames to extract:    ${chalk.cyan(settings.frames)}`);
  console.log(`  Rename videos:        ${settings.skipRename ? chalk.yellow('No') : chalk.green('Yes')}`);
  console.log(`  Transcription mode:   ${chalk.cyan(settings.whisper)}`);
  if (settings.whisper === 'local') {
    console.log(`  Whisper model:        ${chalk.cyan(settings.whisperModel)}`);
  }
  console.log(`  Claude timeout:       ${chalk.cyan(settings.timeout + 's')}`);
  console.log(chalk.gray('─────────────────────────────────────\n'));
}

/**
 * Configure settings through interactive submenu
 */
export async function configureSettings(currentSettings: MenuSettings): Promise<MenuSettings> {
  const settings = { ...currentSettings };

  console.log('\n' + chalk.bold('Configure Settings'));
  console.log(chalk.gray('─────────────────────────────────────\n'));

  // 1. Transcription method selection
  const transcriptionMethod = await select<WhisperMode>({
    message: 'Transcription method:',
    choices: [
      { name: 'Local Whisper (requires whisper CLI)', value: 'local' },
      { name: 'OpenAI API (requires OPENAI_API_KEY)', value: 'api' },
      { name: 'Skip transcription', value: 'skip' },
    ],
    default: settings.whisper,
  });
  settings.whisper = transcriptionMethod;

  // 2. Whisper model selection (only if local mode)
  if (transcriptionMethod === 'local') {
    const whisperModel = await select<WhisperModel>({
      message: 'Whisper model:',
      choices: [
        { name: 'tiny (75MB) - Fastest, lower quality', value: 'tiny' },
        { name: 'base (142MB) - Default, good balance', value: 'base' },
        { name: 'small (466MB) - Better quality', value: 'small' },
        { name: 'medium (1.5GB) - High quality', value: 'medium' },
        { name: 'large-v3 (3.1GB) - Best quality, slowest', value: 'large-v3' },
      ],
      default: settings.whisperModel,
    });
    settings.whisperModel = whisperModel;
  }

  // 3. Frame count input
  const frameCount = await number({
    message: 'Number of frames to extract (1-10):',
    default: settings.frames,
    validate: (input) => {
      if (input === undefined || isNaN(input) || input < 1 || input > 10) {
        return 'Please enter a number between 1 and 10';
      }
      return true;
    },
  });
  settings.frames = frameCount ?? settings.frames;

  // 4. Rename videos toggle
  const renameVideos = await confirm({
    message: 'Rename videos based on content?',
    default: !settings.skipRename,
  });
  settings.skipRename = !renameVideos;

  console.log(chalk.green('\n  Settings updated!\n'));

  return settings;
}

/**
 * Run the interactive menu loop
 * @returns Settings to use or null if user chose to exit
 */
export async function runInteractiveMenu(directory: string, defaultSettings: MenuSettings): Promise<MenuSettings | null> {
  const videoCount = countVideosInDirectory(directory);
  let settings = { ...defaultSettings };

  while (true) {
    const action = await showMainMenu(videoCount, settings);

    switch (action) {
      case 'start':
        return settings;

      case 'configure':
        settings = await configureSettings(settings);
        break;

      case 'view':
        displayCurrentSettings(settings);
        break;

      case 'exit':
        console.log(chalk.gray('\nExiting...\n'));
        return null;
    }
  }
}
