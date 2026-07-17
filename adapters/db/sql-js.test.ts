import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configSchema, type Video } from '@core/domain/index.js';

import { JsonConfigStore, SqlJsCatalogRepositoryFactory } from './sql-js.js';

const tempRoots: string[] = [];

describe('SqlJsCatalogRepositoryFactory', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('creates a fresh catalog database and persists writes to disk', async () => {
    const folder = await tempRoot();
    const factory = new SqlJsCatalogRepositoryFactory();
    const opened = await factory.open(folder);
    if (!opened.ok) throw new Error(opened.error.message);

    const created = await opened.value.createVideo(videoInput(folder));
    if (!created.ok) throw new Error(created.error.message);

    expect(created.value.id).toBe(1);
    expect(created.value.status).toBe('pending');
    expect(opened.value.databasePath()).toBe(path.join(folder, '.ai-video-cataloger', 'catalog.db'));

    const reopened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const videos = await reopened.value.listVideos();
    if (!videos.ok) throw new Error(videos.error.message);

    expect(videos.value).toHaveLength(1);
    expect(videos.value[0]).toMatchObject({
      id: 1,
      originalPath: path.join(folder, 'clip.mp4'),
      originalName: 'clip.mp4',
      fileHash: 'hash-1',
      status: 'pending',
    });
  });

  it('persists update, clear, and reset mutations after each write', async () => {
    const folder = await tempRoot();
    const opened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!opened.ok) throw new Error(opened.error.message);
    const created = await opened.value.createVideo(videoInput(folder));
    if (!created.ok) throw new Error(created.error.message);

    const status = await opened.value.updateVideoStatus(created.value.id, 'error', 'failed');
    if (!status.ok) throw new Error(status.error.message);
    const reset = await opened.value.resetVideoByOriginalName('clip.mp4');
    if (!reset.ok) throw new Error(reset.error.message);
    expect(reset.value?.before.status).toBe('error');
    expect(reset.value?.after.status).toBe('pending');
    expect(reset.value?.after.errorMessage).toBeNull();

    const reopened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const listed = await reopened.value.listVideos();
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value[0]?.status).toBe('pending');

    const cleared = await reopened.value.clearVideos();
    if (!cleared.ok) throw new Error(cleared.error.message);
    expect(cleared.value.cleared).toBe(1);

    const afterClear = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!afterClear.ok) throw new Error(afterClear.error.message);
    const empty = await afterClear.value.listVideos();
    if (!empty.ok) throw new Error(empty.error.message);
    expect(empty.value).toEqual([]);
  });

  it('reloads external writes before reads and later writes', async () => {
    const folder = await tempRoot();
    const factoryA = new SqlJsCatalogRepositoryFactory();
    const factoryB = new SqlJsCatalogRepositoryFactory();
    const openedA = await factoryA.open(folder);
    const openedB = await factoryB.open(folder);
    if (!openedA.ok) throw new Error(openedA.error.message);
    if (!openedB.ok) throw new Error(openedB.error.message);

    const createdB = await openedB.value.createVideo(videoInput(folder));
    if (!createdB.ok) throw new Error(createdB.error.message);
    const visibleToA = await openedA.value.listVideos();
    if (!visibleToA.ok) throw new Error(visibleToA.error.message);
    expect(visibleToA.value.map((video) => video.originalName)).toEqual(['clip.mp4']);

    const createdA = await openedA.value.createVideo({
      ...videoInput(folder),
      originalPath: path.join(folder, 'second.mp4'),
      originalName: 'second.mp4',
      fileHash: 'hash-2',
    });
    if (!createdA.ok) throw new Error(createdA.error.message);

    const reopened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const persisted = await reopened.value.listVideos();
    if (!persisted.ok) throw new Error(persisted.error.message);
    expect(persisted.value.map((video) => video.originalName).sort()).toEqual(['clip.mp4', 'second.mp4']);
  });

  it('uses the folder realpath as its repository cache key', async () => {
    const folder = await tempRoot();
    const aliasRoot = await tempRoot();
    const alias = path.join(aliasRoot, 'folder-alias');
    await symlink(folder, alias, 'dir');
    const factory = new SqlJsCatalogRepositoryFactory();

    const direct = await factory.open(folder);
    const linked = await factory.open(alias);
    if (!direct.ok) throw new Error(direct.error.message);
    if (!linked.ok) throw new Error(linked.error.message);

    expect(linked.value).toBe(direct.value);
  });

  it('keeps the existing catalog intact when an atomic temp export fails', async () => {
    const folder = await tempRoot();
    const factory = new SqlJsCatalogRepositoryFactory();
    const opened = await factory.open(folder);
    if (!opened.ok) throw new Error(opened.error.message);
    const first = await opened.value.createVideo(videoInput(folder));
    if (!first.ok) throw new Error(first.error.message);
    const databasePath = opened.value.databasePath();
    if (databasePath === null) throw new Error('Expected a persisted database path');
    const tempPath = `${databasePath}.tmp`;
    await mkdir(tempPath);

    const failed = await opened.value.createVideo({
      ...videoInput(folder),
      originalPath: path.join(folder, 'second.mp4'),
      originalName: 'second.mp4',
      fileHash: 'hash-2',
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'internal' } });
    await rm(tempPath, { recursive: true });

    const reopened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const persisted = await reopened.value.listVideos();
    if (!persisted.ok) throw new Error(persisted.error.message);
    expect(persisted.value.map((video) => video.originalName)).toEqual(['clip.mp4']);
  });

  it('opens a catalog database constructed from the old implementation schema SQL', async () => {
    const folder = await tempRoot();
    await createOldCodePathDatabase(folder);

    const opened = await new SqlJsCatalogRepositoryFactory().open(folder);
    if (!opened.ok) throw new Error(opened.error.message);
    const found = await opened.value.findVideoByPath(path.join(folder, 'old.mp4'));
    if (!found.ok) throw new Error(found.error.message);

    expect(found.value).toMatchObject({
      id: 1,
      originalPath: path.join(folder, 'old.mp4'),
      originalName: 'old.mp4',
      newName: 'new-old.mp4',
      fileHash: 'old-hash',
      status: 'completed',
      errorMessage: null,
    });
    expect(found.value?.createdAt).toBe('2026-07-12T10:11:12.000Z');
  });
});

describe('JsonConfigStore', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('stores folder config as string values in config.json', async () => {
    const folder = await tempRoot();
    const store = new JsonConfigStore();

    const first = await store.set({ kind: 'folder', folder }, 'frames', '7');
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.previousValue).toBeNull();

    const second = await store.set({ kind: 'folder', folder }, 'skip_rename', 'true');
    if (!second.ok) throw new Error(second.error.message);

    const all = await store.getAll({ kind: 'folder', folder });
    if (!all.ok) throw new Error(all.error.message);
    expect(all.value).toEqual({ frames: '7', skip_rename: 'true' });

    const raw = await readFile(path.join(folder, '.ai-video-cataloger', 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ frames: '7', skip_rename: 'true' });
  });

  it('uses the configured home directory for home-scope config', async () => {
    const home = await tempRoot();
    const store = new JsonConfigStore({ homeDirectory: home });

    const saved = await store.set({ kind: 'home' }, 'whisper_model', 'small');
    if (!saved.ok) throw new Error(saved.error.message);
    const loaded = await store.get({ kind: 'home' }, 'whisper_model');
    if (!loaded.ok) throw new Error(loaded.error.message);

    expect(loaded.value).toBe('small');
    const raw = await readFile(path.join(home, '.ai-video-cataloger', 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ whisper_model: 'small' });
  });

  it('keeps the existing config intact when its atomic temp write fails', async () => {
    const folder = await tempRoot();
    const store = new JsonConfigStore();
    const first = await store.set({ kind: 'folder', folder }, 'frames', '7');
    if (!first.ok) throw new Error(first.error.message);
    const filePath = path.join(folder, '.ai-video-cataloger', 'config.json');
    const before = await readFile(filePath, 'utf8');
    await mkdir(`${filePath}.tmp`);

    const failed = await store.set({ kind: 'folder', folder }, 'frames', '8');

    expect(failed).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('loads and normalizes a v1 config.json fixture without rewriting it', async () => {
    const folder = await tempRoot();
    const configDirectory = path.join(folder, '.ai-video-cataloger');
    await mkdir(configDirectory, { recursive: true });
    const fixture = await readFile(new URL('./fixtures/v1-config.json', import.meta.url), 'utf8');
    await writeFile(path.join(configDirectory, 'config.json'), fixture, 'utf8');

    const loaded = await new JsonConfigStore().getAll({ kind: 'folder', folder });
    if (!loaded.ok) throw new Error(loaded.error.message);
    const normalized = configSchema.parse(loaded.value);

    expect(normalized.analyzer_backend).toBe('claude');
    expect(normalized.analyzer_provider).toMatchObject({ family: 'harness', providerId: 'claude-code' });
    expect(await readFile(path.join(configDirectory, 'config.json'), 'utf8')).toBe(fixture);
  });

  it('logs malformed legacy config loudly while preserving the legacy empty fallback', async () => {
    const folder = await tempRoot();
    const configDirectory = path.join(folder, '.ai-video-cataloger');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, 'config.json'), '{not json', 'utf8');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const loaded = await new JsonConfigStore().getAll({ kind: 'folder', folder });

    expect(loaded).toEqual({ ok: true, value: {} });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid config file'));
    error.mockRestore();
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-db-'));
  tempRoots.push(root);
  return root;
};

const videoInput = (folder: string): Omit<Video, 'id'> => ({
  originalPath: path.join(folder, 'clip.mp4'),
  originalName: 'clip.mp4',
  newName: null,
  fileHash: 'hash-1',
  status: 'pending',
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:00:00.000Z',
  errorMessage: null,
});

const createOldCodePathDatabase = async (folder: string): Promise<void> => {
  const dbDir = path.join(folder, '.ai-video-cataloger');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const statement of await oldSchemaStatements()) db.run(statement);
  db.run(
    `INSERT INTO videos (
      original_path,
      original_name,
      new_name,
      file_hash,
      status,
      created_at,
      updated_at,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      path.join(folder, 'old.mp4'),
      'old.mp4',
      'new-old.mp4',
      'old-hash',
      'completed',
      '2026-07-12 10:11:12',
      '2026-07-12 10:12:13',
      null,
    ],
  );
  await import('node:fs/promises').then((fs) => fs.mkdir(dbDir, { recursive: true }));
  await import('node:fs/promises').then((fs) => fs.writeFile(path.join(dbDir, 'catalog.db'), Buffer.from(db.export())));
  db.close();
};

const oldSchemaStatements = async (): Promise<string[]> => {
  const source = await readFile(path.resolve('test/e2e/fixtures/old-schema.sql'), 'utf8');
  const statements = source
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  expect(statements).toHaveLength(2);
  return statements;
};
