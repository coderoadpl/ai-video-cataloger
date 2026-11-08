import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';
import { derivedFolderId, type AppError, type Result } from '@core/domain/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

const now = '2026-11-01T10:00:00.000Z';

const requiredValue = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const seedCatalog = async (home: string, folderPath: string): Promise<string> => {
  const folderId = derivedFolderId(folderPath);
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  requiredValue(await store.upsertFolder({ folderId, currentPath: folderPath, displayName: 'trip', firstSeenAt: now, lastSeenAt: now }));
  requiredValue(await store.upsertFile({
    fingerprint: 'fp-cli-relocate',
    folderId,
    fileName: 'clip.mp4',
    size: 1,
    durationS: null,
    width: null,
    height: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: now,
    analyzer: null,
    model: null,
    missingAt: null,
    capturedAt: null,
    capturedAtSource: null,
    gpsSource: null,
    gpsAccuracyM: null,
    gpsIntervalKind: null,
    gpsResolvedAt: null,
    place: null,
  }));
  requiredValue(await store.dispose());
  const photos = new SqlJsPhotosStore({ homeDirectory: home });
  requiredValue(await photos.flush());
  requiredValue(await photos.dispose());
  mkdirSync(join(home, '.ai-video-cataloger', 'read-only-folders', folderId, 'thumbnails'), { recursive: true });
  return folderId;
};

const folderPathOf = async (home: string, folderId: string): Promise<string | null> => {
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  const folder = requiredValue(await store.getFolder(folderId));
  requiredValue(await store.dispose());
  return folder?.currentPath ?? null;
};

describe('relocate-root command', () => {
  let testDir: string;
  let home: string;
  let oldRoot: string;
  let newRoot: string;

  beforeEach(() => {
    testDir = createTestDir();
    home = createTestDir();
    oldRoot = join(testDir, 'old-drive');
    newRoot = join(testDir, 'new-drive');
    mkdirSync(join(newRoot, 'trip'), { recursive: true });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
    cleanupTestDir(home);
  });

  it('prints the plan as NDJSON and changes nothing without --apply', async () => {
    const oldId = await seedCatalog(home, join(oldRoot, 'trip'));

    const result = await runCli(['relocate-root', '--from', oldRoot, '--to', newRoot, '--json'], { cwd: testDir, env: { HOME: home } });

    const events = parseJsonEvents(result.stdout);
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'relocate_root', data: { from: oldRoot, to: newRoot, media: 'all', apply: false } });
    expect(events.filter((event) => event.step === 'relocate-root-database').map((event) => event.data))
      .toEqual([expect.objectContaining({ media: 'video', folders: 1, files: 1 }), expect.objectContaining({ media: 'photo', folders: 0 })]);
    expect(findEvent(events, 'completed')?.data).toMatchObject({ applied: false, targetMounted: true, warnings: [] });
    expect(await folderPathOf(home, oldId)).toBe(join(oldRoot, 'trip'));
    expect(existsSync(join(home, '.ai-video-cataloger', 'backups'))).toBe(false);
  });

  it('backs up both databases, rewrites the catalog and renames the mirror with --apply', async () => {
    const oldId = await seedCatalog(home, join(oldRoot, 'trip'));
    const newId = derivedFolderId(join(newRoot, 'trip'));

    const result = await runCli(['relocate-root', '--from', oldRoot, '--to', newRoot, '--apply'], { cwd: testDir, env: { HOME: home } });

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`Rewrote ${oldRoot} -> ${newRoot}`);
    expect(result.stdout).toContain(`Remaining under ${oldRoot}: video 0 folders, 0 paths, 0 runs; photo 0 folders, 0 paths, 0 runs`);
    expect(await folderPathOf(home, oldId)).toBeNull();
    expect(await folderPathOf(home, newId)).toBe(join(newRoot, 'trip'));
    expect(existsSync(join(home, '.ai-video-cataloger', 'read-only-folders', newId, 'thumbnails'))).toBe(true);
    expect(existsSync(join(home, '.ai-video-cataloger', 'read-only-folders', oldId))).toBe(false);
    const backups = readdirSync(join(home, '.ai-video-cataloger', 'backups'));
    expect(backups).toEqual([expect.stringMatching(/--relocate-root$/)]);
    expect(readdirSync(join(home, '.ai-video-cataloger', 'backups', backups[0] ?? '')).sort()).toEqual(['catalog.db', 'photos.db']);
  });

  it('exits with the conflict code and writes nothing when the target id already exists', async () => {
    const oldId = await seedCatalog(home, join(oldRoot, 'trip'));
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    requiredValue(await store.upsertFolder({
      folderId: derivedFolderId(join(newRoot, 'trip')),
      currentPath: join(newRoot, 'trip'),
      displayName: 'trip',
      firstSeenAt: now,
      lastSeenAt: now,
    }));
    requiredValue(await store.dispose());

    const result = await runCli(['relocate-root', '--from', oldRoot, '--to', newRoot, '--apply', '--json'], { cwd: testDir, env: { HOME: home } });

    expect(result.exitCode).toBe(6);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'CONFLICT' });
    expect(await folderPathOf(home, oldId)).toBe(join(oldRoot, 'trip'));
    expect(existsSync(join(home, '.ai-video-cataloger', 'backups'))).toBe(false);
  });

  it('refuses --apply while the app holds the catalog lock', async () => {
    const oldId = await seedCatalog(home, join(oldRoot, 'trip'));
    writeFileSync(join(home, '.ai-video-cataloger', 'catalog.lock'), `${JSON.stringify({
      pid: process.pid,
      processName: 'gui',
      startedAt: now,
      hostname: hostname(),
    })}\n`);

    const result = await runCli(['relocate-root', '--from', oldRoot, '--to', newRoot, '--apply', '--json'], { cwd: testDir, env: { HOME: home } });

    expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'CATALOG_LOCKED' });
    expect(result.exitCode).not.toBe(0);
    expect(await folderPathOf(home, oldId)).toBe(join(oldRoot, 'trip'));
    expect(existsSync(join(home, '.ai-video-cataloger', 'backups'))).toBe(false);
  });
});
