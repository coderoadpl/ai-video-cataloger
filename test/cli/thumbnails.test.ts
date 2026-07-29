import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createAllMockArtifacts, createFakeVideoFile } from '../helpers/fixtures.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('thumbnails command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('errors with the folder taxonomy when the root does not exist', async () => {
    const missing = join(testDir, 'missing');
    const result = await runCli(['thumbnails', missing, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });

  it('errors with the not-a-directory taxonomy when the root is a file', async () => {
    const filePath = join(testDir, 'not-a-folder.mp4');
    writeFileSync(filePath, 'not a folder');
    const result = await runCli(['thumbnails', filePath, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(findEvent(events, 'error')).toMatchObject({ code: 'NOT_A_DIRECTORY' });
  });

  it('reports all-zero counts and completes on an empty tree', async () => {
    const result = await runCli(['thumbnails', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'thumbnails', data: { root: testDir, force: false } });
    const scanning = events.find((event) => event.type === 'progress' && event.step === 'thumbnails_scanning');
    expect(scanning).toBeDefined();
    const done = events.find((event) => event.type === 'progress' && event.step === 'thumbnails_done');
    expect(done).toMatchObject({ data: { candidates: 0, generated: 0, failed: 0 } });
    expect(findEvent(events, 'completed')).toBeDefined();
  });

  it('scans a video with no analysis as a non-candidate', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');

    const result = await runCli(['thumbnails', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    const done = events.find((event) => event.type === 'progress' && event.step === 'thumbnails_done');
    expect(done).toMatchObject({ data: { candidates: 0, generated: 0 } });
  });

  it('generates a cover from the stored analysis frame for a completed video', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');
    createAllMockArtifacts(testDir, 'clip.mp4');

    const result = await runCli(['thumbnails', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    const fileEvent = events.find((event) => event.type === 'progress' && event.step === 'thumbnails_file');
    expect(fileEvent).toMatchObject({ data: { source: 'frame' } });
    const completed = findEvent(events, 'completed');
    expect(completed).toMatchObject({ data: { generated: 1, fromFrame: 1, fromSource: 0 } });
    expect(existsSync(join(testDir, '.ai-video-cataloger', 'thumbnails', 'clip.jpg'))).toBe(true);
  });

  it('is a no-op on a second run without --force', async () => {
    createFakeVideoFile(testDir, 'clip.mp4');
    createAllMockArtifacts(testDir, 'clip.mp4');
    await runCli(['thumbnails', testDir, '--json'], { cwd: testDir });

    const result = await runCli(['thumbnails', testDir, '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    const completed = findEvent(events, 'completed');
    expect(completed).toMatchObject({ data: { generated: 0, skipped: 1 } });
  });

  it('propagates --force in the started event', async () => {
    const result = await runCli(['thumbnails', testDir, '--force', '--json'], { cwd: testDir });
    const events = parseJsonEvents(result.stdout);

    expect(findEvent(events, 'started')).toMatchObject({ data: { force: true } });
  });
});
