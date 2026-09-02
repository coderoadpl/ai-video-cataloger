import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogFolder } from '@core/domain/index.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import { SqlJsPhotosStore } from './photos-store.js';

const roots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-backup-snapshot-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('backup database snapshots', () => {
  it('exports 25 recent global-catalog mutations into an integrity-checked snapshot', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const target = path.join(home, 'staging', 'catalog.db');
    for (let index = 0; index < 25; index += 1) {
      expect((await store.upsertFolder(folder(index))).ok).toBe(true);
    }
    const result = await store.snapshotTo(target);

    expect(result).toEqual({ ok: true, value: { sizeBytes: expect.any(Number), schemaVersion: 16 } });
    const SQL = await initSqlJs();
    const client = new SQL.Database(await readFile(target));
    expect(client.exec('SELECT COUNT(*) FROM folders')[0]?.values[0]?.[0]).toBe(25);
    expect(client.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]).toBe('ok');
    client.close();
  });

  it('waits for a live writer lease and snapshots after it is released', async () => {
    const home = await tempHome();
    const lockPath = path.join(home, '.ai-video-cataloger', 'catalog.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    let writerAlive = true;
    await writeFile(lockPath, `${JSON.stringify({
      pid: 987654,
      processName: 'gui',
      startedAt: '2026-09-02T12:00:00.000Z',
      hostname: hostname(),
    })}\n`);
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => writerAlive,
    });
    setTimeout(() => {
      writerAlive = false;
    }, 25);

    const result = await store.snapshotTo(path.join(home, 'staging', 'catalog.db'));

    expect(result).toMatchObject({ ok: true });
  });

  it('exports the photos database through the same snapshot contract', async () => {
    const home = await tempHome();
    const store = new SqlJsPhotosStore({ homeDirectory: home });
    await store.upsertFolder({
      folderId: 'path-aaaaaaaa',
      currentPath: '/media/photos',
      displayName: 'photos',
      firstSeenAt: '2026-09-02T12:00:00.000Z',
      lastSeenAt: '2026-09-02T12:00:00.000Z',
      defaultConfigId: null,
    });

    const result = await store.snapshotTo(path.join(home, 'staging', 'photos.db'));

    expect(result).toEqual({ ok: true, value: { sizeBytes: expect.any(Number), schemaVersion: 6 } });
  });
});

const folder = (index: number): CatalogFolder => ({
  folderId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  currentPath: `/media/folder-${String(index)}`,
  displayName: `folder-${String(index)}`,
  firstSeenAt: '2026-09-02T12:00:00.000Z',
  lastSeenAt: '2026-09-02T12:00:00.000Z',
});
