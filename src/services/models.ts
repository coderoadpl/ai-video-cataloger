/**
 * Model management service
 * Handles listing, status checking, and management of Whisper models
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { getConfig, setConfig } from '../db/index.js';
import { getWhisperModelsDir } from './whisper-setup.js';
import { isJsonMode, emitStarted, emitCompleted, emitError, outputJson } from './json-output.js';

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
 * Get the legacy Whisper cache directory path
 * Local Whisper (Python) stores models in ~/.cache/whisper/
 */
export function getLegacyWhisperCacheDir(): string {
  return join(homedir(), '.cache', 'whisper');
}

/**
 * Get the Whisper cache directory path
 * Returns the new path: ~/.ai-video-cataloger/models/whisper/
 */
export function getWhisperCacheDir(): string {
  return getWhisperModelsDir();
}

/**
 * Check if a Whisper model is downloaded
 * Checks both:
 * - New location: ~/.ai-video-cataloger/models/whisper/ (GGML format for whisper.cpp)
 * - Legacy location: ~/.cache/whisper/ (PyTorch format for OpenAI Whisper)
 */
export function isModelDownloaded(modelName: WhisperModelName): boolean {
  // Check new location (GGML format for whisper.cpp)
  const newModelsDir = getWhisperModelsDir();
  const ggmlModelFile = join(newModelsDir, `ggml-${modelName}.bin`);
  if (existsSync(ggmlModelFile)) {
    return true;
  }

  // Also check without prefix
  const directModelFile = join(newModelsDir, `${modelName}.bin`);
  if (existsSync(directModelFile)) {
    return true;
  }

  // Check legacy location (PyTorch format for OpenAI Whisper Python package)
  const legacyCacheDir = getLegacyWhisperCacheDir();
  const ptModelFile = join(legacyCacheDir, `${modelName}.pt`);
  return existsSync(ptModelFile);
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
 * Supports JSON output mode
 */
export function displayModelList(): void {
  const models = listModels();

  // JSON mode - output structured data
  if (isJsonMode()) {
    emitStarted('models_list');
    const data = { models };
    outputJson(data);
    emitCompleted(data);
    return;
  }

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

/**
 * Set the active (default) Whisper model
 * Validates the model name and stores it in the database config table
 * Supports JSON output mode
 * @returns true if successful, false if model name is invalid
 */
export function setActiveModel(modelName: string): boolean {
  // JSON mode - emit started event
  if (isJsonMode()) {
    emitStarted('models_use', { modelName });
  }

  // Validate model name
  if (!isValidModelName(modelName)) {
    if (isJsonMode()) {
      emitError(`Invalid model name: ${modelName}`, {
        code: 'INVALID_MODEL',
        data: { validModels: MODEL_DEFINITIONS.map(m => m.name) },
      });
    } else {
      console.error(chalk.red(`\nInvalid model name: ${modelName}`));
      console.error(chalk.gray('  Valid models: ' + MODEL_DEFINITIONS.map(m => m.name).join(', ')));
    }
    return false;
  }

  // Store in database config
  setConfig('whisper_model', modelName);

  // Get model info
  const modelInfo = MODEL_DEFINITIONS.find(m => m.name === modelName);
  const downloaded = isModelDownloaded(modelName as WhisperModelName);

  // JSON mode - output result
  if (isJsonMode()) {
    const data = {
      model: modelName,
      size: modelInfo?.size,
      downloaded,
    };
    outputJson(data);
    emitCompleted(data);
    return true;
  }

  // Display confirmation
  console.log(chalk.green(`\n✓ Active model set to: ${chalk.bold(modelName)}`));

  // Show additional info about the model
  if (modelInfo) {
    console.log(chalk.gray(`  Size: ${modelInfo.size}`));

    // Check if downloaded
    if (downloaded) {
      console.log(chalk.green(`  Status: downloaded`));
    } else {
      console.log(chalk.yellow(`  Status: not downloaded (will be downloaded on first use)`));
    }
  }

  console.log();
  return true;
}
