/**
 * Service for detecting nested .ai-video-cataloger/ database folders
 * This is important because having nested databases can cause issues with
 * video tracking and catalog management.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';
import { isJsonMode, emitStarted, emitCompleted, emitError, logHumanError } from './json-output.js';

const DB_DIR_NAME = '.ai-video-cataloger';

/**
 * Result of a nested database check
 */
export interface NestedCheckResult {
  hasNestedDatabases: boolean;
  nestedPaths: string[];
  basePath: string;
  scannedDirectories: number;
}

/**
 * Recursively scan for nested .ai-video-cataloger/ directories
 * Starting from basePath, looks for any .ai-video-cataloger/ directories
 * inside subdirectories (not the root level one)
 */
export function findNestedDatabases(basePath: string): NestedCheckResult {
  const nestedPaths: string[] = [];
  let scannedDirectories = 0;

  function scanDirectory(currentPath: string, isRoot: boolean): void {
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const fullPath = join(currentPath, entry.name);

        // Skip the root-level .ai-video-cataloger directory
        if (entry.name === DB_DIR_NAME) {
          if (!isRoot) {
            // This is a nested database - record it
            nestedPaths.push(fullPath);
          }
          // Don't recurse into .ai-video-cataloger directories
          continue;
        }

        // Skip hidden directories (except .ai-video-cataloger which we handle above)
        if (entry.name.startsWith('.')) {
          continue;
        }

        // Skip node_modules and other common non-video directories
        if (entry.name === 'node_modules' || entry.name === '__pycache__') {
          continue;
        }

        scannedDirectories++;

        // Recurse into subdirectory
        scanDirectory(fullPath, false);
      }
    } catch {
      // Skip directories we can't read (permission issues, etc.)
    }
  }

  // Start scanning from basePath
  if (existsSync(basePath) && statSync(basePath).isDirectory()) {
    scanDirectory(basePath, true);
  }

  return {
    hasNestedDatabases: nestedPaths.length > 0,
    nestedPaths,
    basePath,
    scannedDirectories,
  };
}

/**
 * Display the nested check result to the user
 * Works with both human-readable and JSON output modes
 */
export function displayNestedCheckResult(result: NestedCheckResult): void {
  if (isJsonMode()) {
    // JSON output - emit completed event with result data
    emitCompleted({
      hasNestedDatabases: result.hasNestedDatabases,
      nestedPaths: result.nestedPaths,
      basePath: result.basePath,
      scannedDirectories: result.scannedDirectories,
    });
    return;
  }

  // Human-readable output
  if (result.hasNestedDatabases) {
    console.log(chalk.yellow(`\n⚠ Found ${result.nestedPaths.length} nested database${result.nestedPaths.length === 1 ? '' : 's'}:`));
    console.log();

    for (const nestedPath of result.nestedPaths) {
      const relativePath = relative(result.basePath, nestedPath);
      console.log(chalk.red(`  • ${relativePath}`));
    }

    console.log();
    console.log(chalk.gray('These nested databases may cause issues with video tracking.'));
    console.log(chalk.gray('Consider removing them or processing each folder separately.'));
  } else {
    console.log(chalk.green('\n✓ No nested databases found'));
    console.log(chalk.gray(`  Scanned ${result.scannedDirectories} directories in ${result.basePath}`));
  }
}

/**
 * Check for nested databases and emit an error if found
 * This is used by the main command to block processing when nested DBs exist
 * Returns true if it's safe to proceed (no nested DBs), false otherwise
 */
export function checkForNestedDatabasesAndError(basePath: string): boolean {
  const result = findNestedDatabases(basePath);

  if (!result.hasNestedDatabases) {
    return true;
  }

  // Emit error about nested databases
  if (isJsonMode()) {
    emitError('Nested databases detected', {
      code: 'NESTED_DATABASES_FOUND',
      data: {
        count: result.nestedPaths.length,
        nestedPaths: result.nestedPaths,
        basePath: result.basePath,
      },
    });
  } else {
    logHumanError(chalk.red('\n✗ Error: Nested databases detected'));
    console.log();
    console.log(chalk.yellow(`Found ${result.nestedPaths.length} nested .ai-video-cataloger/ folder${result.nestedPaths.length === 1 ? '' : 's'}:`));
    console.log();

    for (const nestedPath of result.nestedPaths) {
      const relativePath = relative(basePath, nestedPath);
      console.log(chalk.red(`  • ${relativePath}`));
    }

    console.log();
    console.log(chalk.gray('Why this is a problem:'));
    console.log(chalk.gray('  Having multiple databases in nested folders can cause videos to be'));
    console.log(chalk.gray('  tracked in different databases, leading to inconsistent catalog data.'));
    console.log();
    console.log(chalk.white('To resolve:'));
    console.log(chalk.gray('  1. Remove the nested .ai-video-cataloger/ folders, OR'));
    console.log(chalk.gray('  2. Process each folder separately with its own database'));
    console.log();
    console.log(chalk.gray('To check a specific folder, run:'));
    console.log(chalk.cyan('  ai-video-cataloger check <folder>'));
  }

  return false;
}

/**
 * Run the check command
 * This is the handler for the `check [folder]` CLI command
 */
export function runNestedCheck(folder: string): NestedCheckResult {
  emitStarted('check', { folder });

  const result = findNestedDatabases(folder);
  displayNestedCheckResult(result);

  return result;
}
