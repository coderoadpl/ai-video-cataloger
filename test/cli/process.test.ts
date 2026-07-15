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
    expect(errorEvent?.data).toEqual({ path: nonExistentPath });
    expect(events[0]?.type).toBe('error');
  });

  it('should error on non-video file', async () => {
    const textFile = createNonVideoFile(testDir, 'test.txt');

    const result = await runCli(['process', textFile, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('INVALID_FILE_TYPE');
    expect(errorEvent?.data).toEqual({
      path: textFile,
      extension: '.txt',
      supportedExtensions: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
    });
    expect(events[0]?.type).toBe('error');
  });

  it('should error when path is a directory', async () => {
    const subDir = createSubDir(testDir, 'subdir.mp4');

    const result = await runCli(['process', subDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('NOT_A_FILE');
    expect(errorEvent?.data).toEqual({ path: subDir });
    expect(events[0]?.type).toBe('error');
  });

  it('should error when prerequisites fail (no claude)', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--json'], {
      cwd: testDir,
      env: { PATH: '/nonexistent' },
    });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent?.code).toBe('PREREQUISITES_FAILED');
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
    expect(errorEvent?.code).toBe('PREREQUISITES_FAILED');
    expect(errorEvent?.message).toContain('openai-whisper-api');
    expect(errorEvent?.message).toContain('ai-video-cataloger setup');
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
    expect(startData.options).toEqual({
      frames: 3,
      skipRename: false,
      timeout: 120,
      whisper: 'local',
      whisperModel: 'base',
    });
  });

  it('rejects an invalid whisper mode during option parsing with exit 1', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '-w', 'bogus', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(1);
    expect(parseJsonEvents(result.stdout)).toEqual([]);
    expect(result.stderr).toContain('Invalid whisper mode: bogus');
  });
});
