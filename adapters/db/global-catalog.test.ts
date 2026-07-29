import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  configDescriptorSchema,
  configId,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type FaceObservation,
  type Person,
} from '@core/domain/index.js';

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
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
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

  it('stores variants independently and resolves explicit, folder-default, and newest selection', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    const firstDescriptor = configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'skip',
      frames: 3,
      output_language: 'en',
      promptVersion: 1,
    });
    const secondDescriptor = configDescriptorSchema.parse({
      ...firstDescriptor,
      output_language: 'pl',
      promptVersion: 2,
    });
    const first: CatalogVariant = {
      fingerprint: file.fingerprint,
      configId: configId(firstDescriptor),
      descriptor: firstDescriptor,
      finalName: 'alpha.mp4',
      description: 'alphaonly description',
      transcript: 'shared words',
      language: 'en',
      tags: ['alpha-tag'],
      analyzer: 'local',
      model: 'gemma3:12b',
      createdAt: '2026-01-03T00:00:00.000Z',
      usage: null,
    };
    const second: CatalogVariant = {
      ...first,
      configId: configId(secondDescriptor),
      descriptor: secondDescriptor,
      finalName: 'beta.mp4',
      description: 'betaonly description',
      language: 'pl',
      tags: ['beta-tag'],
      createdAt: '2026-01-04T00:00:00.000Z',
      usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.01 },
    };

    expect((await store.upsertVariant(first)).ok).toBe(true);
    expect((await store.upsertVariant(second)).ok).toBe(true);
    const newest = await store.getAnalysis(file.fingerprint);
    expect(newest.ok && newest.value?.description).toBe(second.description);

    expect((await store.setSelectedVariant(file.fingerprint, first.configId)).ok).toBe(true);
    const explicit = await store.getAnalysis(file.fingerprint);
    expect(explicit.ok && explicit.value?.description).toBe(first.description);
    expect(explicit.ok && explicit.value?.tags).toEqual(['alpha-tag']);
    const oldSearch = await store.search({ match: 'betaonly*', rankingTerms: ['betaonly'], limit: 10, offset: 0 });
    expect(oldSearch.ok && oldSearch.value).toEqual([]);
    const selectedSearch = await store.search({ match: 'alphaonly*', rankingTerms: ['alphaonly'], limit: 10, offset: 0 });
    expect(selectedSearch.ok && selectedSearch.value[0]).toMatchObject({
      description: first.description,
      variantCount: 2,
    });

    expect((await store.setSelectedVariant(file.fingerprint, null)).ok).toBe(true);
    expect((await store.setFolderDefaultVariant(folder.folderId, first.configId)).ok).toBe(true);
    const folderSelected = await store.getAnalysis(file.fingerprint);
    expect(folderSelected.ok && folderSelected.value?.finalName).toBe(first.finalName);
    expect((await store.setSelectedVariant(file.fingerprint, 'cfg_000000000000')).ok).toBe(true);
    const danglingFallsToFolder = await store.getAnalysis(file.fingerprint);
    expect(danglingFallsToFolder.ok && danglingFallsToFolder.value?.description).toBe(first.description);
    expect((await store.setFolderDefaultVariant(folder.folderId, 'cfg_111111111111')).ok).toBe(true);
    const danglingFallsToNewest = await store.getAnalysis(file.fingerprint);
    expect(danglingFallsToNewest.ok && danglingFallsToNewest.value?.description).toBe(second.description);
    expect((await store.upsertVariant({ ...first, createdAt: second.createdAt })).ok).toBe(true);
    const tiedFallback = await store.getAnalysis(file.fingerprint);
    const tiedWinner = first.configId.localeCompare(second.configId) < 0 ? first : second;
    expect(tiedFallback.ok && tiedFallback.value?.description).toBe(tiedWinner.description);
    expect((await store.upsertVariant(first)).ok).toBe(true);
    expect((await store.setSelectedVariant(file.fingerprint, null)).ok).toBe(true);
    expect((await store.setFolderDefaultVariant(folder.folderId, first.configId)).ok).toBe(true);

    const variants = await store.listVariants(file.fingerprint);
    expect(variants.ok && variants.value.map((variant) => variant.configId)).toEqual([
      second.configId,
      first.configId,
    ]);
    const storedSecond = await store.getVariant(file.fingerprint, second.configId);
    expect(storedSecond.ok && storedSecond.value).toEqual(second);

    expect((await store.deleteVariant(file.fingerprint, first.configId)).ok).toBe(true);
    const survivor = await store.getAnalysis(file.fingerprint);
    expect(survivor.ok && survivor.value?.description).toBe(second.description);
    expect(survivor.ok && survivor.value?.tags).toEqual(['beta-tag']);
    const promotedSearch = await store.search({ match: 'betaonly*', rankingTerms: ['betaonly'], limit: 10, offset: 0 });
    expect(promotedSearch.ok && promotedSearch.value[0]).toMatchObject({
      description: second.description,
      variantCount: 1,
    });
    expect((await store.rebuildSearchIndex()).ok).toBe(true);
    const rebuiltSearch = await store.search({ match: 'betaonly*', rankingTerms: ['betaonly'], limit: 10, offset: 0 });
    expect(rebuiltSearch.ok && rebuiltSearch.value[0]?.description).toBe(second.description);
    expect(await store.deleteVariant(file.fingerprint, second.configId))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect((await store.clearAnalysisVariants(file.fingerprint)).ok).toBe(true);
    expect(await store.listVariants(file.fingerprint)).toEqual({ ok: true, value: [] });
    expect(await store.getAnalysis(file.fingerprint)).toEqual({ ok: true, value: null });
    expect(await store.getSelectedConfigId(file.fingerprint)).toEqual({ ok: true, value: null });
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
      hostname: hostname(),
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

  it('treats a corrupt (0-byte) lock file as stale and takes it over', async () => {
    const home = await tempHome();
    await mkdir(path.dirname(lockPath(home)), { recursive: true });
    await writeFile(lockPath(home), '', 'utf8');
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => true,
    });

    expect((await store.upsertFolder(folder)).ok).toBe(true);
    const status = await store.lockStatus();

    expect(status.ok && status.value.owner?.processName).toBe('cli');
    await store.dispose();
  });

  it('does not crash the eager constructor on a corrupt lock file', async () => {
    const home = await tempHome();
    await mkdir(path.dirname(lockPath(home)), { recursive: true });
    await writeFile(lockPath(home), '{ not json', 'utf8');

    expect(() => new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'gui',
      lockMode: 'eager',
      isProcessAlive: () => true,
    })).not.toThrow();
  });

  it('never auto-takes over a lock held by a foreign hostname', async () => {
    const home = await tempHome();
    await writeLock(home, {
      pid: 987654,
      processName: 'gui',
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: `${hostname()}-other-machine`,
    });
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => false,
    });

    const blocked = await store.upsertFolder(folder);
    const status = await store.lockStatus();

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('catalog_locked');
    expect(status.ok && status.value.writable).toBe(false);
    expect(status.ok && status.value.blockedBy?.hostname).toBe(`${hostname()}-other-machine`);
  });

  it('reports a lazy store with no lock file as writable', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
    });

    const status = await store.lockStatus();

    expect(status.ok && status.value.writable).toBe(true);
    expect(status.ok && status.value.owner).toBeNull();
    expect(status.ok && status.value.blockedBy).toBeNull();
  });

  it('does not persist a fresh database on a read while a foreign process holds the lock', async () => {
    const home = await tempHome();
    await writeLock(home, {
      pid: 123456,
      processName: 'gui',
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: hostname(),
    });
    const reader = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => true,
    });

    expect((await reader.counts()).ok).toBe(true);

    const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
    await expect(readFile(databasePath)).rejects.toThrow();
  });

  it('does not double-hold when a competing writer wins the re-read after create', async () => {
    const home = await tempHome();
    const foreign = {
      pid: 999999,
      processName: 'gui' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      hostname: hostname(),
    };
    let created = false;
    const store = new SqlJsGlobalCatalogStore({
      homeDirectory: home,
      processName: 'cli',
      isProcessAlive: () => true,
      lockFs: {
        mkdirSync: () => undefined,
        openSync: () => {
          if (created) {
            const error: NodeJS.ErrnoException = new Error('exists');
            error.code = 'EEXIST';
            throw error;
          }
          created = true;
          return 1;
        },
        writeFileSync: () => undefined,
        fsyncSync: () => undefined,
        closeSync: () => undefined,
        readFileSync: () => `${JSON.stringify(foreign)}\n`,
        unlinkSync: () => undefined,
      },
    });

    const blocked = await store.upsertFolder(folder);

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('catalog_locked');
  });

  it('recomputes person exemplar counts and prunes empty persons when a file loses its faces', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertFile({ ...file, fingerprint: 'fp-second', fileName: 'second.mp4' });
    await store.upsertPerson(personFor('person-shared', 2));
    await store.upsertPerson(personFor('person-solo', 1));
    await store.upsertFaceObservation(observationFor('obs-1', file.fingerprint, 'person-shared'));
    await store.upsertFaceObservation(observationFor('obs-2', 'fp-second', 'person-shared'));
    await store.upsertFaceObservation(observationFor('obs-3', file.fingerprint, 'person-solo'));

    const deleted = await store.deleteFaceObservationsForFile(file.fingerprint);
    expect(deleted.ok).toBe(true);

    const survivor = await store.getPerson('person-shared');
    const pruned = await store.getPerson('person-solo');
    expect(survivor.ok && survivor.value?.exemplarCount).toBe(1);
    expect(pruned.ok && pruned.value).toBeNull();
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

  it('keeps the lock file while a lease is active and persists one-off mutations', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home, processName: 'gui' });
    expect((await store.acquireLease()).ok).toBe(true);
    expect((await store.upsertFolder(folder)).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);
    expect(existsSync(lockPath(home))).toBe(true);

    expect((await store.upsertFile(file)).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);
    expect(existsSync(lockPath(home))).toBe(true);

    expect((await store.releaseLease()).ok).toBe(true);
    expect(existsSync(lockPath(home))).toBe(false);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const counts = await reopened.counts();
    expect(counts.ok && counts.value).toEqual({ folders: 1, files: 1, analyses: 0 });
    await reopened.dispose();
  });

  it('releases the lock only after the final nested lease is released', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home, processName: 'gui' });
    expect((await store.acquireLease()).ok).toBe(true);
    expect((await store.acquireLease()).ok).toBe(true);
    expect((await store.upsertFolder(folder)).ok).toBe(true);

    expect((await store.releaseLease()).ok).toBe(true);
    expect(existsSync(lockPath(home))).toBe(true);

    expect((await store.releaseLease()).ok).toBe(true);
    expect(existsSync(lockPath(home))).toBe(false);
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

  it('P1: a re-probe that finds no GPS no longer erases a stored coordinate', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({ ...file, gpsLat: 10, gpsLon: 20, gpsSource: 'camera' });
    await store.upsertFile({ ...file, gpsLat: null, gpsLon: null, gpsSource: null });

    const stored = await store.getFile(file.fingerprint);
    expect(stored.ok && stored.value?.gpsLat).toBe(10);
    expect(stored.ok && stored.value?.gpsLon).toBe(20);
    expect(stored.ok && stored.value?.gpsSource).toBe('camera');
  });

  it('P2: a timeline write never overwrites camera GPS, but camera always wins over timeline', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);

    await store.upsertFile({ ...file, gpsLat: 1, gpsLon: 1, gpsSource: 'camera' });
    await store.upsertFile({ ...file, gpsLat: 2, gpsLon: 2, gpsSource: 'timeline' });
    const afterTimelineAttempt = await store.getFile(file.fingerprint);
    expect(afterTimelineAttempt.ok && afterTimelineAttempt.value?.gpsLat).toBe(1);
    expect(afterTimelineAttempt.ok && afterTimelineAttempt.value?.gpsSource).toBe('camera');

    const reversedFingerprint = { ...file, fingerprint: 'fp-reversed' };
    await store.upsertFile({ ...reversedFingerprint, gpsLat: 3, gpsLon: 3, gpsSource: 'timeline' });
    await store.upsertFile({ ...reversedFingerprint, gpsLat: 4, gpsLon: 4, gpsSource: 'camera' });
    const afterCameraOverwrite = await store.getFile(reversedFingerprint.fingerprint);
    expect(afterCameraOverwrite.ok && afterCameraOverwrite.value?.gpsLat).toBe(4);
    expect(afterCameraOverwrite.ok && afterCameraOverwrite.value?.gpsSource).toBe('camera');
  });

  it('P5: a place name reaches the search index through the new place column', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({
      ...file,
      place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 120, dataset: 'test-dataset' },
    });

    const search = await store.search({ match: 'fjordvik*', rankingTerms: ['fjordvik'], limit: 10, offset: 0 });
    expect(search.ok && search.value.map((row) => row.fingerprint)).toEqual([file.fingerprint]);
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

  it('replaceFaceClustering rebuilds people and reassigns observations in one write', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertPerson({
      personId: 'person-old',
      displayName: 'Old',
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
      personId: 'person-old',
      cropPath: '/home/.ai-video-cataloger/faces/person-old/exemplar-001.jpg',
    });
    await store.completeFaceIndex(file.fingerprint, 2);

    const replaced = await store.replaceFaceClustering({
      people: [{
        personId: 'person-new',
        displayName: null,
        kind: 'face',
        createdAt: '2026-02-01T00:00:00.000Z',
        centroid: Array.from({ length: 128 }, () => 0.2),
        exemplarCount: 1,
      }],
      assignments: [{ obsId: 'obs-1', personId: 'person-new' }],
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) throw new Error('expected ok');
    expect(replaced.value.personsDeleted).toBe(1);
    expect(replaced.value.personsCreated).toBe(1);
    expect(replaced.value.observationsReassigned).toBe(1);
    expect((await store.flush()).ok).toBe(true);

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const people = await reopened.listPeople();
    expect(people.ok && people.value.map((person) => person.personId)).toEqual(['person-new']);
    const observations = await reopened.listFaceObservations();
    expect(observations.ok && observations.value[0]?.personId).toBe('person-new');
    expect(observations.ok && observations.value[0]?.cropPath).toBe('/home/.ai-video-cataloger/faces/person-old/exemplar-001.jpg');
    const status = await reopened.faceStatus();
    expect(status.ok && status.value.staleVersionFiles).toBe(0);
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

  it('relocateFile moves a row to another folder and keeps the search document in sync', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const folderB: CatalogFolder = {
      ...folder,
      folderId: '33333333-3333-4333-8333-333333333333',
      currentPath: '/media/drive-b',
      displayName: 'drive-b',
    };
    await store.upsertFolder(folder);
    await store.upsertFolder(folderB);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: [],
    });

    const relocated = await store.relocateFile(file.fingerprint, folderB.folderId, 'renamed.mp4');
    expect(relocated.ok).toBe(true);

    const moved = await store.getFile(file.fingerprint);
    expect(moved.ok && moved.value?.folderId).toBe(folderB.folderId);
    expect(moved.ok && moved.value?.fileName).toBe('renamed.mp4');

    const results = await store.search({ match: 'renamed*', rankingTerms: ['renamed'], limit: 10, offset: 0 });
    expect(results.ok && results.value[0]?.fingerprint).toBe(file.fingerprint);
    expect(results.ok && results.value[0]?.folder.currentPath).toBe('/media/drive-b');
  });

  it('forgetEntry recomputes affected person centroids and removes people with no remaining observations', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const other: CatalogFile = { ...file, fingerprint: 'fp-two', fileName: 'two.mp4' };
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertFile(other);
    await store.upsertPerson({
      personId: 'person-shared',
      displayName: 'Ada',
      kind: 'face',
      createdAt: '2026-01-04T00:00:00.000Z',
      centroid: Array.from({ length: 128 }, () => 0.1),
      exemplarCount: 2,
    });
    await store.upsertPerson({
      personId: 'person-only',
      displayName: 'Bo',
      kind: 'face',
      createdAt: '2026-01-04T00:00:00.000Z',
      centroid: Array.from({ length: 128 }, () => 0.1),
      exemplarCount: 1,
    });
    await store.upsertFaceObservation({
      obsId: 'obs-shared-a',
      fingerprint: file.fingerprint,
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.2),
      quality: 0.9,
      personId: 'person-shared',
      cropPath: null,
    });
    await store.upsertFaceObservation({
      obsId: 'obs-shared-b',
      fingerprint: other.fingerprint,
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.5),
      quality: 0.9,
      personId: 'person-shared',
      cropPath: null,
    });
    await store.upsertFaceObservation({
      obsId: 'obs-only',
      fingerprint: file.fingerprint,
      kind: 'face',
      frameTsS: 2,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      embedding: Array.from({ length: 128 }, () => 0.3),
      quality: 0.9,
      personId: 'person-only',
      cropPath: null,
    });

    const forgotten = await store.forgetEntry(file.fingerprint);
    expect(forgotten.ok && forgotten.value.deleted).toBe(true);

    const shared = await store.getPerson('person-shared');
    expect(shared.ok && shared.value?.exemplarCount).toBe(1);
    expect(shared.ok && shared.value?.centroid[0]).toBeCloseTo(1 / Math.sqrt(128), 6);
    const removed = await store.getPerson('person-only');
    expect(removed.ok && removed.value).toBe(null);
  });

  it('deleteFaceObservationsForFile returns the crop paths of the removed observations', async () => {
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

    const removed = await store.deleteFaceObservationsForFile(file.fingerprint);
    expect(removed.ok && removed.value.cropPaths).toEqual(['/home/faces/person-1/exemplar-001.jpg']);
    const observations = await store.listFaceObservations({ fingerprint: file.fingerprint });
    expect(observations.ok && observations.value.length).toBe(0);
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

  it('listLocations returns only the file that carries GPS, keyed to its folder', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const secondFolder: CatalogFolder = {
      ...folder,
      folderId: '33333333-3333-4333-8333-333333333333',
      currentPath: '/media/drive-b',
      displayName: 'drive-b',
    };
    await store.upsertFolder(folder);
    await store.upsertFolder(secondFolder);
    await store.upsertFile({ ...file, gpsLat: 50.0614, gpsLon: 19.9366 });
    await store.upsertFile({ ...file, fingerprint: 'fp-no-gps', folderId: secondFolder.folderId, fileName: 'other.mp4' });
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    });

    const result = await store.listLocations();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalFiles).toBe(2);
    expect(result.value.rows).toEqual([{
      fingerprint: file.fingerprint,
      fileName: file.fileName,
      finalName: 'a-clip.mp4',
      lat: 50.0614,
      lon: 19.9366,
      missing: false,
      folder,
      source: 'camera',
      accuracyM: null,
      intervalKind: null,
      place: null,
    }]);
  });

  it('listLocations carries provenance and place through to the row', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({
      ...file,
      gpsLat: 10.5,
      gpsLon: 20.5,
      gpsSource: 'timeline',
      gpsAccuracyM: 150,
      gpsIntervalKind: 'visit',
      gpsResolvedAt: '2026-08-01T00:00:00.000Z',
      place: { name: 'Fjordvik', region: 'Nordland', country: 'Norway', countryCode: 'NO', distanceM: 12, dataset: 'test-dataset' },
    });

    const result = await store.listLocations();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]?.source).toBe('timeline');
    expect(result.value.rows[0]?.accuracyM).toBe(150);
    expect(result.value.rows[0]?.intervalKind).toBe('visit');
    expect(result.value.rows[0]?.place).toEqual({
      name: 'Fjordvik', region: 'Nordland', country: 'Norway', countryCode: 'NO', distanceM: 12, dataset: 'test-dataset',
    });
  });

  it('listLocations resolves the selected variant instead of duplicating a row per variant', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({ ...file, gpsLat: 50.0614, gpsLon: 19.9366 });
    const firstDescriptor = configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'skip',
      frames: 3,
      output_language: 'en',
      promptVersion: 1,
    });
    const secondDescriptor = configDescriptorSchema.parse({
      ...firstDescriptor,
      output_language: 'pl',
      promptVersion: 2,
    });
    const first: CatalogVariant = {
      fingerprint: file.fingerprint,
      configId: configId(firstDescriptor),
      descriptor: firstDescriptor,
      finalName: 'alpha.mp4',
      description: 'alpha description',
      transcript: 'shared words',
      language: 'en',
      tags: ['alpha-tag'],
      analyzer: 'local',
      model: 'gemma3:12b',
      createdAt: '2026-01-03T00:00:00.000Z',
      usage: null,
    };
    const second: CatalogVariant = {
      ...first,
      configId: configId(secondDescriptor),
      descriptor: secondDescriptor,
      finalName: 'beta.mp4',
      description: 'beta description',
      language: 'pl',
      tags: ['beta-tag'],
      createdAt: '2026-01-04T00:00:00.000Z',
      usage: null,
    };
    expect((await store.upsertVariant(first)).ok).toBe(true);
    expect((await store.upsertVariant(second)).ok).toBe(true);
    expect((await store.setSelectedVariant(file.fingerprint, first.configId)).ok).toBe(true);

    const result = await store.listLocations();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalFiles).toBe(1);
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.rows[0]?.finalName).toBe('alpha.mp4');
  });

  it('listGeoBackfillCandidates returns non-missing files scoped to a root and excludes nothing by kind', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({ ...file, capturedAt: '2026-01-01T10:00:00.000Z' });
    await store.upsertFile({ ...file, fingerprint: 'fp-missing', missingAt: 1_700_000_000 });

    const scoped = await store.listGeoBackfillCandidates({ root: folder.currentPath });
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) return;
    expect(scoped.value.map((row) => row.fingerprint)).toEqual([file.fingerprint]);
    expect(scoped.value[0]?.capturedAt).toBe('2026-01-01T10:00:00.000Z');

    const unscoped = await store.listGeoBackfillCandidates({ root: null });
    expect(unscoped.ok && unscoped.value.length).toBe(1);

    const otherRoot = await store.listGeoBackfillCandidates({ root: '/media/nowhere' });
    expect(otherRoot.ok && otherRoot.value.length).toBe(0);
  });

  it('applyGeoBackfill respects precedence, is idempotent, and refreshes the search document with the place', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({ ...file, gpsLat: 1, gpsLon: 1, gpsSource: 'camera' });

    const cameraAttempt = await store.applyGeoBackfill({
      fingerprint: file.fingerprint,
      location: { lat: 2, lon: 2, source: 'timeline', accuracyM: 150, intervalKind: 'visit', resolvedAt: '2026-01-01T00:00:00.000Z' },
    });
    expect(cameraAttempt.ok && cameraAttempt.value).toBe('skipped_precedence');
    const untouched = await store.getFile(file.fingerprint);
    expect(untouched.ok && untouched.value?.gpsLat).toBe(1);

    await store.upsertFile({ ...file, fingerprint: 'fp-empty', gpsLat: null, gpsLon: null });
    const location = { lat: 60.1, lon: 24.9, source: 'timeline' as const, accuracyM: 150, intervalKind: 'visit' as const, resolvedAt: '2026-01-01T00:00:00.000Z' };
    const first = await store.applyGeoBackfill({
      fingerprint: 'fp-empty',
      location,
      place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 30, dataset: 'test-dataset' },
    });
    expect(first.ok && first.value).toBe('written');

    const second = await store.applyGeoBackfill({ fingerprint: 'fp-empty', location, place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 30, dataset: 'test-dataset' } });
    expect(second.ok && second.value).toBe('unchanged');

    const found = await store.search({ match: 'fjordvik*', rankingTerms: ['fjordvik'], limit: 10, offset: 0 });
    expect(found.ok && found.value[0]?.fingerprint).toBe('fp-empty');
  });

  it('listLocations skips a row whose stored latitude is out of range', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile({ ...file, gpsLat: 50, gpsLon: 19 });
    await store.flush();

    const dbPath = path.join(home, '.ai-video-cataloger', 'catalog.db');
    const SQL = await initSqlJs();
    const bytes = await readFile(dbPath);
    const rawClient: Database = new SQL.Database(bytes);
    rawClient.run('UPDATE files SET gps_lat = 91 WHERE fingerprint = $fingerprint', { $fingerprint: file.fingerprint });
    await writeFile(dbPath, Buffer.from(rawClient.export()));
    rawClient.close();

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const result = await reopened.listLocations();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([]);
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

  it('migrates an existing v6 database to the current version and persists a reconciled missing_at value', async () => {
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
    const driveRunColumnResult = reopened.exec('PRAGMA table_info(drive_runs)');
    const missingResult = reopened.exec('SELECT missing_at FROM files WHERE fingerprint = ?', [file.fingerprint]);
    reopened.close();

    expect(versionResult[0]?.values[0]?.[0]).toBe(GLOBAL_CATALOG_SCHEMA_VERSION);
    const columnNames = columnResult[0]?.values.map((row) => row[1]) ?? [];
    expect(columnNames).toContain('missing_at');
    expect(driveRunColumnResult[0]?.values.map((row) => row[1]) ?? []).toContain('batch_json');
    expect(missingResult[0]?.values[0]?.[0]).toBe(7000);
  });

  it('migrates the captured v8 fixture to v10 without changing analysis or tags, and rebuilds search with the new place column', async () => {
    const home = await tempHome();
    const before = await writeV8CatalogFixture(home);
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });

    const analysis = await store.getAnalysis('fixture-v8-analysis');
    const variant = await store.getVariant('fixture-v8-analysis', 'legacy');
    const search = await store.search({ match: 'skyline*', rankingTerms: ['skyline'], limit: 10, offset: 0 });

    expect(analysis.ok && analysis.value).toEqual({
      fingerprint: 'fixture-v8-analysis',
      finalName: '2026-01-02-night-sky.mp4',
      description: 'A blue-hour skyline — preserved byte for byte.',
      transcript: 'First line.\\nSecond line with “quotes”.',
      language: 'en',
      tags: ['night-sky', 'warsaw'],
    });
    expect(variant.ok && variant.value).toMatchObject({
      configId: 'legacy',
      descriptor: null,
      analyzer: 'harness:claude-code',
      model: 'claude-sonnet-4',
      createdAt: '2026-01-02T03:04:05.678Z',
      usage: null,
    });
    expect(search.ok && search.value.map((row) => row.fingerprint)).toEqual(['fixture-v8-analysis']);

    const SQL = await initSqlJs();
    const migrated = new SQL.Database(await readFile(store.databasePath()));
    const after = catalogContentsSnapshot(migrated);
    const version = migrated.exec('SELECT version FROM schema_meta')[0]?.values[0]?.[0];
    const analysisColumns = migrated.exec('PRAGMA table_info(analyses)')[0]?.values ?? [];
    const fileSelections = migrated.exec(
      'SELECT fingerprint, selected_config_id FROM files ORDER BY fingerprint',
    )[0]?.values;
    const folderDefaults = migrated.exec('SELECT default_config_id FROM folders')[0]?.values;
    const legacyConfig = migrated.exec(
      'SELECT config_id, descriptor_json, label FROM analysis_configs',
    )[0]?.values;
    const migratedVariant = migrated.exec(
      `SELECT config_id, config_json, analyzer, model, created_at, usage_json
        FROM analyses WHERE fingerprint = 'fixture-v8-analysis'`,
    )[0]?.values;
    const migratedTags = migrated.exec(
      'SELECT fingerprint, config_id, tag_id FROM file_tags ORDER BY tag_id',
    )[0]?.values;
    migrated.close();

    expect(after.analysis).toEqual(before.analysis);
    expect(after.tags).toEqual(before.tags);
    expect(JSON.parse(after.searchHits)).toEqual([[
      'fixture-v8-analysis',
      'source clip.mp4',
      '2026-01-02-night-sky.mp4',
      'A blue-hour skyline — preserved byte for byte.',
      'First line.\\nSecond line with “quotes”.',
      'night-sky\nwarsaw',
    ]]);
    expect(JSON.parse(after.searchColumns).map((column: unknown[]) => column[1])).toEqual([
      'docid', 'fingerprint', 'file_name', 'final_name', 'description', 'transcript', 'tags_text', 'place',
    ]);
    expect(after.searchFtsSql).toContain('place');
    expect(version).toBe(10);
    expect(analysisColumns.filter((column) => column[5] !== 0).map((column) => [column[1], column[5]])).toEqual([
      ['fingerprint', 1],
      ['config_id', 2],
    ]);
    expect(fileSelections).toEqual([
      ['fixture-v8-analysis', 'legacy'],
      ['fixture-v8-unprocessed', null],
    ]);
    expect(folderDefaults).toEqual([[null]]);
    expect(legacyConfig).toEqual([['legacy', null, 'settings partly unknown']]);
    expect(migratedVariant).toEqual([[
      'legacy',
      null,
      'harness:claude-code',
      'claude-sonnet-4',
      '2026-01-02T03:04:05.678Z',
      null,
    ]]);
    expect(migratedTags).toEqual([
      ['fixture-v8-analysis', 'legacy', 1],
      ['fixture-v8-analysis', 'legacy', 2],
    ]);
  });

  it('fails closed when the catalog schema is newer than the binary', async () => {
    const home = await tempHome();
    await writeV8CatalogFixture(home, GLOBAL_CATALOG_SCHEMA_VERSION + 1);
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });

    const result = await store.counts();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('snapshot_incompatible');
      expect(result.error.message).toContain('newer than the supported version');
    }
  });

  it('returns a typed error instead of throwing when a stored variant descriptor is corrupted', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    const descriptor = configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'skip',
      frames: 3,
      output_language: 'en',
      promptVersion: 1,
    });
    const variant: CatalogVariant = {
      fingerprint: file.fingerprint,
      configId: configId(descriptor),
      descriptor,
      finalName: 'alpha.mp4',
      description: 'alpha description',
      transcript: 'shared words',
      language: 'en',
      tags: ['alpha-tag'],
      analyzer: 'local',
      model: 'gemma3:12b',
      createdAt: '2026-01-03T00:00:00.000Z',
      usage: null,
    };
    expect((await store.upsertVariant(variant)).ok).toBe(true);
    expect((await store.flush()).ok).toBe(true);

    const SQL = await initSqlJs();
    const raw = new SQL.Database(await readFile(store.databasePath()));
    raw.run('UPDATE analyses SET config_json = ? WHERE fingerprint = ?', ['{not-json', file.fingerprint]);
    await writeFile(store.databasePath(), raw.export());
    raw.close();

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const result = await reopened.getVariant(file.fingerprint, variant.configId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('read_error');
    }
  });

  it('migrates an existing v1 database to the current version and persists the migrated schema immediately', async () => {
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

    expect(versionResult[0]?.values[0]?.[0]).toBe(GLOBAL_CATALOG_SCHEMA_VERSION);
    const columnNames = columnResult[0]?.values.map((row) => row[1]).filter((value) => typeof value === 'string') ?? [];
    expect(columnNames).toContain('gps_lat');
    expect(columnNames).toContain('gps_lon');
    expect(columnNames).toContain('missing_at');
    expect(facesTablesResult[0]?.values.map((row) => row[0])).toEqual(['face_index_state', 'face_observations', 'people']);
  });

  it('migrates an existing v5 database to the current version and backfills stale face index state', async () => {
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

    expect(versionResult[0]?.values[0]?.[0]).toBe(GLOBAL_CATALOG_SCHEMA_VERSION);
    expect(stateResult[0]?.values).toEqual([['fp-abc', 1]]);
  });

  it('migrates an existing v2 database to the current version and persists drive run bookkeeping, batch state included', async () => {
    const home = await tempHome();
    await writeV2Catalog(home);
    const descriptor = configDescriptorSchema.parse({
      family: 'gemini-native',
      providerId: 'gemini',
      model: 'gemini-3.6-flash',
      output_language: 'auto',
      promptVersion: 1,
    });

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
      batch: null,
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
      batch: {
        displayName: 'avc-drive-run-1',
        jobName: 'batches/9',
        state: 'submitted',
        model: 'gemini-3.6-flash',
        configIdentity: { descriptor, configId: configId(descriptor) },
        requests: [{ key: '/drive/a.mp4', videoPath: '/drive/a.mp4', fileName: 'files/a', fileUri: 'https://files/a' }],
      },
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
      batch: {
        jobName: 'batches/9',
        state: 'submitted',
        configIdentity: {
          configId: configId(descriptor),
          descriptor: { output_language: 'auto', promptVersion: 1 },
        },
        requests: [{ key: '/drive/a.mp4', fileUri: 'https://files/a' }],
      },
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

  it('resolves a new analysis tag through an existing alias, never writing the aliased name', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.aliasTag({ from: 'dogs', to: 'psy' });

    const descriptor = configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'skip',
      frames: 3,
      output_language: 'pl',
      tag_language: 'en',
      promptVersion: 1,
    });
    await store.upsertVariant({
      fingerprint: file.fingerprint,
      configId: configId(descriptor),
      descriptor,
      finalName: 'walk.mp4',
      description: 'A dog walks in the park',
      transcript: '',
      language: null,
      tags: ['dogs'],
      analyzer: 'local',
      model: 'gemma3:12b',
      createdAt: '2026-01-03T00:00:00.000Z',
      usage: null,
    });

    const found = await store.search({ match: 'psy*', rankingTerms: ['psy'], limit: 10, offset: 0 });
    expect(found.ok && found.value[0]?.tags).toEqual(['psy']);

    const notFound = await store.search({ match: 'dogs*', rankingTerms: ['dogs'], limit: 10, offset: 0 });
    expect(notFound.ok && notFound.value).toEqual([]);

    const reAliased = await store.aliasTag({ from: 'dogs', to: 'psy' });
    expect(reAliased.ok && reAliased.value.remappedFiles).toBe(0);
  });

  it('re-points a dangling alias when its canonical tag is merged again, preserving the chain', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['dogs'],
    });

    await store.aliasTag({ from: 'dogs', to: 'psy' });
    await store.aliasTag({ from: 'psy', to: 'pieski' });

    const aliases = await store.listTagAliases();
    expect(aliases.ok && aliases.value).toEqual([
      { alias: 'dogs', canonical: 'pieski' },
      { alias: 'psy', canonical: 'pieski' },
    ]);

    const expanded = await store.expandTagTerms(['dogs']);
    expect(expanded.ok && expanded.value).toEqual([
      { term: 'dogs', equivalents: ['pieski', 'psy'] },
    ]);
  });

  it('resolves a tag term through tag_aliases in both directions', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['dogs'],
    });

    await store.aliasTag({ from: 'dogs', to: 'psy' });

    const fromAlias = await store.expandTagTerms(['dogs']);
    expect(fromAlias.ok && fromAlias.value).toEqual([{ term: 'dogs', equivalents: ['psy'] }]);

    const fromCanonical = await store.expandTagTerms(['psy']);
    expect(fromCanonical.ok && fromCanonical.value).toEqual([{ term: 'psy', equivalents: ['dogs'] }]);
  });

  it('ignores a dangling alias row whose tag was already deleted', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: [],
    });
    expect((await store.flush()).ok).toBe(true);

    const SQL = await initSqlJs();
    const raw = new SQL.Database(await readFile(store.databasePath()));
    raw.run("INSERT INTO tag_aliases(alias, tag_id) VALUES ('dogs', 999999)");
    await writeFile(store.databasePath(), raw.export());
    raw.close();

    const reopened = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const aliases = await reopened.listTagAliases();
    expect(aliases.ok && aliases.value).toEqual([]);

    const expanded = await reopened.expandTagTerms(['dogs']);
    expect(expanded.ok && expanded.value).toEqual([]);
  });

  it('finds a file through the alternation match built from an alias in both directions', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['psy'],
    });
    await store.aliasTag({ from: 'dogs', to: 'psy' });

    const search = await store.search({ match: '(dogs* OR psy)', rankingTerms: ['dogs'], limit: 10, offset: 0 });

    expect(search.ok && search.value.map((row) => row.fingerprint)).toEqual([file.fingerprint]);
  });

  it('does not resurrect a merged-away tag when ingesting through a chained alias', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['dogs'],
    });

    await store.aliasTag({ from: 'dogs', to: 'psy' });
    await store.aliasTag({ from: 'psy', to: 'pieski' });

    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: null,
      description: null,
      transcript: null,
      language: null,
      tags: ['dogs'],
    });

    const tagsList = await store.listTags();
    expect(tagsList.ok && tagsList.value).toEqual([{ name: 'pieski', count: 1 }]);
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

  it('matches an NFC-stored folder from an NFD root query', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const nfcFolder: CatalogFolder = { ...folder, currentPath: '/media/Å-ring'.normalize('NFC') };
    await store.upsertFolder(nfcFolder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    });

    const nfdRoot = '/media/Å-ring'.normalize('NFD');
    const scope = await store.listFaceIndexCandidates(nfdRoot);

    expect(scope.ok).toBe(true);
    if (!scope.ok) return;
    expect(scope.value.foldersMatched).toBe(1);
    expect(scope.value.filesInScope).toBe(1);
    expect(scope.value.candidates).toHaveLength(1);
  });

  it('matches an NFD-stored legacy folder from an NFC root query', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    const nfdFolder: CatalogFolder = { ...folder, currentPath: '/media/Å-ring'.normalize('NFD') };
    await store.upsertFolder(nfdFolder);
    await store.upsertFile(file);
    await store.upsertAnalysis({
      fingerprint: file.fingerprint,
      finalName: 'a-clip.mp4',
      description: 'A clip',
      transcript: 'words',
      language: 'en',
      tags: ['a-clip'],
    });

    const nfcRoot = '/media/Å-ring'.normalize('NFC');
    const scope = await store.listFaceIndexCandidates(nfcRoot);

    expect(scope.ok).toBe(true);
    if (!scope.ok) return;
    expect(scope.value.foldersMatched).toBe(1);
    expect(scope.value.filesInScope).toBe(1);
    expect(scope.value.candidates).toHaveLength(1);
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

const personFor = (personId: string, exemplarCount: number): Person => ({
  personId,
  displayName: personId,
  kind: 'face',
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid: Array.from({ length: 128 }, () => 0.1),
  exemplarCount,
});

const observationFor = (obsId: string, fingerprint: string, personId: string | null): FaceObservation => ({
  obsId,
  fingerprint,
  kind: 'face',
  frameTsS: 1,
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  embedding: Array.from({ length: 128 }, () => 0.2),
  quality: 0.9,
  personId,
  cropPath: null,
});

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

interface CatalogContentsSnapshot {
  analysis: string;
  tags: string;
  searchHits: string;
  searchColumns: string;
  searchFtsSql: string;
}

const catalogContentsSnapshot = (client: Database): CatalogContentsSnapshot => ({
  analysis: JSON.stringify(client.exec(
    'SELECT fingerprint, final_name, description, transcript, language FROM analyses ORDER BY fingerprint',
  )[0]?.values ?? []),
  tags: JSON.stringify(client.exec(
    `SELECT ft.fingerprint, t.name
      FROM file_tags ft
      JOIN tags t ON t.tag_id = ft.tag_id
      ORDER BY ft.fingerprint, t.name`,
  )[0]?.values ?? []),
  searchHits: JSON.stringify(client.exec(
    `SELECT sd.fingerprint, sd.file_name, sd.final_name, sd.description, sd.transcript, sd.tags_text
      FROM search_documents_fts
      JOIN search_documents sd ON sd.docid = search_documents_fts.docid
      WHERE search_documents_fts MATCH 'skyline*'`,
  )[0]?.values ?? []),
  searchColumns: JSON.stringify(client.exec('PRAGMA table_info(search_documents)')[0]?.values ?? []),
  searchFtsSql: JSON.stringify(client.exec(
    `SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'search_documents_fts'`,
  )[0]?.values ?? []),
});

const writeV8CatalogFixture = async (
  home: string,
  schemaVersion = 8,
): Promise<CatalogContentsSnapshot> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  const fixtureSql = await readFile(new URL('./fixtures/global-catalog-v8.sql', import.meta.url), 'utf8');
  client.run(fixtureSql);
  if (schemaVersion !== 8) client.run('UPDATE schema_meta SET version = ?', [schemaVersion]);
  const snapshot = catalogContentsSnapshot(client);
  const databasePath = path.join(home, '.ai-video-cataloger', 'catalog.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, Buffer.from(client.export()));
  client.close();
  return snapshot;
};
