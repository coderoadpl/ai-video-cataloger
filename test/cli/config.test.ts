/**
 * Tests for the `config` command
 * - config get [key]
 * - config set <key> <value>
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });

  describe('config set', () => {
    it('uses home scope when cwd is HOME and reports failures without changing the file', async () => {
      const environment = { HOME: testDir };
      const provider = JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'gemma3:4b' });
      const saved = await runCli(['config', 'set', 'analyzer_provider', provider, '--json'], {
        cwd: testDir,
        env: environment,
      });
      const configPath = join(testDir, '.ai-video-cataloger', 'config.json');
      const before = readFileSync(configPath, 'utf8');
      const loaded = await runCli(['config', 'get', 'analyzer_provider', '--json'], {
        cwd: testDir,
        env: environment,
      });
      const failed = await runCli(['config', 'set', 'not_a_config_key', 'value', '--json'], {
        cwd: testDir,
        env: environment,
      });

      expect(saved.exitCode).toBe(0);
      expect(JSON.parse(before)).toEqual({ analyzer_provider: provider });
      expect(parseJsonEvents(loaded.stdout).some((event) => event.source === 'home')).toBe(true);
      expect(failed.exitCode).toBe(24);
      expect(parseJsonEvents(failed.stdout)).toContainEqual(expect.objectContaining({ type: 'error', code: 'UNKNOWN_CONFIG_KEY' }));
      expect(readFileSync(configPath, 'utf8')).toBe(before);
    });

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

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on invalid string value for enum', async () => {
      const result = await runCli(['config', 'set', 'whisper', 'invalid_mode', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on out of range number', async () => {
      // frames should be at least 1
      const result = await runCli(['config', 'set', 'frames', '0', '--json'], { cwd: testDir });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should error on invalid boolean value', async () => {
      const result = await runCli(['config', 'set', 'skipRename', 'maybe', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });

  describe('app-global keys outside $HOME', () => {
    let home: string;

    beforeEach(() => {
      home = createTestDir();
    });

    afterEach(() => {
      cleanupTestDir(home);
    });

    it('writes ui_language into the home config, not a cwd override', async () => {
      const set = await runCli(['config', 'set', 'ui_language', 'pl', '--json'], { cwd: testDir, env: { HOME: home } });
      expect(set.exitCode).toBe(0);

      const setData = findEvent(parseJsonEvents(set.stdout), 'completed')?.data as Record<string, unknown>;
      expect(setData.scope).toBe('home');
      expect(JSON.parse(readFileSync(join(home, '.ai-video-cataloger', 'config.json'), 'utf8'))).toMatchObject({ ui_language: 'pl' });
      expect(existsSync(join(testDir, '.ai-video-cataloger', 'config.json'))).toBe(false);

      const get = await runCli(['config', 'get', 'ui_language', '--json'], { cwd: testDir, env: { HOME: home } });
      const getData = findEvent(parseJsonEvents(get.stdout), 'completed')?.data as Record<string, unknown>;
      expect(getData.value).toBe('pl');
      expect(getData.effectiveValue).toBe('pl');
      expect(getData.source).toBe('home');
    });

    it('warns that a stray cwd override for an app-global key is ignored', async () => {
      mkdirSync(join(testDir, '.ai-video-cataloger'), { recursive: true });
      writeFileSync(join(testDir, '.ai-video-cataloger', 'config.json'), JSON.stringify({ ui_language: 'de' }));

      const get = await runCli(['config', 'get', 'ui_language'], { cwd: testDir, env: { HOME: home } });
      expect(get.exitCode).toBe(0);
      expect(get.stderr).toContain('de');

      const getJson = await runCli(['config', 'get', 'ui_language', '--json'], { cwd: testDir, env: { HOME: home } });
      const getData = findEvent(parseJsonEvents(getJson.stdout), 'completed')?.data as Record<string, unknown>;
      expect(getData.ignoredFolderValue).toBe('de');
      expect(getData.effectiveValue).toBe('en');
    });
  });
});
