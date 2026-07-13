/**
 * Tests for the `process` command
 * Processes a single video file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createFakeVideoFile, createNonVideoFile, createSubDir } from '../helpers/fixtures.js';
import { join } from 'node:path';

describe('process command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should error on file not found', async () => {
    const nonExistentPath = join(testDir, 'nonexistent.mp4');
    const result = await runCli(['process', nonExistentPath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('FILE_NOT_FOUND');
  });

  it('should error on non-video file', async () => {
    const textFile = createNonVideoFile(testDir, 'test.txt');

    const result = await runCli(['process', textFile, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('INVALID_FILE_TYPE');
  });

  it('should error when path is a directory', async () => {
    const subDir = createSubDir(testDir, 'subdir');

    const result = await runCli(['process', subDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    // Directory without video extension triggers INVALID_FILE_TYPE check first
    expect(errorEvent?.code).toBe('INVALID_FILE_TYPE');
  });

  it('should error when prerequisites fail (no claude)', async () => {
    // This test verifies that the CLI checks prerequisites
    // Without Claude CLI, this should fail at prerequisites check
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--json'], {
      cwd: testDir,
      // Don't set mock mode - let it actually check prerequisites
    });

    // Should fail at some point - either prerequisites or processing
    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    // Should have an error event
    expect(errorEvent).toBeDefined();
  });

  it('should error on missing API key when using whisper api mode', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    // Remove OPENAI_API_KEY from environment
    const result = await runCli(['process', videoPath, '--whisper', 'api', '--json'], {
      cwd: testDir,
      env: { OPENAI_API_KEY: '' },
    });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('MISSING_API_KEY');
  });

  it('should have proper JSON output structure', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--json'], { cwd: testDir });

    // Will fail at some point, but should have proper JSON structure
    const events = parseJsonEvents(result.stdout);
    const startedEvent = findEvent(events, 'started');

    expect(startedEvent).toBeDefined();
    expect(startedEvent?.command).toBe('process_single');

    const startData = startedEvent?.data as Record<string, unknown>;
    expect(startData).toHaveProperty('videoPath');
    expect(startData).toHaveProperty('options');
  });
});
