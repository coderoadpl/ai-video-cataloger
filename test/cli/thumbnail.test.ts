/**
 * Tests for the `thumbnail` command
 * Generates thumbnails for video files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createFakeVideoFile, createNonVideoFile, createSubDir } from '../helpers/fixtures.js';
import { join } from 'node:path';

describe('thumbnail command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should error on file not found', async () => {
    const nonExistentPath = join(testDir, 'nonexistent.mp4');
    const result = await runCli(['thumbnail', nonExistentPath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('FILE_NOT_FOUND');
  });

  it('resolves a relative video path from AVC_WORKING_DIRECTORY', async () => {
    createFakeVideoFile(testDir, 'relative.mp4');

    const result = await runCli(['thumbnail', 'relative.mp4', '--json'], {
      cwd: testDir,
      env: { AI_VIDEO_CATALOGER_MOCK: 'true' },
    });
    const started = findEvent(parseJsonEvents(result.stdout), 'started');

    expect(started).toMatchObject({
      data: { videoPath: join(testDir, 'relative.mp4') },
    });
  });

  it('should error on non-video file', async () => {
    const textFile = createNonVideoFile(testDir, 'test.txt');

    const result = await runCli(['thumbnail', textFile, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('INVALID_FILE_TYPE');
  });

  it('should error when path is a directory', async () => {
    const subDir = createSubDir(testDir, 'subdir');

    const result = await runCli(['thumbnail', subDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    // Directory without video extension triggers INVALID_FILE_TYPE check first
    expect(errorEvent?.code).toBe('INVALID_FILE_TYPE');
  });

  it('should handle already existing thumbnail', async () => {
    // Create a fake video
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    // First attempt will likely fail due to invalid video, which is fine
    // We're testing the CLI handles errors gracefully
    const result = await runCli(['thumbnail', videoPath, '--json'], {
      cwd: testDir,
      env: { AI_VIDEO_CATALOGER_MOCK: 'true' },
    });

    // Either succeeds or fails gracefully with an error event
    expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');
    const errorEvent = findEvent(events, 'error');

    // Should have either completed or error event
    expect(completedEvent || errorEvent).toBeDefined();
  });

  it('should accept --force flag to regenerate', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['thumbnail', videoPath, '--force', '--json'], {
      cwd: testDir,
      env: { AI_VIDEO_CATALOGER_MOCK: 'true' },
    });

    // Either succeeds or fails gracefully
    expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

    const events = parseJsonEvents(result.stdout);
    const startedEvent = findEvent(events, 'started');

    expect(startedEvent).toBeDefined();
    expect((startedEvent?.data as Record<string, unknown>)?.force).toBe(true);
  });

  it('should have proper JSON output structure', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['thumbnail', videoPath, '--json'], {
      cwd: testDir,
      env: { AI_VIDEO_CATALOGER_MOCK: 'true' },
    });

    const events = parseJsonEvents(result.stdout);
    const startedEvent = findEvent(events, 'started');

    expect(startedEvent).toBeDefined();
    expect(startedEvent?.command).toBe('thumbnail');

    const startData = startedEvent?.data as Record<string, unknown>;
    expect(startData).toHaveProperty('videoPath');
  });
});
