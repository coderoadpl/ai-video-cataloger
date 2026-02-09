/**
 * Interactive menu service
 * Provides interactive prompts for configuration when running without flags
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import type { WhisperMode } from '../types/index.js';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export interface MenuSettings {
  frames: number;
  skipRename: boolean;
  whisper: WhisperMode;
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

  const { action } = await inquirer.prompt<{ action: MenuAction }>([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Start with defaults', value: 'start' },
        { name: 'Configure settings', value: 'configure' },
        { name: 'View current settings', value: 'view' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);

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
  console.log(`  Claude timeout:       ${chalk.cyan(settings.timeout + 's')}`);
  console.log(chalk.gray('─────────────────────────────────────\n'));
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
        // This will be implemented in US-019
        console.log(chalk.yellow('\n  Settings configuration coming soon (US-019).\n'));
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
