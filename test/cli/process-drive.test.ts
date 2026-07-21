import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createFakeVideoFile } from '../helpers/fixtures.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
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
});
