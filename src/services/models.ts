/**
 * Model management service
 * Handles listing, status checking, and management of Whisper models
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { getConfig } from '../db/index.js';

export type WhisperModelName = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface WhisperModelInfo {
  name: WhisperModelName;
  size: string;
  downloaded: boolean;
  active: boolean;
}

/**
 * Model definitions with their sizes
 */
const MODEL_DEFINITIONS: Array<{ name: WhisperModelName; size: string }> = [
  { name: 'tiny', size: '75MB' },
  { name: 'base', size: '142MB' },
  { name: 'small', size: '466MB' },
  { name: 'medium', size: '1.5GB' },
  { name: 'large-v3', size: '3.1GB' },
];

/**
 * Get the Whisper cache directory path
 * Local Whisper stores models in ~/.cache/whisper/
 */
export function getWhisperCacheDir(): string {
  return join(homedir(), '.cache', 'whisper');
}

/**
 * Check if a Whisper model is downloaded
 * Models are stored as .pt files in ~/.cache/whisper/
 */
export function isModelDownloaded(modelName: WhisperModelName): boolean {
  const cacheDir = getWhisperCacheDir();
  // Whisper model files are named like: tiny.pt, base.pt, small.pt, medium.pt, large-v3.pt
  const modelFile = join(cacheDir, `${modelName}.pt`);
  return existsSync(modelFile);
}

/**
 * Get the currently active (default) Whisper model
 * Stored in the database config table
 */
export function getActiveModel(): WhisperModelName {
  const activeModel = getConfig('whisper_model');
  if (activeModel && isValidModelName(activeModel)) {
    return activeModel as WhisperModelName;
  }
  return 'base'; // Default model
}

/**
 * Check if a string is a valid model name
 */
export function isValidModelName(name: string): boolean {
  return MODEL_DEFINITIONS.some(m => m.name === name);
}

/**
 * Get the list of all available Whisper models with their status
 */
export function listModels(): WhisperModelInfo[] {
  const activeModel = getActiveModel();

  return MODEL_DEFINITIONS.map(model => ({
    name: model.name,
    size: model.size,
    downloaded: isModelDownloaded(model.name),
    active: model.name === activeModel,
  }));
}

/**
 * Display the list of models in a formatted table
 */
export function displayModelList(): void {
  const models = listModels();

  console.log('\n' + chalk.bold('Available Whisper Models'));
  console.log(chalk.gray('─────────────────────────────────────────────────\n'));

  for (const model of models) {
    const statusIcon = model.downloaded
      ? chalk.green('✓')
      : chalk.gray('○');

    const activeIndicator = model.active
      ? chalk.cyan(' (active)')
      : '';

    const downloadStatus = model.downloaded
      ? chalk.green('downloaded')
      : chalk.gray('not downloaded');

    console.log(
      `  ${statusIcon} ${chalk.bold(model.name.padEnd(10))} ${chalk.gray(model.size.padEnd(8))} ${downloadStatus}${activeIndicator}`
    );
  }

  console.log('\n' + chalk.gray('─────────────────────────────────────────────────'));
  console.log(chalk.gray('  Use "ai-video-cataloger models use <name>" to set active model\n'));
}
