/**
 * Whisper.cpp Binary Path Resolution
 * Provides paths to bundled whisper.cpp binary for Electron app
 */
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Get the path to the bundled whisper.cpp binary
 * Handles both development and packaged app scenarios
 */
export function getWhisperCppPath(): string {
  // In development, check for binary in electron/resources/bin/
  if (!app.isPackaged) {
    const devPath = join(__dirname, '..', '..', 'resources', 'bin', 'whisper');
    if (existsSync(devPath)) {
      return devPath;
    }
  }

  // In packaged app, binary is in the unpacked resources
  const unpackedPath = join(
    process.resourcesPath,
    'resources',
    'bin',
    'whisper'
  );

  if (existsSync(unpackedPath)) {
    return unpackedPath;
  }

  // Fallback: return empty string to indicate not found
  return '';
}

/**
 * Check if bundled whisper.cpp is available
 */
export function isBundledWhisperCppAvailable(): boolean {
  const whisperPath = getWhisperCppPath();
  return whisperPath !== '' && existsSync(whisperPath);
}

/**
 * Get whisper.cpp version info
 */
export async function getWhisperCppVersion(binaryPath: string): Promise<string> {
  try {
    // whisper.cpp outputs version with --help or -h
    const { stderr } = await execFileAsync(binaryPath, ['--help'], { timeout: 5000 });
    // Version is typically in the first few lines
    const lines = stderr.split('\n');
    for (const line of lines) {
      if (line.includes('whisper.cpp')) {
        return line.trim();
      }
    }
    return 'whisper.cpp (version unknown)';
  } catch {
    return 'whisper.cpp (version check failed)';
  }
}

export interface WhisperCppInfo {
  bundled: boolean;
  available: boolean;
  path: string;
  version: string;
}

/**
 * Get comprehensive whisper.cpp info
 */
export async function getWhisperCppInfo(): Promise<WhisperCppInfo> {
  const path = getWhisperCppPath();
  const available = path !== '' && existsSync(path);

  if (!available) {
    return {
      bundled: false,
      available: false,
      path: '',
      version: 'not found',
    };
  }

  const version = await getWhisperCppVersion(path);

  return {
    bundled: true,
    available: true,
    path,
    version,
  };
}
