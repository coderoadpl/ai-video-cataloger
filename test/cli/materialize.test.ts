import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createFakeVideoFile } from '../helpers/fixtures.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('materialize command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('errors with the folder taxonomy when the root does not exist', async () => {
    const missing = join(testDir, 'missing');
    const result = await runCli(['materialize', missing, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(26);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'FOLDER_NOT_FOUND', data: { path: missing } });
  });

  it('errors with the not-a-directory taxonomy when the root is a file', async () => {
    const filePath = join(testDir, 'not-a-folder.mp4');
    writeFileSync(filePath, 'not a folder');
    const result = await runCli(['materialize', filePath, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(27);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'NOT_A_DIRECTORY', data: { path: filePath } });
  });

  it('uses the drive-empty taxonomy for a root with no catalog folders', async () => {
    const result = await runCli(['materialize', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(39);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'DRIVE_ROOT_EMPTY' });
  });

  it('reports an uncataloged video as not_in_catalog and exits zero', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');

    const result = await runCli(['materialize', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'materialize' });
    expect(findEvent(events, 'run-started')).toMatchObject({ root: testDir, foldersTotal: 1, filesTotal: 1, dryRun: false });
    expect(findEvent(events, 'folder-started')).toMatchObject({ path: testDir, filesTotal: 1, writable: true });
    const progress = events.find((event) => event.type === 'progress' && event.step === 'file-skipped');
    expect(progress).toMatchObject({ data: { video: join(testDir, 'clip.mp4'), reason: 'not_in_catalog' } });
    expect(findEvent(events, 'folder-done')).toMatchObject({ path: testDir, filesSkipped: 1 });
    expect(findEvent(events, 'run-summary')).toMatchObject({ root: testDir, filesSkipped: 1, filesMaterialized: 0 });
    expect(findEvent(events, 'completed')).toBeDefined();
  });

  it('--dry-run touches nothing on disk and reports the plan', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');
    const before = readdirSync(testDir).sort();

    const result = await runCli(['materialize', testDir, '--dry-run', '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(findEvent(events, 'run-summary')).toMatchObject({ dryRun: true, filesMaterialized: 0, filesSkipped: 1 });
    expect(readdirSync(testDir).sort()).toEqual(before);
  });
});
