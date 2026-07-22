import { describe, expect, it } from 'vitest';

import { GLOBAL_CATALOG_SCHEMA_VERSION, type CatalogFile, type CatalogFolder } from '@core/domain/index.js';

import { exportFolderSnapshot, folderSnapshotPath, importFolderSnapshot } from './catalog-snapshot.js';
import { InMemoryFileSystem, InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';

const folderId = '11111111-1111-4111-8111-111111111111';

const folder = (currentPath: string): CatalogFolder => ({
  folderId,
  currentPath,
  displayName: 'work',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
});

const file = (fingerprint: string, processedAt: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName: 'clip.mp4',
  size: 2048,
  durationS: 12.5,
  gpsLat: null,
  gpsLon: null,
  processedAt,
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
});

describe('catalog snapshot roundtrip', () => {
  it('exports the folder rows to NDJSON and re-imports them into an empty store', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const source = new InMemoryGlobalCatalogStore();
    await source.upsertFolder(folder('/work'));
    await source.upsertFile(file('abc123', '2026-01-05T00:00:00.000Z'));
    await source.upsertFile({
      ...file('with-gps', '2026-01-06T00:00:00.000Z'),
      gpsLat: 69.6492,
      gpsLon: 18.9553,
    });
    await source.upsertAnalysis({
      fingerprint: 'abc123',
      finalName: '2026-01-05_a-clip.mp4',
      description: 'A clip',
      transcript: 'hello world',
      language: null,
      tags: ['a-clip'],
    });
    await source.upsertAnalysis({
      fingerprint: 'with-gps',
      finalName: 'gps-clip.mp4',
      description: 'A GPS clip',
      transcript: null,
      language: null,
      tags: ['dji-drone', 'wide-shot'],
    });

    const exported = await exportFolderSnapshot({ globalCatalog: source, fs }, folder('/work'));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.records).toBe(2);
    const snapshot = await fs.readTextFile(folderSnapshotPath(fs, '/work'));
    expect(snapshot.ok && snapshot.value !== null).toBe(true);
    expect(snapshot.ok && snapshot.value).toContain(`"version":${GLOBAL_CATALOG_SCHEMA_VERSION}`);
    expect(snapshot.ok && snapshot.value).toContain('"tags":["dji-drone","wide-shot"]');
    expect(snapshot.ok && snapshot.value).toContain('"gpsLat":69.6492');

    const target = new InMemoryGlobalCatalogStore();
    const imported = await importFolderSnapshot({ globalCatalog: target, fs }, '/work');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.imported).toBe(2);
    expect(imported.value.header?.folderId).toBe(folderId);

    const roundTrippedFile = await target.getFile('abc123');
    expect(roundTrippedFile.ok && roundTrippedFile.value?.processedAt).toBe('2026-01-05T00:00:00.000Z');
    const roundTrippedAnalysis = await target.getAnalysis('abc123');
    expect(roundTrippedAnalysis.ok && roundTrippedAnalysis.value?.transcript).toBe('hello world');
    const gpsFile = await target.getFile('with-gps');
    expect(gpsFile.ok && gpsFile.value?.gpsLon).toBe(18.9553);
    const gpsAnalysis = await target.getAnalysis('with-gps');
    expect(gpsAnalysis.ok && gpsAnalysis.value?.tags).toEqual(['dji-drone', 'wide-shot']);
  });

  it('never writes faces data into an exported snapshot', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const source = new InMemoryGlobalCatalogStore();
    await source.upsertFolder(folder('/work'));
    await source.upsertFile(file('abc123', '2026-01-05T00:00:00.000Z'));
    await source.upsertAnalysis({
      fingerprint: 'abc123',
      finalName: 'clip.mp4',
      description: 'A clip',
      transcript: 'hello world',
      language: null,
      tags: ['a-clip'],
    });

    const exported = await exportFolderSnapshot({ globalCatalog: source, fs }, folder('/work'));
    expect(exported.ok).toBe(true);
    const snapshot = await fs.readTextFile(folderSnapshotPath(fs, '/work'));
    const contents = snapshot.ok && snapshot.value !== null ? snapshot.value : '';
    for (const forbidden of ['embedding', 'person', 'crop', 'centroid', 'face_observation', 'bbox']) {
      expect(contents.includes(forbidden)).toBe(false);
    }
  });

  it('imports a v1 snapshot with missing tags and GPS as empty values', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const header = JSON.stringify({
      type: 'header',
      version: 1,
      folder: folder('/work'),
      exportedAt: '2026-01-02T00:00:00.000Z',
    });
    const record = JSON.stringify({
      type: 'record',
      file: {
        fingerprint: 'v1',
        folderId,
        fileName: 'clip.mp4',
        size: 2048,
        durationS: null,
        processedAt: '2026-01-05T00:00:00.000Z',
        analyzer: null,
        model: null,
      },
      analysis: {
        fingerprint: 'v1',
        finalName: null,
        description: 'Old snapshot',
        transcript: null,
        language: null,
      },
    });
    fs.addFile(folderSnapshotPath(fs, '/work'), { content: `${header}\n${record}\n` });
    const target = new InMemoryGlobalCatalogStore();

    const imported = await importFolderSnapshot({ globalCatalog: target, fs }, '/work');
    const importedFile = await target.getFile('v1');
    const importedAnalysis = await target.getAnalysis('v1');

    expect(imported.ok && imported.value.imported).toBe(1);
    expect(importedFile.ok && importedFile.value?.gpsLat).toBeNull();
    expect(importedAnalysis.ok && importedAnalysis.value?.tags).toEqual([]);
  });

  it('keeps the newer processed_at row when importing a conflicting snapshot', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const source = new InMemoryGlobalCatalogStore();
    await source.upsertFolder(folder('/work'));
    await source.upsertFile(file('abc123', '2026-01-01T00:00:00.000Z'));
    const exported = await exportFolderSnapshot({ globalCatalog: source, fs }, folder('/work'));
    expect(exported.ok).toBe(true);

    const target = new InMemoryGlobalCatalogStore();
    await target.upsertFolder(folder('/work'));
    await target.upsertFile(file('abc123', '2026-06-01T00:00:00.000Z'));

    const imported = await importFolderSnapshot({ globalCatalog: target, fs }, '/work');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.imported).toBe(0);
    const winner = await target.getFile('abc123');
    expect(winner.ok && winner.value?.processedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('imports a snapshot row that is newer than the stored row', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory('/work');
    const source = new InMemoryGlobalCatalogStore();
    await source.upsertFolder(folder('/work'));
    await source.upsertFile(file('abc123', '2026-09-01T00:00:00.000Z'));
    await exportFolderSnapshot({ globalCatalog: source, fs }, folder('/work'));

    const target = new InMemoryGlobalCatalogStore();
    await target.upsertFile(file('abc123', '2026-01-01T00:00:00.000Z'));
    const imported = await importFolderSnapshot({ globalCatalog: target, fs }, '/work');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.imported).toBe(1);
    const winner = await target.getFile('abc123');
    expect(winner.ok && winner.value?.processedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});
