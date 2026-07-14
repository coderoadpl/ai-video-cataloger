/**
 * Tests for the `models` command
 * - models list
 * - models use <model-name>
 * - models download <model-name>
 * - models delete <model-name>
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { createDbDir } from '../helpers/fixtures.js';

describe('models command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
    createDbDir(testDir);
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('models list', () => {
    it('should show all available models', async () => {
      const result = await runCli(['models', 'list', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');

      expect(completedEvent).toBeDefined();

      const data = completedEvent?.data as Record<string, unknown>;
      expect(data).toHaveProperty('models');

      const models = data.models as Array<Record<string, unknown>>;
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // Each model should have name and downloaded status
      for (const model of models) {
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('downloaded');
      }
    });

    it('should have proper JSON output structure', async () => {
      const result = await runCli(['models', 'list', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);

      // Check for expected models (at least tiny and base should exist)
      const completedEvent = findEvent(events, 'completed');
      const data = completedEvent?.data as Record<string, unknown>;
      const models = data.models as Array<Record<string, unknown>>;

      const modelNames = models.map((m) => m.name);
      expect(modelNames).toContain('tiny');
      expect(modelNames).toContain('base');
    });
  });

  describe('models use', () => {
    it('should set active model for valid model name', async () => {
      const result = await runCli(['models', 'use', 'tiny', '--json'], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');

      expect(completedEvent).toBeDefined();
    });

    it('should error on invalid model name', async () => {
      const result = await runCli(['models', 'use', 'nonexistent-model', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });

  describe('models download', () => {
    it('should handle already downloaded model', async () => {
      const home = join(testDir, 'home');
      const modelDir = join(home, '.ai-video-cataloger', 'models', 'whisper');
      mkdirSync(modelDir, { recursive: true });
      writeFileSync(join(modelDir, 'ggml-tiny.bin'), 'already-present');

      const result = await runCli(['models', 'download', 'tiny', '--json'], {
        cwd: testDir,
        env: { HOME: home },
      });

      expect(result.exitCode).toBe(0);

      const events = parseJsonEvents(result.stdout);
      const completedEvent = findEvent(events, 'completed');
      const rawIndex = events.findIndex((event) => event.model === 'tiny' && event.type === undefined);
      const completedIndex = events.findIndex((event) => event.type === 'completed');

      expect(completedEvent).toBeDefined();
      expect(rawIndex).toBeGreaterThan(-1);
      expect(rawIndex).toBeLessThan(completedIndex);
    });

    it('should error on invalid model name', async () => {
      const result = await runCli(['models', 'download', 'nonexistent-model', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });
  });

  describe('models delete', () => {
    it('should require --force flag for deletion', async () => {
      // Without --force, emits CONFIRMATION_REQUIRED error (may or may not exit 0)
      const result = await runCli(['models', 'delete', 'tiny', '--json'], { cwd: testDir });

      // The CLI may exit 0 or 1 depending on whether the model exists
      // We just check for the CONFIRMATION_REQUIRED error
      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      // If no error, the model might not exist - check for any event
      if (errorEvent) {
        expect(errorEvent?.code).toBe('CONFIRMATION_REQUIRED');
      } else {
        // Model not found or other error
        expect(result.exitCode).toBeGreaterThan(0);
      }
    });

    it('should error on not found model with --force', async () => {
      const result = await runCli(['models', 'delete', 'nonexistent-model', '--force', '--json'], {
        cwd: testDir,
      });

      expect(result.exitCode).toBeGreaterThan(0);

      const events = parseJsonEvents(result.stdout);
      const errorEvent = findEvent(events, 'error');

      expect(errorEvent).toBeDefined();
    });

    it('should emit started event', async () => {
      const result = await runCli(['models', 'delete', 'tiny', '--json'], { cwd: testDir });

      const events = parseJsonEvents(result.stdout);
      const startedEvent = findEvent(events, 'started');

      expect(startedEvent).toBeDefined();
      expect(startedEvent?.command).toBe('models_delete');
    });
  });
});
