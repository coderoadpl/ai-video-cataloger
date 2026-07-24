import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogFile, CatalogFolder } from '@core/domain/index.js';

import { SqlJsGlobalCatalogStore } from './global-catalog.js';
import {
  createGlobalCatalogSchemaSqlV1,
  migrateGlobalCatalogSchemaSqlV2,
  migrateGlobalCatalogSchemaSqlV3,
  migrateGlobalCatalogSchemaSqlV4,
  migrateGlobalCatalogSchemaSqlV5,
  migrateGlobalCatalogSchemaSqlV6,
} from './global-catalog-schema.js';

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-global-'));
  tempRoots.push(root);
  return root;
};

const folder: CatalogFolder = {
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/media/drive-a',
  displayName: 'drive-a',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
};

const file: CatalogFile = {
  fingerprint: 'fp-abc',
  folderId: folder.folderId,
  fileName: 'clip.mp4',
  size: 1024,
  durationS: 30.5,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-03T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
  missingAt: null,
};

describe('SqlJsGlobalCatalogStore', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('migrates a fresh database and persists upserts across reopen', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    expect(store.databasePath()).toBe(path.join(home, '.ai-video-cataloger', 'catalog.db'));

    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.upsertFile(file)).ok).toBe(true);
    expect((await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    })).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 1, analyses: 1 });

    const records = await reopened.listFolderRecords(folder.folderId);
    expect(records.ok && records.value.length).toBe(1);
    if (records.ok) {
      expect(records.value[0]?.file.durationS).toBe(30.5);
      expect(records.value[0]?.analysis?.language).toBe('en');
    }

    const search = await reopened.search({ match: 'clip*', rankingTerms: ['clip'], limit: 10, offset: 0 });
    expect(search.ok && search.value[0]?.fingerprint).toBe(file.fingerprint);
    expect(search.ok && search.value[0]?.tags).toEqual(['a-clip']);
  });

  it('rejects a second writer with catalog_locked and the owner PID', async () => {
    const home = await tempHome();
    await writeLock(home, {
      pid: 123456,
      processName: 'gui',
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: 'host-a',
    });

    const second = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: (pid) => pid === 123456,
    });
    const blocked = await second.upsertFolder({ ...folder, folderId: '33333333-3333-4333-8333-333333333333' });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe('catalog_locked');
      expect(blocked.error.message).toContain('PID 123456');
      expect(blocked.error.message).toContain('Catalog is in use by gui');
    }
  });

  it('takes over a stale catalog lock', async () => {
    const home = await tempHome();
    await writeLock(home, {
      pid: 987654,
      processName: 'gui',
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: 'host-a',
    });
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => false,
    });

    expect((await store.upsertFolder(folder)).ok).toBe(true);
    const status = await store.lockStatus();

    expect(status.ok && status.value.owner?.processName).toBe('cli');
    await store.dispose();
  });

  it('allows reads while another process holds the catalog lock', async () => {
    const home = await tempHome();
    await writeLock(home, {
      pid: 123456,
      processName: 'gui',
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: 'host-a',
    });
    const reader = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => true,
    });

    const counts = await reader.counts();
    const lock = await readFile(lockPath(home), 'utf8');

    expect(counts.ok && counts.value).toEqual({ folders: 0, files: 0, analyses: 0 });
    expect(lock).toContain('"pid":123456');
    expect(lock).toContain('"processName":"gui"');
  });

  it('releases its lock on dispose', async () => {
    const home = await tempHome();
    const first = new SqlJsGlobalCatalogStore({ homeDirectory: home, processName: 'gui' });
    expect((await first.upsertFolder(folder)).ok).toBe(true);
    await first.dispose();

    const second = new SqlJsGlobalCatalogStore({ homeDirectory: home, processName: 'cli' });
    const written = await second.upsertFolder({ ...folder, folderId: '33333333-3333-4333-8333-333333333333' });

    expect(written.ok).toBe(true);
    await second.dispose();
  });

  it('overwrites a row on conflicting fingerprint upsert', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertFile({ ...file, fileName: 'renamed.mp4', processedAt: '2026-05-01T00:00:00.000Z' });

    const stored = await store.getFile(file.fingerprint);
    expect(stored.ok && stored.value?.fileName).toBe('renamed.mp4');
    const counts = await store.counts();
    expect(counts.ok && counts.value.files).toBe(1);

    const search = await store.search({ match: 'renamed*', rankingTerms: ['renamed'], limit: 10, offset: 0 });
    expect(search.ok && search.value.map((row) => row.fileName)).toEqual(['renamed.mp4']);
  });

  it('batches writes: a crash before flush loses only un-flushed rows and a re-run heals', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);

    const afterCrash = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const crashedCounts = await afterCrash.counts();
    expect(crashedCounts.ok && crashedCounts.value).toEqual({ folders: 0, files: 0, analyses: 0 });

    const healed = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await healed.upsertFolder(folder);
    await healed.upsertFile(file);
    expect((await healed.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 1, analyses: 0 });
  });

  it('auto-flushes once the batched mutation count is reached', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    for (let index = 0; index < 25; index += 1) {
      await store.upsertFile({ ...file, fingerprint: `fp-${String(index)}`, fileName: `clip-${String(index)}.mp4` });
    }

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value.files).toBeGreaterThanOrEqual(24);
  });

  it('forgetPerson deletes the person and its face observations including embeddings', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertPerson({
      personId: 'person-1',
      displayName: 'Ada',
      kind: 'face',
      createdAt: '2026-01-04T00:00:00.000Z',
      centroid: Array.from({ length: 128 }, () => 0.1),
      exemplarCount: 1,
    });
    await store.upsertFaceObservation({
      obsId: 'obs-1',
      fingerprint: file.fingerprint,
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.2),
      quality: 0.9,
      personId: 'person-1',
      cropPath: null,
    });

    const forgotten = await store.forgetPerson('person-1');
    expect(forgotten.ok && forgotten.value.deleted).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const people = await reopened.listPeople();
    expect(people.ok && people.value.length).toBe(0);
    const observations = await reopened.listFaceObservations();
    expect(observations.ok && observations.value.length).toBe(0);
    const status = await reopened.faceStatus();
    expect(status.ok && status.value.observations).toBe(0);
  });

  it('forgetEntry returns the crop paths of the removed face observations', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertFaceObservation({
      obsId: 'obs-1',
      fingerprint: file.fingerprint,
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.2),
      quality: 0.9,
      personId: 'person-1',
      cropPath: '/home/faces/person-1/exemplar-001.jpg',
    });

    const forgotten = await store.forgetEntry(file.fingerprint);
    expect(forgotten.ok && forgotten.value.cropPaths).toEqual(['/home/faces/person-1/exemplar-001.jpg']);
  });

  it('reconcileFolder marks absent files, clears returning files, and skips duplicates elsewhere', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    const other: CatalogFile = { ...file, fingerprint: 'fp-two', fileName: 'two.mp4' };
    await store.upsertFile(other);

    const present = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [file.fingerprint, other.fingerprint],
      now: 1000,
    });
    expect(present.ok && present.value).toEqual({ marked: 0, cleared: 0 });

    const marked = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [file.fingerprint],
      now: 2000,
    });
    expect(marked.ok && marked.value.marked).toBe(1);
    const missingRow = await store.getFile(other.fingerprint);
    expect(missingRow.ok && missingRow.value?.missingAt).toBe(2000);

    const cleared = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [file.fingerprint, other.fingerprint],
      now: 3000,
    });
    expect(cleared.ok && cleared.value.cleared).toBe(1);
    const healed = await store.getFile(other.fingerprint);
    expect(healed.ok && healed.value?.missingAt).toBe(null);

    const elsewhere = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [file.fingerprint],
      fingerprintsPresentElsewhere: [other.fingerprint],
      now: 4000,
    });
    expect(elsewhere.ok && elsewhere.value.marked).toBe(0);
    const stillPresent = await store.getFile(other.fingerprint);
    expect(stillPresent.ok && stillPresent.value?.missingAt).toBe(null);
  });

  it('reconcileFolder never marks files missing when markMissing is false', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);

    const guarded = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [],
      markMissing: false,
      now: 1000,
    });
    expect(guarded.ok && guarded.value).toEqual({ marked: 0, cleared: 0 });
    const stillPresent = await store.getFile(file.fingerprint);
    expect(stillPresent.ok && stillPresent.value?.missingAt).toBe(null);

    const marked = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [],
      now: 2000,
    });
    expect(marked.ok && marked.value.marked).toBe(1);
  });

  it('keeps buffered acknowledged mutations after a controlled operation error', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.upsertFile(file)).ok).toBe(true);

    const failed = await store.setPersonName('missing-person', 'Nobody');
    expect(failed.ok).toBe(false);

    expect((await store.flush()).ok).toBe(true);
    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 1, analyses: 0 });
  });

  it('search exposes the missing flag from reconciliation', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    });

    const before = await store.search({ match: 'clip*', rankingTerms: ['clip'], limit: 10, offset: 0 });
    expect(before.ok && before.value[0]?.missing).toBe(false);

    await store.reconcileFolder({ folderId: folder.folderId, presentFingerprints: [], now: 5000 });
    const after = await store.search({ match: 'clip*', rankingTerms: ['clip'], limit: 10, offset: 0 });
    expect(after.ok && after.value[0]?.missing).toBe(true);
  });

  it('forgetEntry deletes the file, analysis, and search rows including FTS', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    });

    const forgotten = await store.forgetEntry(file.fingerprint);
    expect(forgotten.ok && forgotten.value).toEqual({
      fingerprint: file.fingerprint,
      deleted: true,
      folderId: folder.folderId,
      cropPaths: [],
    });
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 0, analyses: 0 });
    const search = await reopened.search({ match: 'clip*', rankingTerms: ['clip'], limit: 10, offset: 0 });
    expect(search.ok && search.value.length).toBe(0);

    const SQL = await initSqlJs();
    const raw = new SQL.Database(await readFile(reopened.databasePath()));
    const docRows = raw.exec('SELECT COUNT(*) FROM search_documents');
    const ftsRows = raw.exec('SELECT COUNT(*) FROM search_documents_fts');
    raw.close();
    expect(docRows[0]?.values[0]?.[0]).toBe(0);
    expect(ftsRows[0]?.values[0]?.[0]).toBe(0);

    const forgetMissing = await reopened.forgetEntry('nope');
    expect(forgetMissing.ok && forgetMissing.value).toEqual({ fingerprint: 'nope', deleted: false, folderId: null, cropPaths: [] });
  });

  it('migrates an existing v6 database to v7 and persists a reconciled missing_at value', async () => {
    const home = await tempHome();
    await writeV6Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const reconciled = await store.reconcileFolder({
      folderId: folder.folderId,
      presentFingerprints: [],
      now: 7000,
    });
    expect(reconciled.ok && reconciled.value.marked).toBe(1);
    expect((await store.flush()).ok).toBe(true);

    const SQL = await initSqlJs();
    const reopened = new SQL.Database(await readFile(store.databasePath()));
    const versionResult = reopened.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
    const columnResult = reopened.exec('PRAGMA table_info(files)');
    const missingResult = reopened.exec('SELECT missing_at FROM files WHERE fingerprint = ?', [file.fingerprint]);
    reopened.close();

    expect(versionResult[0]?.values[0]?.[0]).toBe(7);
    const columnNames = columnResult[0]?.values.map((row) => row[1]) ?? [];
    expect(columnNames).toContain('missing_at');
    expect(missingResult[0]?.values[0]?.[0]).toBe(7000);
  });

  it('migrates an existing v1 database to v6 and persists the migrated schema immediately', async () => {
    const home = await tempHome();
    await writeV1Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await store.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 0, files: 0, analyses: 0 });

    const SQL = await initSqlJs();
    const reopened = new SQL.Database(await readFile(store.databasePath()));
    const versionResult = reopened.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
    const columnResult = reopened.exec('PRAGMA table_info(files)');
    const facesTablesResult = reopened.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('face_index_state', 'people', 'face_observations') ORDER BY name",
    );
    reopened.close();

    expect(versionResult[0]?.values[0]?.[0]).toBe(7);
    const columnNames = columnResult[0]?.values.map((row) => row[1]).filter((value) => typeof value === 'string') ?? [];
    expect(columnNames).toContain('gps_lat');
    expect(columnNames).toContain('gps_lon');
    expect(columnNames).toContain('missing_at');
    expect(facesTablesResult[0]?.values.map((row) => row[0])).toEqual(['face_index_state', 'face_observations', 'people']);
  });

  it('migrates an existing v5 database to v6 and backfills stale face index state', async () => {
    const home = await tempHome();
    await writeV5Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const status = await store.faceStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error(status.error.message);
    expect(status.value.observations).toBe(1);
    expect(status.value.staleVersionFiles).toBe(1);

    const SQL = await initSqlJs();
    const reopened = new SQL.Database(await readFile(store.databasePath()));
    const versionResult = reopened.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
    const stateResult = reopened.exec('SELECT fingerprint, engine_version FROM face_index_state');
    reopened.close();

    expect(versionResult[0]?.values[0]?.[0]).toBe(7);
    expect(stateResult[0]?.values).toEqual([['fp-abc', 1]]);
  });

  it('migrates an existing v2 database to v5 and persists drive run bookkeeping immediately', async () => {
    const home = await tempHome();
    await writeV2Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const started = await store.startDriveRun({
      runId: 'run-1',
      root: '/drive',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      foldersTotal: 2,
      foldersDone: 0,
      filesDone: 0,
      filesSkipped: 0,
      filesFailed: 0,
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    });
    expect(started.ok).toBe(true);
    const updated = await store.updateDriveRun({
      runId: 'run-1',
      root: '/drive',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:10:00.000Z',
      foldersTotal: 2,
      foldersDone: 2,
      filesDone: 3,
      filesSkipped: 1,
      filesFailed: 1,
      lastActivityAt: '2026-01-01T00:10:00.000Z',
    });
    expect(updated.ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const latest = await reopened.latestDriveRun();
    expect(latest.ok && latest.value).toMatchObject({
      runId: 'run-1',
      foldersDone: 2,
      filesDone: 3,
      filesSkipped: 1,
      filesFailed: 1,
    });
  });

  it('migrates an existing v3 database to v5 with a persisted FTS backfill', async () => {
    const home = await tempHome();
    await writeV3Catalog(home);

    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const search = await store.search({ match: 'coast*', rankingTerms: ['coast'], limit: 10, offset: 0 });
    expect(search.ok && search.value[0]?.fingerprint).toBe('fp-v3');

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const persisted = await reopened.search({ match: 'coast*', rankingTerms: ['coast'], limit: 10, offset: 0 });
    expect(persisted.ok && persisted.value[0]?.fileName).toBe('coast.mp4');
  });

  it('keeps FTS current across alias remap and explicit rebuild', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'traffic.mp4',
      description: 'Cars passing',
      transcript: '',
      language: null,
      tags: ['automobile'],
    });

    const aliased = await store.aliasTag({ from: 'automobile', to: 'car' });
    const byAlias = await store.search({ match: 'car*', rankingTerms: ['car'], limit: 10, offset: 0 });
    const rebuilt = await store.rebuildSearchIndex();
    const afterRebuild = await store.search({ match: 'car*', rankingTerms: ['car'], limit: 10, offset: 0 });

    expect(aliased.ok && aliased.value.remappedFiles).toBe(1);
    expect(byAlias.ok && byAlias.value[0]?.tags).toEqual(['car']);
    expect(rebuilt.ok && rebuilt.value.indexed).toBe(1);
    expect(afterRebuild.ok && afterRebuild.value[0]?.fingerprint).toBe(file.fingerprint);
  });

  it('drops stale terms from the FTS index when a document is re-analyzed', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: 'sunrise over the mountains',
      transcript: 'zeppelin narration',
      language: null,
      tags: ['dawn'],
    });
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: 'twilight over the valley',
      transcript: 'kayak narration',
      language: null,
      tags: ['dusk'],
    });

    const stale = await store.search({ match: 'sunrise*', rankingTerms: ['sunrise'], limit: 10, offset: 0 });
    const staleTag = await store.search({ match: 'dawn*', rankingTerms: ['dawn'], limit: 10, offset: 0 });
    const staleTranscript = await store.search({ match: 'zeppelin*', rankingTerms: ['zeppelin'], limit: 10, offset: 0 });
    const current = await store.search({ match: 'twilight*', rankingTerms: ['twilight'], limit: 10, offset: 0 });

    expect(stale.ok && stale.value).toEqual([]);
    expect(staleTag.ok && staleTag.value).toEqual([]);
    expect(staleTranscript.ok && staleTranscript.value).toEqual([]);
    expect(current.ok && current.value[0]?.fingerprint).toBe(file.fingerprint);
  });
});

const lockPath = (home: string): string => path.join(home, '.ai-video-cataloger', 'catalog.lock');

const writeLock = async (
  home: string,
  lock: {
    pid: number;
    processName: 'gui' | 'cli';
    startedAt: string;
    hostname: string;
  },
): Promise<void> => {
  await mkdir(path.dirname(lockPath(home)), { recursive: true });
  await writeFile(lockPath(home), `${JSON.stringify(lock)}\n`, 'utf8');
};

const writeV1Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  client.run('INSERT INTO schema_meta(version) VALUES (1)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV2Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  client.run('ALTER TABLE files ADD COLUMN gps_lat REAL');
  client.run('ALTER TABLE files ADD COLUMN gps_lon REAL');
  client.run(`CREATE TABLE tags (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`);
  client.run(`CREATE TABLE file_tags (
      fingerprint TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, tag_id)
    )`);
  client.run(`CREATE TABLE tag_aliases (
      alias TEXT PRIMARY KEY,
      tag_id INTEGER NOT NULL
    )`);
  client.run('INSERT INTO schema_meta(version) VALUES (2)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV3Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV2) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV3) client.run(statement);
  client.run('INSERT INTO folders(folder_id, current_path, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
    folder.folderId,
    folder.currentPath,
    folder.displayName,
    folder.firstSeenAt,
    folder.lastSeenAt,
  ]);
  client.run('INSERT INTO files(fingerprint, folder_id, file_name, size, duration_s, processed_at, analyzer, model, gps_lat, gps_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    'fp-v3',
    folder.folderId,
    'coast.mp4',
    2048,
    null,
    '2026-02-01T00:00:00.000Z',
    null,
    null,
    null,
    null,
  ]);
  client.run('INSERT INTO analyses(fingerprint, final_name, description, transcript, language) VALUES (?, ?, ?, ?, ?)', [
    'fp-v3',
    'coast-final.mp4',
    'A coastal cliff',
    'ocean words',
    null,
  ]);
  client.run('INSERT INTO tags(name) VALUES (?)', ['coast']);
  client.run('INSERT INTO file_tags(fingerprint, tag_id) VALUES (?, ?)', ['fp-v3', 1]);
  client.run('INSERT INTO schema_meta(version) VALUES (3)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV5Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV2) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV3) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV4) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV5) client.run(statement);
  client.run('INSERT INTO folders(folder_id, current_path, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
    folder.folderId,
    folder.currentPath,
    folder.displayName,
    folder.firstSeenAt,
    folder.lastSeenAt,
  ]);
  client.run('INSERT INTO files(fingerprint, folder_id, file_name, size, duration_s, processed_at, analyzer, model, gps_lat, gps_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    file.fingerprint,
    folder.folderId,
    file.fileName,
    file.size,
    null,
    file.processedAt,
    null,
    null,
    null,
    null,
  ]);
  client.run('INSERT INTO face_observations(obs_id, fingerprint, kind, frame_ts_s, bbox_json, quality, person_id, crop_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    `${file.fingerprint}:face:1:1`,
    file.fingerprint,
    'face',
    1,
    '{"x":0,"y":0,"width":50,"height":50}',
    0.9,
    null,
    null,
  ]);
  client.run('INSERT INTO schema_meta(version) VALUES (5)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};

const writeV6Catalog = async (home: string): Promise<void> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV2) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV3) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV4) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV5) client.run(statement);
  for (const statement of migrateGlobalCatalogSchemaSqlV6) client.run(statement);
  client.run('INSERT INTO folders(folder_id, current_path, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
    folder.folderId,
    folder.currentPath,
    folder.displayName,
    folder.firstSeenAt,
    folder.lastSeenAt,
  ]);
  client.run('INSERT INTO files(fingerprint, folder_id, file_name, size, duration_s, processed_at, analyzer, model, gps_lat, gps_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    file.fingerprint,
    folder.folderId,
    file.fileName,
    file.size,
    null,
    file.processedAt,
    null,
    null,
    null,
    null,
  ]);
  client.run('INSERT INTO schema_meta(version) VALUES (6)');
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
};
