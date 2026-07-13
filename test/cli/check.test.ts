/**
 * Tests for the `check` command
 * Checks for nested .ai-video-cataloger/ database folders
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createNestedDatabase, createSubDir } from '../helpers/fixtures.js';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

describe('check command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should report no nested databases when none exist', async () => {
    const result = await runCli(['check', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();
    expect(completedEvent?.data).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data.hasNestedDatabases).toBe(false);
  });

  it('should detect nested databases', async () => {
    // Create a subfolder with nested database
    createSubDir(testDir, 'subfolder');
    createNestedDatabase(testDir, 'subfolder');

    const result = await runCli(['check', testDir, '--json'], { cwd: testDir });

    // Exit code 1 when nested databases are found
    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data.hasNestedDatabases).toBe(true);
    expect(Array.isArray(data.nestedPaths)).toBe(true);
    expect((data.nestedPaths as string[]).length).toBeGreaterThan(0);
  });

  it('should error on folder not found', async () => {
    const nonExistentPath = join(testDir, 'nonexistent');
    const result = await runCli(['check', nonExistentPath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('FOLDER_NOT_FOUND');
  });

  it('should error when path is not a directory', async () => {
    const filePath = join(testDir, 'testfile.txt');
    writeFileSync(filePath, 'test content');

    const result = await runCli(['check', filePath, '--json'], { cwd: testDir });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('NOT_A_DIRECTORY');
  });

  it('should have proper JSON output structure', async () => {
    const result = await runCli(['check', testDir, '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);

    // Should have started and completed events
    const startedEvent = findEvent(events, 'started');
    const completedEvent = findEvent(events, 'completed');

    expect(startedEvent).toBeDefined();
    expect(completedEvent).toBeDefined();
  });
});
