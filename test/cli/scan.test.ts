/**
 * Tests for the `scan` command
 * Lists all video files in a folder with metadata and database status
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createFakeVideoFile, createDbDir } from '../helpers/fixtures.js';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

describe('scan command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should list video files', async () => {
    // Create test video files
    createFakeVideoFile(testDir, 'video1.mp4');
    createFakeVideoFile(testDir, 'video2.mov');

    const result = await runCli(['scan', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data.videos).toBeDefined();
    expect(Array.isArray(data.videos)).toBe(true);

    const videos = data.videos as Array<Record<string, unknown>>;
    expect(videos.length).toBe(2);

    const filenames = videos.map((v) => v.filename);
    expect(filenames).toContain('video1.mp4');
    expect(filenames).toContain('video2.mov');
  });

  it('should handle empty folder', async () => {
    const result = await runCli(['scan', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    const videos = data.videos as Array<Record<string, unknown>>;
    expect(videos.length).toBe(0);
  });

  it('should work without existing database', async () => {
    createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['scan', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    // CLI creates database on scan, so it should have a databasePath
    expect(data).toHaveProperty('databasePath');
  });

  it('should error on folder not found', async () => {
    const nonExistentPath = join(testDir, 'nonexistent');
    const result = await runCli(['scan', nonExistentPath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('FOLDER_NOT_FOUND');
  });

  it('should error when path is not a directory', async () => {
    const filePath = join(testDir, 'testfile.txt');
    writeFileSync(filePath, 'test content');

    const result = await runCli(['scan', filePath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('NOT_A_DIRECTORY');
  });

  it('should have proper JSON output structure', async () => {
    createFakeVideoFile(testDir, 'test.mp4');
    createDbDir(testDir);

    const result = await runCli(['scan', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('folder');
    expect(data).toHaveProperty('videos');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('databasePath');
  });
});
