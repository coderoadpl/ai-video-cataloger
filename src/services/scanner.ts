/**
 * Video scanner service
 * Provides utility functions for finding video files in directories
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import chalk from 'chalk';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

/**
 * Find all video files in a directory (non-recursive)
 */
export function findVideoFiles(directory: string): string[] {
  const videoFiles: string[] = [];

  try {
    const entries = readdirSync(directory);

    for (const entry of entries) {
      const fullPath = join(directory, entry);

      try {
        const stats = statSync(fullPath);

        if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            videoFiles.push(fullPath);
          }
        }
      } catch {
        // Skip files we can't stat (permission issues, etc.)
        continue;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error reading directory: ${message}`));
    return [];
  }

  return videoFiles.sort();
}
