import { describe, expect, it } from 'vitest';

import {
  buildConfigDescriptor,
  configId,
  GLOBAL_CATALOG_SCHEMA_VERSION,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
  type ConfigDescriptor,
} from '@core/domain/index.js';

import {
  InMemoryAnalyzer,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
} from '../../../test/server/usecases/test-fakes.js';
import { folderArtifactRoot } from './artifact-root.js';
import { sharedArtifactPaths, variantOutputPaths } from './artifact-store.js';
import { folderMarkerPath } from './folder-identity.js';
import { artifactPaths } from './shared.js';
import { deleteVariant, selectVariant, setFolderDefaultVariant } from './variants.js';

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
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-08-01T00:00:00.000Z',
  analyzer: 'claude-code',
  model: null,
  missingAt: null,
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

describe('variant selection', () => {
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
