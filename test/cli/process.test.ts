/**
 * Tests for the `process` command
 * Processes a single video file
 */

import { copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runCli, parseJsonEvents, findEvent, getProjectRoot } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import {
  createFailingClaudeBinary,
  createFakeVideoFile,
  createNonVideoFile,
  createSubDir,
} from '../helpers/fixtures.js';

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

  it('resolves a relative video path from AVC_WORKING_DIRECTORY', async () => {
    createFakeVideoFile(testDir, 'relative.mp4');

    const result = await runCli(['process', 'relative.mp4', '--json'], {
      cwd: testDir,
      env: { PATH: '/nonexistent' },
    });
    const events = parseJsonEvents(result.stdout);

    expect(findEvent(events, 'started')).toMatchObject({
      data: { videoPath: join(testDir, 'relative.mp4') },
    });
    expect(findEvent(events, 'error')?.code).not.toBe('FILE_NOT_FOUND');
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

    const result = await runCli(['process', videoPath, '--whisper', 'api', '--json'], {
      cwd: testDir,
      env: { OPENAI_API_KEY: '' },
    });

    expect(result.exitCode).toBeGreaterThan(0);

    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('MISSING_API_KEY');
    expect(errorEvent?.message).toContain('OPENAI_API_KEY');
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

  it('rejects an unknown analyzer provider id and names the accepted ones', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--provider', 'bogus', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(1);
    expect(parseJsonEvents(result.stdout)).toEqual([]);
    expect(result.stderr).toContain('Invalid analyzer provider: bogus');
    expect(result.stderr).toContain('claude-code, codex, cursor-agent');
  });

  it('rejects an unknown analyzer backend and names the accepted ones', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--analyzer', 'codex', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid analyzer backend: codex');
    expect(result.stderr).toContain('claude, local, api');
  });

  it('refuses a run that sets both --analyzer and --provider', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(
      ['process', videoPath, '--analyzer', 'local', '--provider', 'codex', '--json'],
      { cwd: testDir },
    );
    const errorEvent = findEvent(parseJsonEvents(result.stdout), 'error');

    expect(result.exitCode).toBeGreaterThan(0);
    expect(errorEvent?.code).toBe('VALIDATION');
    expect(errorEvent?.message).toContain('--analyzer or --provider');
  });

  it('accepts a harness provider id by flag', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--provider', 'codex', '--json'], {
      cwd: testDir,
      env: { PATH: '/nonexistent' },
    });
    const events = parseJsonEvents(result.stdout);

    expect(findEvent(events, 'started')?.command).toBe('process_single');
    expect(findEvent(events, 'error')?.code).not.toBe('VALIDATION');
  });

  it('accepts legacy process flag values outside stored-config ranges', async () => {
    const videoPath = createFakeVideoFile(testDir, 'test.mp4');

    const result = await runCli(['process', videoPath, '--frames', '12', '--timeout', '20', '--json'], {
      cwd: testDir,
      env: { PATH: '/nonexistent' },
    });
    const started = findEvent(parseJsonEvents(result.stdout), 'started');

    expect(started).toMatchObject({ data: { options: { frames: 12, timeout: 20 } } });
    expect(findEvent(parseJsonEvents(result.stdout), 'error')?.code).not.toBe('VALIDATION');
  });

  it('defers unpassed --frames to config and lets explicit --frames win', async () => {
    const home = createTestDir();
    const videoPath = join(testDir, 'clip.mp4');
    const binDir = createFailingClaudeBinary(home);
    const env = { HOME: home, PATH: binDir };
    copyFileSync(join(getProjectRoot(), 'test', 'BigBuckBunny480p30s.mp4'), videoPath);
    await runCli(['config', 'set', 'frames', '1', '--json'], { cwd: home, env });
    await runCli(['config', 'set', 'whisper_mode', 'skip', '--json'], { cwd: home, env });

    const configured = await runCli(['process', videoPath, '--json'], { cwd: testDir, env });

    expect(configured.exitCode).toBeGreaterThan(0);
    expect(readdirSync(join(testDir, 'frames', 'clip'))).toHaveLength(1);

    const overridden = await runCli(['process', videoPath, '--frames', '2', '--json'], { cwd: testDir, env });

    expect(overridden.exitCode).toBeGreaterThan(0);
    expect(readdirSync(join(testDir, 'frames', 'clip'))).toHaveLength(2);
    cleanupTestDir(home);
  });
});
