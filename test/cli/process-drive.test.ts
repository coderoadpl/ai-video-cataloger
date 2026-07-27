import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createFailingClaudeBinary, createFakeVideoFile } from '../helpers/fixtures.js';
import { findEvent, getProjectRoot, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('process-drive command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('errors with the folder taxonomy when the root does not exist', async () => {
    const missing = join(testDir, 'missing');
    const result = await runCli(['process-drive', missing, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(26);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'FOLDER_NOT_FOUND', data: { path: missing } });
  });

  it('uses the drive-empty taxonomy for a root with no catalog folders', async () => {
    const result = await runCli(['process-drive', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(39);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'DRIVE_ROOT_EMPTY' });
  });

  it('emits drive NDJSON events and exits zero when a file failure is recorded but the run completes', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');

    const result = await runCli(['process-drive', testDir, '--whisper', 'skip', '--skip-rename', '--json'], {
      cwd: testDir,
      env: { PATH: '/nonexistent' },
    });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'process_drive' });
    expect(findEvent(events, 'run-started')).toMatchObject({ root: testDir, foldersTotal: 1, filesTotal: 1 });
    expect(findEvent(events, 'folder-started')).toMatchObject({ path: testDir, filesTotal: 1 });
    expect(findEvent(events, 'folder-done')).toMatchObject({ path: testDir, filesFailed: 1 });
    expect(findEvent(events, 'run-summary')).toMatchObject({ root: testDir, filesFailed: 1 });
    expect(findEvent(events, 'completed')).toBeDefined();
  });

  it('keeps a write-protected folder in the run and mirrors its artifacts into the home scope', async () => {
    const home = createTestDir();
    const folder = join(testDir, 'ro');
    mkdirSync(folder);
    copyFileSync(join(getProjectRoot(), 'test', 'BigBuckBunny480p30s.mp4'), join(folder, 'clip.mp4'));
    chmodSync(folder, 0o555);

    try {
      const result = await runCli(
        ['process-drive', testDir, '--whisper', 'skip', '--skip-rename', '--frames', '1', '--analyzer', 'api', '--json'],
        { cwd: testDir, env: { HOME: home } },
      );
      const summary = findEvent(parseJsonEvents(result.stdout), 'run-summary');

      expect(result.exitCode).toBe(0);
      expect(summary).toMatchObject({ foldersTotal: 1, filesTotal: 1 });
      expect(JSON.stringify(summary?.failures)).not.toContain('EACCES');
      expect(readdirSync(folder)).toEqual(['clip.mp4']);
      const mirrors = readdirSync(join(home, '.ai-video-cataloger', 'read-only-folders'));
      expect(mirrors).toHaveLength(1);
      expect(existsSync(join(home, '.ai-video-cataloger', 'read-only-folders', mirrors[0] ?? '', 'frames', 'clip', 'frame-001.jpg'))).toBe(true);
    } finally {
      chmodSync(folder, 0o755);
      cleanupTestDir(home);
    }
  });

  it('defers unpassed --frames to config and lets explicit --frames win', async () => {
    const home = createTestDir();
    const binDir = createFailingClaudeBinary(home);
    const env = { HOME: home, PATH: binDir };
    copyFileSync(join(getProjectRoot(), 'test', 'BigBuckBunny480p30s.mp4'), join(testDir, 'clip.mp4'));
    await runCli(['config', 'set', 'frames', '1', '--json'], { cwd: home, env });
    await runCli(['config', 'set', 'whisper_mode', 'skip', '--json'], { cwd: home, env });

    const configured = await runCli(['process-drive', testDir, '--json'], { cwd: testDir, env });

    expect(configured.exitCode).toBe(0);
    expect(readdirSync(join(testDir, 'frames', 'clip'))).toHaveLength(1);

    const overridden = await runCli(['process-drive', testDir, '--frames', '2', '--json'], { cwd: testDir, env });

    expect(overridden.exitCode).toBe(0);
    expect(readdirSync(join(testDir, 'frames', 'clip'))).toHaveLength(2);
    cleanupTestDir(home);
  });
});
