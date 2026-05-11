/**
 * Tests for the `doctor` command
 * Checks system prerequisites (ffmpeg, whisper, claude, ollama)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';

describe('doctor command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should report dependency status (all or some available)', async () => {
    const result = await runCli(['doctor', '--json'], { cwd: testDir });

    // Exit code depends on whether all deps are available
    // This test just verifies the command runs and reports status

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('dependencies');

    const deps = data.dependencies as Array<Record<string, unknown>>;
    expect(Array.isArray(deps)).toBe(true);
    expect(deps.length).toBeGreaterThan(0);

    // Each dependency should have name and available status
    for (const dep of deps) {
      expect(dep).toHaveProperty('name');
      expect(dep).toHaveProperty('available');
    }
  });

  it('should report if some dependencies are missing', async () => {
    const result = await runCli(['doctor', '--json'], { cwd: testDir });

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data).toHaveProperty('allAvailable');
    expect(typeof data.allAvailable).toBe('boolean');
  });

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
    expect([0, 1]).toContain(result.exitCode);

    const events = parseJsonEvents(result.stdout);
    const completedEvent = findEvent(events, 'completed');

    // Should always have a completed event
    expect(completedEvent).toBeDefined();
  });
});
