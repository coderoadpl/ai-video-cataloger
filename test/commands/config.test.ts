/**
 * Tests for the `config` command
 * - config get [key]
 * - config set <key> <value>
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createDbDir } from '../helpers/fixtures.js';

describe('config command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
    // Initialize the database directory so the CLI can work
    createDbDir(testDir);
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('config get', () => {
    it('should show all config keys with --json', async () => {
      const result = await runCli(['config', 'get', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');

      expect(completedEvent).toBeDefined();
      expect(completedEvent?.data).toBeDefined();

      const data = completedEvent?.data as Record<string, unknown>;
      // Should have config keys
      expect(data).toHaveProperty('config');
    });

    it('should get a single valid key', async () => {
      // First set a value
      await runCli(['config', 'set', 'frames', '5', '--json'], { cwd: testDir });

      // Then get it
      const result = await runCli(['config', 'get', 'frames', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');

      expect(completedEvent).toBeDefined();
      expect(completedEvent?.data).toBeDefined();

      const data = completedEvent?.data as Record<string, unknown>;
      expect(data.key).toBe('frames');
      // Value is stored as string in the database
      expect(data.value).toBe('5');
    });

    it('should error on unknown key', async () => {
      const result = await runCli(['config', 'get', 'unknownKey', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(1);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });

  describe('config set', () => {
    it('should set a valid string value', async () => {
      const result = await runCli(['config', 'set', 'whisper_mode', 'api', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');

      expect(completedEvent).toBeDefined();
    });

    it('should set a valid number value', async () => {
      const result = await runCli(['config', 'set', 'frames', '7', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      // Verify the value was persisted
      const getResult = await runCli(['config', 'get', 'frames', '--json'], { cwd: testDir });
      const events = parseJsonEvents(getResult.stdout);
      const completedEvent = findEvent(events, 'completed');

      const data = completedEvent?.data as Record<string, unknown>;
      // Value is stored as string in the database
      expect(data.value).toBe('7');
    });

    it('should set a valid boolean value', async () => {
      const result = await runCli(['config', 'set', 'skip_rename', 'true', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBe(0);

      // Verify the value was persisted
      const getResult = await runCli(['config', 'get', 'skip_rename', '--json'], { cwd: testDir });
      const events = parseJsonEvents(getResult.stdout);
      const completedEvent = findEvent(events, 'completed');

      const data = completedEvent?.data as Record<string, unknown>;
      // Value is stored as string in the database
      expect(data.value).toBe('true');
    });

    it('should error on unknown key', async () => {
      const result = await runCli(['config', 'set', 'unknownKey', 'value', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBe(1);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on invalid string value for enum', async () => {
      const result = await runCli(['config', 'set', 'whisper', 'invalid_mode', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBe(1);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on out of range number', async () => {
      // frames should be at least 1
      const result = await runCli(['config', 'set', 'frames', '0', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(1);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on invalid boolean value', async () => {
      const result = await runCli(['config', 'set', 'skipRename', 'maybe', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBe(1);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });
});
