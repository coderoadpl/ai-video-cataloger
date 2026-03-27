/**
 * Whisper Setup for CLI
 * Provides path resolution for whisper.cpp binary
 * Supports bundled binary (in ~/.ai-video-cataloger/bin/) or system whisper
 * Falls back to system whisper if bundled binary is unavailable
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

let isConfigured = false;
let resolvedWhisperPath: string | null = null;

/**
 * Get the CLI bin directory for storing bundled binaries
 */
export function getCliBinDir(): string {
  return join(homedir(), '.ai-video-cataloger', 'bin');
}

/**
 * Get the directory for storing Whisper models
 */
export function getWhisperModelsDir(): string {
  return join(homedir(), '.ai-video-cataloger', 'models', 'whisper');
}

/**
 * Ensure the Whisper models directory exists
 */
export function ensureWhisperModelsDirExists(): void {
  const modelsDir = getWhisperModelsDir();
  if (!existsSync(modelsDir)) {
    mkdirSync(modelsDir, { recursive: true });
  }
}

/**
 * Get the path to the bundled Whisper binary
 * The binary is expected to be at ~/.ai-video-cataloger/bin/whisper
 * Returns null if bundled binary is not available
 */
function getBundledWhisperPath(): string | null {
  const binDir = getCliBinDir();
  const whisperPath = join(binDir, 'whisper');

  if (existsSync(whisperPath)) {
    return whisperPath;
  }

  return null;
}

/**
 * Check if system whisper is available
 */
async function isSystemWhisperAvailable(): Promise<boolean> {
  try {
    // Try whisper command (OpenAI Whisper Python package)
    await execa('whisper', ['--help']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if bundled whisper is available
 */
export function isBundledWhisperAvailable(): boolean {
  return getBundledWhisperPath() !== null;
}

/**
 * Get the best available Whisper path (bundled first, then system)
 */
export function getWhisperPath(): string {
  // Use cached path if already configured
  if (resolvedWhisperPath !== null) {
    return resolvedWhisperPath;
  }

  // Try bundled first
  const bundled = getBundledWhisperPath();
  if (bundled) {
    resolvedWhisperPath = bundled;
    return bundled;
  }

  // Fall back to system whisper
  resolvedWhisperPath = 'whisper';
  return 'whisper';
}

/**
 * Configure Whisper setup
 * This should be called before any whisper operations
 */
export function configureWhisper(): void {
  if (isConfigured) {
    return;
  }

  // Resolve the whisper path
  getWhisperPath();

  // Ensure models directory exists
  ensureWhisperModelsDirExists();

  isConfigured = true;
}

/**
 * Get Whisper version info
 */
export async function getWhisperVersion(): Promise<{ version: string; bundled: boolean; path: string }> {
  const whisperPath = getWhisperPath();
  const bundled = isBundledWhisperAvailable();

  try {
    // Try to get version info
    // OpenAI Whisper doesn't have a --version flag, so we just check if it runs
    const { stdout, stderr } = await execa(whisperPath, ['--help'], { timeout: 5000 });

    // Try to extract version from help output if available
    const output = stdout || stderr;
    const versionMatch = output.match(/whisper[.\s]*([\d.]+)/i);
    const version = versionMatch ? versionMatch[1] : 'installed';

    return { version, bundled, path: whisperPath };
  } catch {
    return { version: 'not found', bundled, path: whisperPath };
  }
}

/**
 * Check if Whisper is available (either bundled or system)
 */
export async function isWhisperAvailable(): Promise<boolean> {
  // Check bundled first
  if (isBundledWhisperAvailable()) {
    return true;
  }

  // Fall back to checking system
  return isSystemWhisperAvailable();
}

/**
 * Get information about the current Whisper configuration
 */
export async function getWhisperInfo(): Promise<{
  available: boolean;
  whisperPath: string;
  version: string;
  bundled: boolean;
  modelsDir: string;
}> {
  const whisperPath = getWhisperPath();
  const versionInfo = await getWhisperVersion();
  const available = await isWhisperAvailable();
  const modelsDir = getWhisperModelsDir();

  return {
    available,
    whisperPath,
    version: versionInfo.version,
    bundled: versionInfo.bundled,
    modelsDir,
  };
}

/**
 * Check if a whisper model exists in the models directory
 */
export function isModelInModelsDir(modelName: string): boolean {
  const modelsDir = getWhisperModelsDir();
  // Check for GGML model format (used by whisper.cpp)
  const ggmlModelPath = join(modelsDir, `ggml-${modelName}.bin`);
  if (existsSync(ggmlModelPath)) {
    return true;
  }

  // Also check without prefix (some models may be named directly)
  const directModelPath = join(modelsDir, `${modelName}.bin`);
  return existsSync(directModelPath);
}

/**
 * Get the path to a model file in the models directory
 * Returns null if the model doesn't exist
 */
export function getModelPath(modelName: string): string | null {
  const modelsDir = getWhisperModelsDir();

  // Check GGML format first (whisper.cpp format)
  const ggmlModelPath = join(modelsDir, `ggml-${modelName}.bin`);
  if (existsSync(ggmlModelPath)) {
    return ggmlModelPath;
  }

  // Check direct name format
  const directModelPath = join(modelsDir, `${modelName}.bin`);
  if (existsSync(directModelPath)) {
    return directModelPath;
  }

  return null;
}
