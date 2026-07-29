/**
 * Tests for the `doctor` command
 * Checks system prerequisites (ffmpeg, whisper, claude, ollama)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { scaledTimeout } from '../helpers/gate-timeout.js';

describe('doctor command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should report dependency status (all or some available)', async () => {
    const result = await runCli(['doctor', '--json'], { cwd: testDir, timeout: 60_000 });

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('dependencies');

    const deps = data.dependencies as Array<Record<string, unknown>>;
    expect(Array.isArray(deps)).toBe(true);
    expect(deps.length).toBeGreaterThan(0);

    for (const dep of deps) {
      expect(dep).toHaveProperty('name');
      expect(dep).toHaveProperty('available');
    }
  }, scaledTimeout(75_000));

  it('should report if some dependencies are missing', async () => {
    const result = await runCli(['doctor', '--json'], { cwd: testDir, timeout: 60_000 });

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('allAvailable');
    expect(typeof data.allAvailable).toBe('boolean');
  }, scaledTimeout(75_000));

  it('should have proper JSON output structure', async () => {
    const result = await runCli(['doctor', '--json'], { cwd: testDir });

    const events = parseJsonEvents(result.stdout);

    // Should have started and completed events
    const startedEvent = findEvent(events, 'started');
    const completedEvent = findEvent(events, 'completed');

    expect(startedEvent).toBeDefined();
    expect(completedEvent).toBeDefined();

    // Check structure
    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('dependencies');
    expect(data).toHaveProperty('allAvailable');
  });

  it('should never throw, even if dependencies are missing', async () => {
    // The doctor command should always complete gracefully
    const result = await runCli(['doctor', '--json'], { cwd: testDir });

    // Should not throw - either exit 0 or 1 based on dependency status
    expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    // Should always have a completed event
    expect(completedEvent).toBeDefined();
  });
});
