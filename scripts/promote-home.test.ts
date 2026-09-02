import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { facesPeople } from '../core/server/usecases/faces.js';
import type { FacesDeps } from '../core/server/usecases/faces.js';
import {
  InMemoryConfig,
  InMemoryDownloads,
  InMemoryFaceEngine,
  InMemoryJobs,
  InMemoryMedia,
  InMemoryPhotosStore,
} from '../test/server/usecases/test-fakes.js';
import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '../adapters/db/index.js';
import { NodeFileSystemPort } from '../adapters/fs/index.js';

import { run } from './promote-home.js';

const scratchDirs: string[] = [];
const scratchDir = (): string => {
  const created = mkdtempSync(path.join(tmpdir(), 'avc-promote-home-test-'));
  scratchDirs.push(created);
  return created;
};

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const seedCatalog = async (homeDirectory: string): Promise<void> => {
  const store = new SqlJsGlobalCatalogStore({ homeDirectory });
  await store.upsertFolder({
    folderId: 'folder-1',
    currentPath: '/videos',
    displayName: 'videos',
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
  });
  await store.flush();
  await store.dispose();
};

const buildFacesDeps = (globalCatalog: SqlJsGlobalCatalogStore): FacesDeps => {
  const downloads = new InMemoryDownloads();
  downloads.downloadedArtifacts.add('face-detector/yunet-2023mar');
  downloads.downloadedArtifacts.add('face-embedder/sface-2021dec');
  return {
    config: new InMemoryConfig(),
    downloads,
    faceEngine: new InMemoryFaceEngine(),
    fs: new NodeFileSystemPort(),
    globalCatalog,
    jobs: new InMemoryJobs(),
    media: new InMemoryMedia(),
    photos: new InMemoryPhotosStore(),
  };
};

describe('promote-home run()', () => {
  it('dry-run prints the plan and writes nothing', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);

    const before = readFileSync(path.join(source, '.ai-video-cataloger', 'catalog.db'));
    const result = await run(['--source', source, '--target', target, '--dry-run']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('dry run — nothing written.');
    expect(existsSync(path.join(target, '.ai-video-cataloger'))).toBe(false);
    expect(readFileSync(path.join(source, '.ai-video-cataloger', 'catalog.db'))).toEqual(before);
  });

  it('without --yes and without --dry-run refuses to write', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);

    const result = await run(['--source', source, '--target', target]);

    expect(result.code).toBe(1);
    expect(result.output).toContain('Re-run with --yes');
    expect(existsSync(path.join(target, '.ai-video-cataloger'))).toBe(false);
  });

  it('backs up the existing target, installs the source, and carries over the target photos.db', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);

    const targetCatalogDir = path.join(target, '.ai-video-cataloger');
    mkdirSync(targetCatalogDir, { recursive: true });
    writeFileSync(path.join(targetCatalogDir, 'catalog.db'), 'pre-existing target catalog');
    writeFileSync(path.join(targetCatalogDir, 'photos.db'), 'owner photos catalog');

    const result = await run(['--source', source, '--target', target, '--yes']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('promoted.');

    const backups = readdirSync(target).filter((name) => name.startsWith('.ai-video-cataloger.backup-'));
    expect(backups).toHaveLength(1);
    const backupName = backups[0];
    if (backupName === undefined) throw new Error('expected a backup directory');
    expect(readFileSync(path.join(target, backupName, 'catalog.db'), 'utf8')).toBe('pre-existing target catalog');

    expect(readFileSync(path.join(targetCatalogDir, 'photos.db'), 'utf8')).toBe('owner photos catalog');
    expect(existsSync(path.join(targetCatalogDir, 'promoted-from.json'))).toBe(true);

    const marker: { sourceHomeDirectory: string } = JSON.parse(
      readFileSync(path.join(targetCatalogDir, 'promoted-from.json'), 'utf8'),
    );
    expect(marker.sourceHomeDirectory).toBe(source);
  });

  it('keeps the target-only home state the source does not provide, including the carried photos.db artifacts', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);
    writeFileSync(path.join(source, '.ai-video-cataloger', 'config.json'), '{"from":"source"}');

    const targetCatalogDir = path.join(target, '.ai-video-cataloger');
    mkdirSync(path.join(targetCatalogDir, 'photo-artifacts', 'thumbs'), { recursive: true });
    writeFileSync(path.join(targetCatalogDir, 'photo-artifacts', 'thumbs', 'ph_abc.grid.jpg'), 'owner-grid-thumb');
    writeFileSync(path.join(targetCatalogDir, 'photos.db'), 'owner photos catalog');
    writeFileSync(path.join(targetCatalogDir, 'credentials.json'), '{"key":"owner"}');
    writeFileSync(path.join(targetCatalogDir, 'config.json'), '{"from":"target"}');

    const result = await run(['--source', source, '--target', target, '--yes']);

    expect(result.code).toBe(0);
    expect(readFileSync(path.join(targetCatalogDir, 'photo-artifacts', 'thumbs', 'ph_abc.grid.jpg'), 'utf8'))
      .toBe('owner-grid-thumb');
    expect(readFileSync(path.join(targetCatalogDir, 'credentials.json'), 'utf8')).toBe('{"key":"owner"}');
    expect(readFileSync(path.join(targetCatalogDir, 'config.json'), 'utf8')).toBe('{"from":"source"}');
    expect(result.output).toContain('kept from the target: credentials.json, photo-artifacts');
    expect(result.output).toContain('overwritten by the source: config.json');
  });

  it('refuses to re-promote the identical source after a successful promotion', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);

    const first = await run(['--source', source, '--target', target, '--yes']);
    expect(first.code).toBe(0);

    const second = await run(['--source', source, '--target', target, '--yes']);
    expect(second.code).toBe(1);
    expect(second.output).toContain('already promoted');
  });

  it('refuses when both source and target have a photos.db, and touches nothing', async () => {
    const source = scratchDir();
    const target = scratchDir();
    await seedCatalog(source);
    const sourcePhotosStore = new SqlJsPhotosStore({ homeDirectory: source });
    await sourcePhotosStore.upsertFolder({
      folderId: 'photo-folder-1',
      currentPath: '/photos',
      displayName: 'photos',
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-01T00:00:00.000Z',
      defaultConfigId: null,
    });
    await sourcePhotosStore.flush();
    await sourcePhotosStore.dispose();

    const targetCatalogDir = path.join(target, '.ai-video-cataloger');
    mkdirSync(targetCatalogDir, { recursive: true });
    writeFileSync(path.join(targetCatalogDir, 'photos.db'), 'target photos');

    const result = await run(['--source', source, '--target', target, '--yes']);

    expect(result.code).toBe(1);
    expect(result.output).toContain('out of scope');
    expect(readFileSync(path.join(targetCatalogDir, 'photos.db'), 'utf8')).toBe('target photos');
  });

  it('carries face crop files, and stored crop paths re-anchor onto the promoted home at read time', async () => {
    const source = scratchDir();
    const target = scratchDir();

    const sourceCropDir = path.join(source, '.ai-video-cataloger', 'faces', 'obs', 'fp1');
    mkdirSync(sourceCropDir, { recursive: true });
    const staleAnchoredCropPath = '/some/unrelated/old-home/.ai-video-cataloger/faces/obs/fp1/fp1-000.jpg';
    writeFileSync(path.join(sourceCropDir, 'fp1-000.jpg'), 'crop-bytes');

    const seedingStore = new SqlJsGlobalCatalogStore({ homeDirectory: source });
    await seedingStore.upsertPerson({
      personId: 'person-1',
      displayName: 'Someone',
      kind: 'face',
      createdAt: '2026-08-01T00:00:00.000Z',
      centroid: Array.from({ length: 128 }, () => 0.01),
      exemplarCount: 1,
    });
    await seedingStore.upsertFaceObservation({
      obsId: 'fp1:video:0',
      fingerprint: 'fp1',
      kind: 'face',
      frameTsS: 1,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      embedding: Array.from({ length: 128 }, () => 0.01),
      quality: 1,
      personId: 'person-1',
      cropPath: staleAnchoredCropPath,
      media: 'video',
    });
    await seedingStore.flush();
    await seedingStore.dispose();

    const result = await run(['--source', source, '--target', target, '--yes']);
    expect(result.code).toBe(0);

    const promotedStore = new SqlJsGlobalCatalogStore({ homeDirectory: target });
    const deps = buildFacesDeps(promotedStore);
    await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
    const facesResult = await facesPeople(deps);
    await promotedStore.dispose();

    expect(facesResult.ok).toBe(true);
    if (!facesResult.ok) return;
    const person = facesResult.value.people.find((candidate) => candidate.personId === 'person-1');
    const expectedCropPath = path.join(target, '.ai-video-cataloger', 'faces', 'obs', 'fp1', 'fp1-000.jpg');
    expect(person?.exemplarCropPath).toBe(expectedCropPath);
    expect(existsSync(expectedCropPath)).toBe(true);
  });
});
