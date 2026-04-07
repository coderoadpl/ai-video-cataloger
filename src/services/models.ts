/**
 * Model management service
 * Handles listing, status checking, downloading, and management of Whisper models
 */

import { existsSync, createWriteStream, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import chalk from 'chalk';
import { getConfig, setConfig } from '../db/index.js';
import { getWhisperModelsDir, ensureWhisperModelsDirExists } from './whisper-setup.js';
import { isJsonMode, emitStarted, emitProgress, emitCompleted, emitError, outputJson } from './json-output.js';

export type WhisperModelName = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface WhisperModelInfo {
  name: WhisperModelName;
  size: string;
  downloaded: boolean;
  active: boolean;
}

/**
 * Model definitions with their sizes and Hugging Face URLs
 * GGML models from https://huggingface.co/ggerganov/whisper.cpp
 */
const MODEL_DEFINITIONS: Array<{ name: WhisperModelName; size: string; sizeBytes: number; url: string }> = [
  {
    name: 'tiny',
    size: '75MB',
    sizeBytes: 75_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'
  },
  {
    name: 'base',
    size: '142MB',
    sizeBytes: 142_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
  },
  {
    name: 'small',
    size: '466MB',
    sizeBytes: 466_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
  },
  {
    name: 'medium',
    size: '1.5GB',
    sizeBytes: 1_500_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'
  },
  {
    name: 'large-v3',
    size: '3.1GB',
    sizeBytes: 3_100_000_000,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'
  },
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

/**
 * Download result interface
 */
export interface ModelDownloadResult {
  model: WhisperModelName;
  path: string;
  downloaded: boolean;
  skipped: boolean;
  sizeBytes?: number;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format download speed to human-readable string
 */
function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Download a Whisper model from Hugging Face
 * Stores in ~/.ai-video-cataloger/models/whisper/
 *
 * @param modelName - Name of the model to download (tiny, base, small, medium, large-v3)
 * @param options - Download options
 * @returns Download result with path and status
 */
export async function downloadModel(
  modelName: string,
  options: { force?: boolean } = {}
): Promise<ModelDownloadResult> {
  // JSON mode - emit started event
  if (isJsonMode()) {
    emitStarted('models_download', { modelName, force: options.force });
  }

  // Validate model name
  if (!isValidModelName(modelName)) {
    const errorMessage = `Invalid model name: ${modelName}`;
    if (isJsonMode()) {
      emitError(errorMessage, {
        code: 'INVALID_MODEL',
        data: { validModels: MODEL_DEFINITIONS.map(m => m.name) },
      });
    } else {
      console.error(chalk.red(`\n✗ ${errorMessage}`));
      console.error(chalk.gray('  Valid models: ' + MODEL_DEFINITIONS.map(m => m.name).join(', ')));
    }
    throw new Error(errorMessage);
  }

  const typedModelName = modelName as WhisperModelName;
  const modelDef = MODEL_DEFINITIONS.find(m => m.name === typedModelName)!;

  // Check if already downloaded
  if (isModelDownloaded(typedModelName) && !options.force) {
    const modelsDir = getWhisperModelsDir();
    const modelPath = join(modelsDir, `ggml-${modelName}.bin`);

    if (isJsonMode()) {
      const result = {
        model: typedModelName,
        path: modelPath,
        downloaded: false,
        skipped: true,
      };
      outputJson(result);
      emitCompleted(result);
    } else {
      console.log(chalk.yellow(`\nModel '${modelName}' is already downloaded.`));
      console.log(chalk.gray(`  Path: ${modelPath}`));
      console.log(chalk.gray('  Use --force to re-download'));
    }

    return {
      model: typedModelName,
      path: modelPath,
      downloaded: false,
      skipped: true,
    };
  }

  // Ensure models directory exists
  ensureWhisperModelsDirExists();

  const modelsDir = getWhisperModelsDir();
  const modelPath = join(modelsDir, `ggml-${modelName}.bin`);
  const tempPath = join(modelsDir, `ggml-${modelName}.bin.tmp`);

  if (!isJsonMode()) {
    console.log(chalk.blue(`\nDownloading model: ${chalk.bold(modelName)} (${modelDef.size})`));
    console.log(chalk.gray(`  From: ${modelDef.url}`));
    console.log(chalk.gray(`  To: ${modelPath}\n`));
  }

  try {
    // Fetch with progress tracking
    const response = await fetch(modelDef.url);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const totalSize = contentLength || modelDef.sizeBytes;

    let downloadedBytes = 0;
    let lastProgressUpdate = Date.now();
    let lastBytes = 0;
    const startTime = Date.now();

    // Create write stream
    const fileStream = createWriteStream(tempPath);

    // Create a transform stream to track progress
    const body = response.body;
    if (!body) {
      throw new Error('Response body is null');
    }

    // Convert web ReadableStream to Node.js Readable
    const reader = body.getReader();
    const nodeStream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }

        downloadedBytes += value.length;

        // Update progress every 500ms or at significant milestones
        const now = Date.now();
        if (now - lastProgressUpdate >= 500 || downloadedBytes === totalSize) {
          const elapsed = (now - lastProgressUpdate) / 1000;
          const bytesSinceLast = downloadedBytes - lastBytes;
          const speed = elapsed > 0 ? bytesSinceLast / elapsed : 0;
          const percentage = totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0;

          if (isJsonMode()) {
            emitProgress('downloading', {
              percentage,
              data: {
                downloadedBytes,
                totalBytes: totalSize,
                speed,
                speedFormatted: formatSpeed(speed),
              },
            });
          } else {
            // Clear line and show progress
            const progressBar = createProgressBar(percentage);
            const speedStr = formatSpeed(speed);
            const downloadedStr = formatBytes(downloadedBytes);
            const totalStr = formatBytes(totalSize);
            process.stdout.write(`\r  ${progressBar} ${percentage}% | ${downloadedStr}/${totalStr} | ${speedStr}  `);
          }

          lastProgressUpdate = now;
          lastBytes = downloadedBytes;
        }

        this.push(value);
      }
    });

    // Pipe to file
    await pipeline(nodeStream, fileStream);

    // Move temp file to final location
    if (existsSync(modelPath)) {
      unlinkSync(modelPath);
    }
    renameSync(tempPath, modelPath);

    const totalTime = (Date.now() - startTime) / 1000;
    const averageSpeed = downloadedBytes / totalTime;

    if (!isJsonMode()) {
      console.log(); // New line after progress
      console.log(chalk.green(`\n✓ Downloaded successfully!`));
      console.log(chalk.gray(`  Size: ${formatBytes(downloadedBytes)}`));
      console.log(chalk.gray(`  Time: ${totalTime.toFixed(1)}s (avg ${formatSpeed(averageSpeed)})`));
      console.log(chalk.gray(`  Path: ${modelPath}`));
    }

    const result: ModelDownloadResult = {
      model: typedModelName,
      path: modelPath,
      downloaded: true,
      skipped: false,
      sizeBytes: downloadedBytes,
    };

    if (isJsonMode()) {
      outputJson(result);
      emitCompleted({
        ...result,
        downloadTime: totalTime,
        averageSpeed,
      });
    }

    return result;

  } catch (error) {
    // Cleanup temp file on error
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (isJsonMode()) {
      emitError(`Failed to download model: ${errorMessage}`, {
        code: 'DOWNLOAD_ERROR',
        data: { model: modelName },
      });
    } else {
      console.log(); // New line after progress
      console.error(chalk.red(`\n✗ Download failed: ${errorMessage}`));
    }

    throw error;
  }
}

/**
 * Create a simple progress bar
 */
function createProgressBar(percentage: number): string {
  const width = 30;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Get the download URL for a model
 */
export function getModelDownloadUrl(modelName: WhisperModelName): string | null {
  const model = MODEL_DEFINITIONS.find(m => m.name === modelName);
  return model?.url || null;
}

/**
 * Model delete result interface
 */
export interface ModelDeleteResult {
  model: WhisperModelName;
  path: string;
  deleted: boolean;
}

/**
 * Get the path where a model would be stored
 * Returns the GGML model path (primary location)
 */
export function getModelFilePath(modelName: WhisperModelName): string {
  const modelsDir = getWhisperModelsDir();
  return join(modelsDir, `ggml-${modelName}.bin`);
}

/**
 * Delete a downloaded Whisper model
 * Removes the model file from ~/.ai-video-cataloger/models/whisper/
 *
 * @param modelName - Name of the model to delete (tiny, base, small, medium, large-v3)
 * @param options - Delete options
 * @returns Delete result with path and status
 */
export async function deleteModel(
  modelName: string,
  options: { force?: boolean } = {}
): Promise<ModelDeleteResult> {
  // JSON mode - emit started event
  if (isJsonMode()) {
    emitStarted('models_delete', { modelName, force: options.force });
  }

  // Validate model name
  if (!isValidModelName(modelName)) {
    const errorMessage = `Invalid model name: ${modelName}`;
    if (isJsonMode()) {
      emitError(errorMessage, {
        code: 'INVALID_MODEL',
        data: { validModels: MODEL_DEFINITIONS.map(m => m.name) },
      });
    } else {
      console.error(chalk.red(`\n✗ ${errorMessage}`));
      console.error(chalk.gray('  Valid models: ' + MODEL_DEFINITIONS.map(m => m.name).join(', ')));
    }
    throw new Error(errorMessage);
  }

  const typedModelName = modelName as WhisperModelName;
  const modelPath = getModelFilePath(typedModelName);

  // Check if model is downloaded
  if (!isModelDownloaded(typedModelName)) {
    const errorMessage = `Model '${modelName}' is not downloaded`;
    if (isJsonMode()) {
      emitError(errorMessage, {
        code: 'MODEL_NOT_FOUND',
        data: { model: modelName, path: modelPath },
      });
    } else {
      console.error(chalk.red(`\n✗ ${errorMessage}`));
      console.error(chalk.gray(`  Expected path: ${modelPath}`));
    }
    throw new Error(errorMessage);
  }

  // Require --force flag when not in JSON mode (CLI interactive mode)
  if (!options.force && !isJsonMode()) {
    console.log(chalk.yellow(`\nThis will delete the model '${modelName}'`));
    console.log(chalk.gray(`  Path: ${modelPath}`));
    console.log(chalk.gray('\nUse --force to confirm deletion'));
    return {
      model: typedModelName,
      path: modelPath,
      deleted: false,
    };
  }

  // Require --force flag in JSON mode too (for scripting safety)
  if (!options.force && isJsonMode()) {
    const errorMessage = `Deletion requires --force flag`;
    emitError(errorMessage, {
      code: 'CONFIRMATION_REQUIRED',
      data: { model: modelName, path: modelPath },
    });
    throw new Error(errorMessage);
  }

  try {
    // Delete the model file
    unlinkSync(modelPath);

    if (!isJsonMode()) {
      console.log(chalk.green(`\n✓ Deleted model '${modelName}'`));
      console.log(chalk.gray(`  Path: ${modelPath}`));
    }

    const result: ModelDeleteResult = {
      model: typedModelName,
      path: modelPath,
      deleted: true,
    };

    if (isJsonMode()) {
      outputJson(result);
      emitCompleted({ ...result });
    }

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (isJsonMode()) {
      emitError(`Failed to delete model: ${errorMessage}`, {
        code: 'DELETE_ERROR',
        data: { model: modelName, path: modelPath },
      });
    } else {
      console.error(chalk.red(`\n✗ Failed to delete model: ${errorMessage}`));
    }

    throw error;
  }
}
