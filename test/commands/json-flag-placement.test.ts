/**
 * Tests for --json flag placement as produced by the GUI spawner
 *
 * The CLI declares --json per-subcommand, so the flag must come AFTER the
 * subcommand. spawnCLIWithJson (electron/main/cli-spawner.ts) builds
 * [subcommand, '--json', ...operands] - these tests run the built CLI with
 * that exact argument order and assert it is accepted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createFakeVideoFile } from '../helpers/fixtures.js';

describe('--json flag placement (GUI spawner argument order)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should accept check with --json after the subcommand', async () => {
    const result = await runCli(['check', '--json', testDir], { cwd: testDir });

    expect(result.stderr).not.toContain('unknown option');
    expect(result.stdout).not.toContain('unknown option');
    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const startedEvent = findEvent(events, 'started');
    const completedEvent = findEvent(events, 'completed');

    expect(startedEvent).toBeDefined();
    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(data.hasNestedDatabases).toBe(false);
  });

  it('should accept scan with --json after the subcommand', async () => {
    createFakeVideoFile(testDir, 'video1.mp4');

    const result = await runCli(['scan', '--json', testDir], { cwd: testDir });

    expect(result.stderr).not.toContain('unknown option');
    expect(result.stdout).not.toContain('unknown option');
    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const startedEvent = findEvent(events, 'started');
    const completedEvent = findEvent(events, 'completed');

    expect(startedEvent).toBeDefined();
    expect(completedEvent).toBeDefined();

    const data = completedEvent?.data as Record<string, unknown>;
    expect(Array.isArray(data.videos)).toBe(true);

    const videos = data.videos as Array<Record<string, unknown>>;
    expect(videos.length).toBe(1);
    expect(videos[0].filename).toBe('video1.mp4');
  });
});
