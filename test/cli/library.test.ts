import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/index.js';
import { derivedFolderId, type AppError, type Result } from '@core/domain/index.js';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

const requiredValue = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const seedCatalogVideo = async (folder: string, home: string): Promise<{ fingerprint: string; videoPath: string }> => {
  const videoPath = join(folder, 'clip.mp4');
  writeFileSync(videoPath, Buffer.alloc(2048, 1));
  const fingerprint = 'fp-cli-trash-dry-run';
  const folderId = derivedFolderId(folder);
  const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  requiredValue(await store.upsertFolder({
    folderId,
    currentPath: folder,
    displayName: 'fixture',
    firstSeenAt: '2026-08-02T09:00:00.000Z',
    lastSeenAt: '2026-08-02T11:00:00.000Z',
  }));
  requiredValue(await store.upsertFile({
    fingerprint,
    folderId,
    fileName: fs.basename(videoPath),
    size: statSync(videoPath).size,
    durationS: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-08-02T11:00:00.000Z',
    analyzer: null,
    model: null,
    missingAt: null,
  }));
  requiredValue(await store.dispose());
  return { fingerprint, videoPath };
};

describe('library commands', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('rejects hide without exactly one selection scope', async () => {
    const result = await runCli(['library', 'hide', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')?.code).toBe('VALIDATION');
  });

  it('reports validation when a dry-run trash filter resolves no files', async () => {
    const result = await runCli(['library', 'trash', '--hidden', 'only', '--dry-run', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'VALIDATION' });
  });

  it('lets --dry-run win over --yes without moving files', async () => {
    const home = createTestDir();
    try {
      const fixture = await seedCatalogVideo(testDir, home);

      const result = await runCli(['library', 'trash', '--fingerprint', fixture.fingerprint, '--dry-run', '--yes', '--json'], {
        cwd: testDir,
        env: { HOME: home },
      });

      const events = parseJsonEvents(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(findEvent(events, 'completed')?.data).toMatchObject({ kind: 'plan', total: 1 });
      expect(existsSync(fixture.videoPath)).toBe(true);
      const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
      expect(requiredValue(await store.getFile(fixture.fingerprint))?.fingerprint).toBe(fixture.fingerprint);
      requiredValue(await store.dispose());
    } finally {
      cleanupTestDir(home);
    }
  });

  it('prints the plan and exits confirmation_required without --yes', async () => {
    const home = createTestDir();
    try {
      const fixture = await seedCatalogVideo(testDir, home);

      const result = await runCli(['library', 'trash', '--fingerprint', fixture.fingerprint, '--json'], {
        cwd: testDir,
        env: { HOME: home },
      });

      const events = parseJsonEvents(result.stdout);
      expect(result.exitCode).toBe(18);
      expect(events.find((event) => event.kind === 'plan')).toMatchObject({ total: 1, artifactPaths: expect.any(Array) });
      expect(findEvent(events, 'error')).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(existsSync(fixture.videoPath)).toBe(true);
    } finally {
      cleanupTestDir(home);
    }
  });

  it('keeps library selection filter flags aligned with search help', async () => {
    const search = await runCli(['search', '--help'], { cwd: testDir });
    const hide = await runCli(['library', 'hide', '--help'], { cwd: testDir });
    const trash = await runCli(['library', 'trash', '--help'], { cwd: testDir });
    const shared = ['--tag', '--person', '--place', '--from', '--to', '--has-gps', '--no-has-gps', '--folder', '--hidden', '--json'];
    const libraryOnly = ['--media', '--fingerprint', '--of-person', '--skip-shared'];

    expect(search.stdout).toContain('[query]');
    for (const flag of shared) {
      expect(search.stdout).toContain(flag);
      expect(hide.stdout).toContain(flag);
      expect(trash.stdout).toContain(flag);
    }
    for (const flag of libraryOnly) expect(hide.stdout).toContain(flag);
    expect(trash.stdout).toContain('--dry-run');
    expect(trash.stdout).toContain('--yes');
    expect(hide.stdout).not.toContain('--sort');
    expect(hide.stdout).not.toContain('--limit');
    expect(hide.stdout).not.toContain('--offset');
  });
});
