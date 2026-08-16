import { describe, expect, it } from 'vitest';

import {
  appError,
  buildConfigDescriptor,
  configId,
  GLOBAL_CATALOG_SCHEMA_VERSION,
  ok,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type ConfigDescriptor,
  type Result,
} from '@core/domain/index.js';

import {
  InMemoryAnalyzer,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryJobs,
} from '../../../test/server/usecases/test-fakes.js';
import type {
  FileSystemPort,
  GlobalCatalogStore,
  JobExecutionContext,
  JobsPort,
} from '../ports.js';
import { folderArtifactRoot } from './artifact-root.js';
import { sharedArtifactPaths, variantOutputPaths } from './artifact-store.js';
import { folderMarkerPath } from './folder-identity.js';
import { artifactPaths } from './shared.js';
import {
  deleteVariant,
  listVariants,
  selectVariant,
  selectVariantByLocator,
  setFolderDefaultVariant,
} from './variants.js';

const folderPath = '/work';
const fingerprint = 'fingerprint-705';

const folder = (folderId = '11111111-1111-4111-8111-111111111111'): CatalogFolder => ({
  folderId,
  currentPath: folderPath,
  displayName: 'work',
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-01T00:00:00.000Z',
});

const file = (folderId: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName: 'clip.mp4',
  size: 100,
  durationS: 10,
  width: null,
  height: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-08-01T00:00:00.000Z',
  analyzer: 'claude-code',
  model: null,
  missingAt: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const variant = (
  descriptor: ConfigDescriptor,
  name: string,
  createdAt: string,
): CatalogVariant => ({
  fingerprint,
  configId: configId(descriptor),
  descriptor,
  finalName: `${name}.mp4`,
  description: `${name} description`,
  transcript: `${name} transcript`,
  language: descriptor.output_language,
  tags: [`${name}-tag`],
  analyzer: descriptor.providerId,
  model: descriptor.model ?? descriptor.modelTag ?? null,
  createdAt,
  usage: null,
  resolvedOutputLanguage: null,
  resolvedTagLanguage: null,
});

const seedVariantArtifacts = async (
  fs: InMemoryFileSystem,
  catalogVariant: CatalogVariant,
): Promise<void> => {
  if (catalogVariant.descriptor === null) throw new Error('Expected a configuration descriptor');
  const root = folderArtifactRoot(fs, folderPath);
  const shared = sharedArtifactPaths(fs, root, fingerprint, catalogVariant.descriptor);
  if (shared.framesDirectory !== null) {
    fs.addFile(fs.join(shared.framesDirectory, 'frame-001.jpg'), { content: 'frame' });
  }
  fs.addFile(shared.transcriptPath, { content: catalogVariant.transcript ?? '' });
  fs.addFile(shared.transcriptJsonPath, { content: '{"segments":[]}' });
  const output = variantOutputPaths(fs, root, fingerprint, catalogVariant.configId);
  fs.addFile(output.summaryPath, { content: `${catalogVariant.description}\n` });
  fs.addFile(output.summaryJsonPath, { content: JSON.stringify({ description: catalogVariant.description }) });
  fs.addFile(output.debugLogPath, { content: catalogVariant.configId });
};

const seedCatalog = async (
  store: InMemoryGlobalCatalogStore,
  catalogFolder: CatalogFolder,
  variants: readonly CatalogVariant[],
): Promise<void> => {
  await store.upsertFolder(catalogFolder);
  await store.upsertFile(file(catalogFolder.folderId));
  for (const catalogVariant of variants) await store.upsertVariant(catalogVariant);
};

class ManualJobs extends InMemoryJobs {
  readonly queued: Array<Parameters<JobsPort['enqueue']>[0]> = [];

  override enqueue(input: Parameters<JobsPort['enqueue']>[0]): ReturnType<JobsPort['enqueue']> {
    this.queued.push(input);
    return Promise.resolve(ok({ jobId: `manual-${this.queued.length}` }));
  }

  run(index: number): Promise<Result<unknown, AppError>> {
    const queued = this.queued[index];
    if (queued?.run === undefined) throw new Error(`Expected queued job ${index}`);
    const context: JobExecutionContext = {
      signal: new AbortController().signal,
      reportProgress: () => Promise.resolve(ok(undefined)),
    };
    return queued.run(context);
  }
}

class RejectingJobs extends InMemoryJobs {
  override enqueue(): ReturnType<JobsPort['enqueue']> {
    return Promise.resolve({ ok: false, error: appError('internal', 'Queue unavailable') });
  }
}

class ScriptedCatalogStore extends InMemoryGlobalCatalogStore {
  readonly selectedConfigIdResults: Array<Result<string | null, AppError>> = [];
  readonly explicitSelectedConfigIdResults: Array<Result<string | null, AppError>> = [];
  readonly selectedVariantResults: Array<Result<void, AppError>> = [];
  readonly variantErrors = new Map<string, AppError>();
  readonly selectionChangesOnRead = new Map<number, string | null>();
  selectedConfigIdReads = 0;

  override async getSelectedConfigId(
    selectedFingerprint: string,
  ): ReturnType<GlobalCatalogStore['getSelectedConfigId']> {
    this.selectedConfigIdReads += 1;
    const scripted = this.selectedConfigIdResults.shift();
    if (scripted !== undefined) return scripted;
    if (this.selectionChangesOnRead.has(this.selectedConfigIdReads)) {
      const changed = await super.setSelectedVariant(
        selectedFingerprint,
        this.selectionChangesOnRead.get(this.selectedConfigIdReads) ?? null,
      );
      if (!changed.ok) return changed;
    }
    return super.getSelectedConfigId(selectedFingerprint);
  }

  override getExplicitSelectedConfigId(
    selectedFingerprint: string,
  ): ReturnType<GlobalCatalogStore['getExplicitSelectedConfigId']> {
    return Promise.resolve(
      this.explicitSelectedConfigIdResults.shift()
      ?? super.getExplicitSelectedConfigId(selectedFingerprint),
    );
  }

  override getVariant(
    selectedFingerprint: string,
    selectedConfigId: string,
  ): ReturnType<GlobalCatalogStore['getVariant']> {
    const error = this.variantErrors.get(selectedConfigId);
    return error === undefined
      ? super.getVariant(selectedFingerprint, selectedConfigId)
      : Promise.resolve({ ok: false, error });
  }

  override setSelectedVariant(
    selectedFingerprint: string,
    selectedConfigId: string | null,
  ): ReturnType<GlobalCatalogStore['setSelectedVariant']> {
    const scripted = this.selectedVariantResults.shift();
    return scripted === undefined
      ? super.setSelectedVariant(selectedFingerprint, selectedConfigId)
      : Promise.resolve(scripted);
  }
}

class FailingDeleteFileSystem extends InMemoryFileSystem {
  failedDeletePath: string | null = null;

  override deletePath(value: string): ReturnType<FileSystemPort['deletePath']> {
    if (this.failedDeletePath !== null && this.resolve(value) === this.resolve(this.failedDeletePath)) {
      this.failedDeletePath = null;
      return Promise.resolve({ ok: false, error: appError('internal', 'Projection cleanup failed') });
    }
    return super.deletePath(value);
  }
}

describe('variant selection', () => {
  it('describes the current configuration before a file has its first variant', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const analyzer = new InMemoryAnalyzer();
    const config = new InMemoryConfig();
    const videoPath = fs.join(folderPath, 'new.mp4');
    fs.addFile(videoPath, { hash: 'new-fingerprint', content: 'video' });

    const result = await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { videoPath },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        fingerprint: 'new-fingerprint',
        videoPath,
        folderPath,
        folderDefaultConfigId: null,
        currentConfig: { configId: expect.stringMatching(/^cfg_/) },
        variants: [],
      },
    });
  });

  it('returns an empty variant list after healing an unreachable canonical', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const analyzer = new InMemoryAnalyzer();
    const config = new InMemoryConfig();
    const stored = variant(buildConfigDescriptor({}, 1), 'stale', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [stored]);
    await store.setSelectedVariant(fingerprint, stored.configId);

    const result = await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { fingerprint },
    );
    const selection = await store.getSelectedConfigId(fingerprint);

    expect(result).toMatchObject({
      ok: true,
      value: { fingerprint, variants: [] },
    });
    expect(selection.ok && selection.value).toBe(null);
  });

  it('lists comparison-ready variant details by path or fingerprint', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const analyzer = new InMemoryAnalyzer();
    const config = new InMemoryConfig();
    const first = {
      ...variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z'),
      usage: { inputTokens: 10, estimatedCostUsd: 0.012 },
    };
    const second = variant(
      buildConfigDescriptor({ output_language: 'pl' }, 2),
      'second',
      '2026-08-02T00:00:00.000Z',
    );
    const catalogFolder = folder();
    const videoPath = fs.join(folderPath, 'clip.mp4');
    fs.addFile(videoPath, { hash: fingerprint, content: 'video' });
    fs.addFile(folderMarkerPath(fs, folderPath), { content: JSON.stringify({
      folderId: catalogFolder.folderId,
      schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
      createdAt: '2026-08-01T00:00:00.000Z',
    }) });
    await seedCatalog(store, catalogFolder, [first, second]);
    await store.setSelectedVariant(fingerprint, second.configId);
    await store.setFolderDefaultVariant(catalogFolder.folderId, first.configId);

    const byPath = await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { videoPath },
    );
    const byFingerprint = await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { fingerprint },
    );

    expect(byPath).toEqual(byFingerprint);
    expect(byPath).toMatchObject({
      ok: true,
      value: {
        fingerprint,
        videoPath,
        folderPath,
        folderDefaultConfigId: first.configId,
        currentConfig: {
          configId: first.configId,
          descriptor: first.descriptor,
        },
        variants: [
          {
            configId: second.configId,
            descriptor: expect.objectContaining({ output_language: 'pl', promptVersion: 2 }),
            label: 'claude-code',
            selected: true,
          },
          {
            configId: first.configId,
            estimatedCostUsd: 0.012,
            usage: { inputTokens: 10, estimatedCostUsd: 0.012 },
            selected: false,
            artifacts: {
              framesDirectory: expect.stringContaining(`/artifacts/frames/${fingerprint}/`),
              transcriptPath: expect.stringContaining(`/artifacts/transcripts/${fingerprint}/`),
              summaryPath: expect.stringContaining(`/variants/${fingerprint}/${first.configId}/summary.txt`),
            },
          },
        ],
      },
    });
    expect(await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { videoPath, fingerprint },
    )).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('resolves selection against the requested path folder default', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const analyzer = new InMemoryAnalyzer();
    const config = new InMemoryConfig();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(
      buildConfigDescriptor({ output_language: 'pl' }, 1),
      'second',
      '2026-08-02T00:00:00.000Z',
    );
    const viewingFolder: CatalogFolder = {
      ...folder('22222222-2222-4222-8222-222222222222'),
      currentPath: '/copies',
      displayName: 'copies',
    };
    const videoPath = '/copies/clip.mp4';
    fs.addFile(videoPath, { hash: fingerprint, content: 'video' });
    fs.addFile('/work/clip.mp4', { hash: fingerprint, content: 'video' });
    fs.addFile(folderMarkerPath(fs, viewingFolder.currentPath), { content: JSON.stringify({
      folderId: viewingFolder.folderId,
      schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
      createdAt: '2026-08-01T00:00:00.000Z',
    }) });
    await seedCatalog(store, folder(), [first, second]);
    await store.upsertFolder(viewingFolder);
    await store.setFolderDefaultVariant(viewingFolder.folderId, second.configId);

    const result = await listVariants(
      { globalCatalog: store, fs, config, analyzer },
      { videoPath },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        videoPath,
        folderDefaultConfigId: second.configId,
        variants: [
          { configId: second.configId, selected: true },
          { configId: first.configId, selected: false },
        ],
      },
    });
  });

  it('validates existence, refreshes the name projection, and changes the selected search document', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);

    expect(await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId }))
      .toEqual({ ok: true, value: { fingerprint, configId: first.configId } });
    expect(await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: second.configId }))
      .toEqual({ ok: true, value: { fingerprint, configId: second.configId } });

    const selected = await store.getAnalysis(fingerprint);
    expect(selected.ok && selected.value?.description).toBe(second.description);
    const projection = artifactPaths(fs, folderArtifactRoot(fs, folderPath), '/work/clip.mp4', second.finalName);
    expect(await fs.readTextFile(projection.summaryJsonPath)).toEqual({
      ok: true,
      value: JSON.stringify({ description: second.description }),
    });
    const oldProjection = artifactPaths(fs, folderArtifactRoot(fs, folderPath), '/work/clip.mp4', first.finalName);
    expect(await fs.exists(oldProjection.summaryJsonPath)).toEqual({ ok: true, value: false });

    expect(await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: 'cfg_000000000000' }))
      .toMatchObject({ ok: false, error: { code: 'variant_not_found' } });
  });

  it('records a deferred selection before its projection job runs', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: true, value: { fingerprint, configId: second.configId } });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: second.configId });
    expect(jobs.queued).toMatchObject([{
      kind: 'variant_projection',
      payload: { fingerprint, configId: second.configId },
    }]);
    const firstProjection = artifactPaths(fs, folderArtifactRoot(fs, folderPath), '/work/clip.mp4', first.finalName);
    const secondProjection = artifactPaths(fs, folderArtifactRoot(fs, folderPath), '/work/clip.mp4', second.finalName);
    expect(await fs.exists(firstProjection.summaryJsonPath)).toEqual({ ok: true, value: true });
    expect(await fs.exists(secondProjection.summaryJsonPath)).toEqual({ ok: true, value: false });

    expect(await jobs.run(0)).toEqual({ ok: true, value: { fingerprint, configId: second.configId } });
    expect(await fs.exists(firstProjection.summaryJsonPath)).toEqual({ ok: true, value: false });
    expect(await fs.readTextFile(secondProjection.summaryJsonPath)).toEqual({
      ok: true,
      value: JSON.stringify({ description: second.description }),
    });
  });

  it('restores the prior selection when a deferred projection cannot be queued', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    const catalogFolder = folder();
    await seedCatalog(store, catalogFolder, [first, second]);
    await store.setFolderDefaultVariant(catalogFolder.folderId, first.configId);

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs: new RejectingJobs() },
      { fingerprint, configId: second.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Queue unavailable') });
    expect(await store.getExplicitSelectedConfigId(fingerprint)).toEqual({ ok: true, value: null });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: first.configId });
  });

  it('projects the latest selection when several deferred choices are queued', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    const third = variant(buildConfigDescriptor({ output_language: 'fr' }, 1), 'third', '2026-08-03T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second, third]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await seedVariantArtifacts(fs, third);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });

    await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    );
    await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: third.configId, deferProjection: true },
    );

    expect(await jobs.run(0)).toEqual({ ok: true, value: { fingerprint, configId: third.configId } });
    const thirdProjection = artifactPaths(fs, folderArtifactRoot(fs, folderPath), '/work/clip.mp4', third.finalName);
    expect(await fs.readTextFile(thirdProjection.summaryJsonPath)).toEqual({
      ok: true,
      value: JSON.stringify({ description: third.description }),
    });
  });

  it('fails the projection job without reverting its current selection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });

    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });

    expect(await jobs.run(0)).toMatchObject({ ok: false, error: { code: 'file_not_found' } });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: second.configId });
  });

  it('rejects a missing variant before recording a deferred selection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    await seedCatalog(store, folder(), []);

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs: new ManualJobs() },
      { fingerprint, configId: 'cfg_000000000000', deferProjection: true },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'variant_not_found' } });
  });

  it('validates located selection input and preserves synchronous path selection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);

    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint: '', configId: selected.configId },
    )).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { videoPath: '/work/missing.mp4', configId: selected.configId },
    )).toMatchObject({ ok: false, error: { code: 'file_not_found' } });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId },
    )).toEqual({ ok: true, value: { fingerprint, configId: selected.configId } });
    expect(jobs.queued).toEqual([]);
  });

  it('returns a selected-configuration lookup failure before enqueueing projection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    store.selectedConfigIdResults.push({ ok: false, error: appError('internal', 'Selection lookup failed') });

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Selection lookup failed') });
    expect(jobs.queued).toEqual([]);
  });

  it('returns an explicit-selection lookup failure before enqueueing projection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    store.explicitSelectedConfigIdResults.push({
      ok: false,
      error: appError('internal', 'Explicit selection lookup failed'),
    });

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Explicit selection lookup failed') });
    expect(jobs.queued).toEqual([]);
  });

  it('returns a previous-variant lookup failure before changing selection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await store.setSelectedVariant(fingerprint, first.configId);
    store.variantErrors.set(first.configId, appError('internal', 'Previous variant lookup failed'));

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Previous variant lookup failed') });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: first.configId });
    expect(jobs.queued).toEqual([]);
  });

  it('returns a selection-write failure before enqueueing projection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await store.setSelectedVariant(fingerprint, first.configId);
    store.selectedVariantResults.push({ ok: false, error: appError('internal', 'Selection write failed') });

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Selection write failed') });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: first.configId });
    expect(jobs.queued).toEqual([]);
  });

  it('restores a previous explicit selection when projection enqueueing fails', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await store.setSelectedVariant(fingerprint, first.configId);

    const result = await selectVariantByLocator(
      { globalCatalog: store, fs, jobs: new RejectingJobs() },
      { fingerprint, configId: second.configId, deferProjection: true },
    );

    expect(result).toEqual({ ok: false, error: appError('internal', 'Queue unavailable') });
    expect(await store.getExplicitSelectedConfigId(fingerprint)).toEqual({ ok: true, value: first.configId });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: first.configId });
  });

  it('projects a deferred selection without cleanup when no prior selection resolves', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);
    store.selectedConfigIdResults.push(ok(null));

    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    expect(await jobs.run(0)).toEqual({ ok: true, value: { fingerprint, configId: selected.configId } });
  });

  it('returns the initial selected-configuration lookup failure from a projection job', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdResults.push({ ok: false, error: appError('internal', 'Job selection lookup failed') });

    expect(await jobs.run(0)).toEqual({ ok: false, error: appError('internal', 'Job selection lookup failed') });
  });

  it('fails a projection job when its selected configuration becomes unavailable', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdResults.push(ok(null));

    expect(await jobs.run(0)).toEqual({
      ok: false,
      error: appError('internal', `Selected variant is unavailable: ${fingerprint}`),
    });
  });

  it('fails a projection job when its selected variant disappears before projection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdResults.push(ok('cfg_000000000000'));

    expect(await jobs.run(0)).toMatchObject({ ok: false, error: { code: 'variant_not_found' } });
  });

  it('retries with the latest selection when the first projection fails during a selection change', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    const third = variant(buildConfigDescriptor({ output_language: 'fr' }, 1), 'third', '2026-08-03T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second, third]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, third);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdReads = 0;
    store.selectionChangesOnRead.set(2, third.configId);

    expect(await jobs.run(0)).toEqual({ ok: true, value: { fingerprint, configId: third.configId } });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: third.configId });
  });

  it('returns a latest-selection lookup failure after projection fails', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdResults.push(
      ok(second.configId),
      { ok: false, error: appError('internal', 'Latest selection lookup failed') },
    );

    expect(await jobs.run(0)).toEqual({ ok: false, error: appError('internal', 'Latest selection lookup failed') });
  });

  it('returns a later projection failure after retrying a completed stale projection', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    const third = variant(buildConfigDescriptor({ output_language: 'fr' }, 1), 'third', '2026-08-03T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second, third]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdReads = 0;
    store.selectionChangesOnRead.set(2, third.configId);

    expect(await jobs.run(0)).toMatchObject({ ok: false, error: { code: 'file_not_found' } });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: third.configId });
  });

  it('returns a projection cleanup failure when the selection remains current', async () => {
    const fs = new FailingDeleteFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    fs.failedDeletePath = artifactPaths(
      fs,
      folderArtifactRoot(fs, folderPath),
      '/work/clip.mp4',
      first.finalName,
    ).framesDir;

    expect(await jobs.run(0)).toEqual({
      ok: false,
      error: appError('internal', 'Projection cleanup failed'),
    });
  });

  it('returns a latest-selection lookup failure after projection cleanup fails', async () => {
    const fs = new FailingDeleteFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    fs.failedDeletePath = artifactPaths(
      fs,
      folderArtifactRoot(fs, folderPath),
      '/work/clip.mp4',
      first.finalName,
    ).framesDir;
    store.selectedConfigIdResults.push(
      ok(second.configId),
      { ok: false, error: appError('internal', 'Cleanup selection lookup failed') },
    );

    expect(await jobs.run(0)).toEqual({
      ok: false,
      error: appError('internal', 'Cleanup selection lookup failed'),
    });
  });

  it('retries cleanup against the latest selection when selection changes during cleanup', async () => {
    const fs = new FailingDeleteFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const first = variant(buildConfigDescriptor({}, 1), 'first', '2026-08-01T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ output_language: 'pl' }, 1), 'second', '2026-08-02T00:00:00.000Z');
    const third = variant(buildConfigDescriptor({ output_language: 'fr' }, 1), 'third', '2026-08-03T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second, third]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await seedVariantArtifacts(fs, third);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: second.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    fs.failedDeletePath = artifactPaths(
      fs,
      folderArtifactRoot(fs, folderPath),
      '/work/clip.mp4',
      first.finalName,
    ).framesDir;
    store.selectedConfigIdReads = 0;
    store.selectionChangesOnRead.set(2, third.configId);

    expect(await jobs.run(0)).toEqual({ ok: true, value: { fingerprint, configId: third.configId } });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: third.configId });
  });

  it('returns a final selected-configuration lookup failure after projection succeeds', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new ScriptedCatalogStore();
    const jobs = new ManualJobs();
    const selected = variant(buildConfigDescriptor({}, 1), 'selected', '2026-08-01T00:00:00.000Z');
    await seedCatalog(store, folder(), [selected]);
    await seedVariantArtifacts(fs, selected);
    expect(await selectVariantByLocator(
      { globalCatalog: store, fs, jobs },
      { fingerprint, configId: selected.configId, deferProjection: true },
    )).toMatchObject({ ok: true });
    store.selectedConfigIdResults.push(
      ok(selected.configId),
      { ok: false, error: appError('internal', 'Final selection lookup failed') },
    );

    expect(await jobs.run(0)).toEqual({ ok: false, error: appError('internal', 'Final selection lookup failed') });
  });

  it('resolves a cleared folder default from output language and prompt version', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const analyzer = new InMemoryAnalyzer();
    analyzer.analysisPromptVersion = 7;
    const config = new InMemoryConfig();
    await config.set({ kind: 'folder', folder: folderPath }, 'output_language', 'pl');
    const resolved = variant(buildConfigDescriptor({ output_language: 'pl' }, 7), 'resolved', '2026-08-01T00:00:00.000Z');
    const newest = variant(buildConfigDescriptor({ output_language: 'en' }, 1), 'newest', '2026-08-03T00:00:00.000Z');
    const folderId = '33333333-3333-4333-8333-333333333333';
    fs.addFile(folderMarkerPath(fs, folderPath), { content: JSON.stringify({
      folderId,
      schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
      createdAt: '2026-08-01T00:00:00.000Z',
    }) });
    await seedCatalog(store, folder(folderId), [resolved, newest]);
    await store.setSelectedVariant(fingerprint, null);
    await seedVariantArtifacts(fs, resolved);
    await seedVariantArtifacts(fs, newest);

    const result = await setFolderDefaultVariant(
      { globalCatalog: store, fs, config, analyzer },
      { folderPath, configId: null },
    );

    expect(result).toEqual({
      ok: true,
      value: { folderId, defaultConfigId: null, resolvedConfigId: resolved.configId },
    });
    expect(await store.getSelectedConfigId(fingerprint)).toEqual({ ok: true, value: resolved.configId });
  });
});

describe('variant deletion', () => {
  it('promotes the newest survivor and removes shared transcripts only after their final reference', async () => {
    const fs = new InMemoryFileSystem(folderPath);
    const store = new InMemoryGlobalCatalogStore();
    const sharedDescriptor = buildConfigDescriptor({}, 1);
    const first = variant(sharedDescriptor, 'first', '2026-08-03T00:00:00.000Z');
    const second = variant(buildConfigDescriptor({ analyzer_provider: {
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
    } }, 1), 'second', '2026-08-01T00:00:00.000Z');
    const independent = variant(buildConfigDescriptor({ whisper_model: 'small' }, 1), 'independent', '2026-08-02T00:00:00.000Z');
    await seedCatalog(store, folder(), [first, second, independent]);
    await seedVariantArtifacts(fs, first);
    await seedVariantArtifacts(fs, second);
    await seedVariantArtifacts(fs, independent);
    await selectVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId });
    const root = folderArtifactRoot(fs, folderPath);
    const shared = sharedArtifactPaths(fs, root, fingerprint, sharedDescriptor);

    expect(await deleteVariant({ globalCatalog: store, fs }, { fingerprint, configId: first.configId }))
      .toMatchObject({ ok: true, value: { selectedConfigId: independent.configId } });
    expect(await fs.exists(shared.transcriptPath)).toEqual({ ok: true, value: true });

    expect(await deleteVariant({ globalCatalog: store, fs }, { fingerprint, configId: second.configId }))
      .toMatchObject({ ok: true });
    expect(await fs.exists(shared.transcriptPath)).toEqual({ ok: true, value: false });
    expect(await deleteVariant({ globalCatalog: store, fs }, { fingerprint, configId: independent.configId }))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
