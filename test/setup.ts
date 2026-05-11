/**
 * Global test setup for Vitest
 */

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Track all test directories for cleanup
const testDirectories: string[] = [];

/**
 * Create a unique temporary test directory
 */
export function createTestDir(): string {
  const uniqueId = randomBytes(8).toString('hex');
  const testDir = join(tmpdir(), `ai-video-cataloger-test-${uniqueId}`);
  mkdirSync(testDir, { recursive: true });
  testDirectories.push(testDir);
  return testDir;
}

/**
 * Clean up a specific test directory
 */
export function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Global cleanup after all tests
 */
export function cleanupAllTestDirs(): void {
  for (const dir of testDirectories) {
    cleanupTestDir(dir);
  }
  testDirectories.length = 0;
}

// Global afterAll hook to clean up any remaining test directories
if (typeof afterAll !== 'undefined') {
  afterAll(() => {
    cleanupAllTestDirs();
  });
}
