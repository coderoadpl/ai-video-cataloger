import { describe, expect, it } from 'vitest';

import {
  buildConfigDescriptor,
  configId,
  derivedFolderId,
  type CatalogFile,
  type CatalogVariant,
} from '@core/domain/index.js';

import { InMemoryFileSystem, InMemoryGlobalCatalogStore } from '../../../test/server/usecases/test-fakes.js';
import { variantArtifactPaths, variantOutputPaths } from './artifact-store.js';
import { importTranslationVariants } from './translation-import.js';

const sourceDescriptor = buildConfigDescriptor({ output_language: 'en' }, 1);
const sourceConfigId = configId(sourceDescriptor);
const folderPath = '/work/videos';
const folderId = derivedFolderId(folderPath);

const file = (fingerprint: string, fileName: string): CatalogFile => ({
  fingerprint,
  folderId,
  fileName,
  size: 2_048,
  durationS: 10,
  width: 1920,
  height: 1080,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-08-01T10:00:00.000Z',
  analyzer: 'local',
  model: 'gemma3:12b',
  missingAt: null,
  capturedAt: null,
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const sourceVariant = (fingerprint: string): CatalogVariant => ({
  fingerprint,
  configId: sourceConfigId,
  descriptor: sourceDescriptor,
  finalName: 'English-name.mp4',
  description: 'English source description',
  transcript: 'Source transcript copied verbatim',
  language: 'en',
  tags: ['source-tag'],
  analyzer: 'local',
  model: 'gemma3:12b',
  createdAt: '2026-08-01T10:00:00.000Z',
  usage: null,
  resolvedOutputLanguage: 'en',
  resolvedTagLanguage: 'en',
});

const translationRow = (fingerprint: string, description: string) => ({
  fingerprint,
  sourceConfigId,
  sourceDescription: 'English source description',
  sourceTags: ['source-tag'],
  description,
  tags: ['Jeżowak morski', 'gałęzie'],
  finalName: 'Polska-nazwa.mp4',
  translator: { provider: 'codex' as const, model: 'gpt-5.5' },
});

const seed = async (
  store: InMemoryGlobalCatalogStore,
  fs: InMemoryFileSystem,
  fingerprint: string,
  fileName: string,
): Promise<void> => {
  await store.upsertFolder({
    folderId,
    currentPath: folderPath,
    displayName: 'videos',
    firstSeenAt: '2026-08-01T09:00:00.000Z',
    lastSeenAt: '2026-08-01T10:00:00.000Z',
  });
  await store.upsertFile(file(fingerprint, fileName));
  await store.upsertVariant(sourceVariant(fingerprint), { outputLanguage: 'en', tagLanguage: 'en' });
  await store.setSelectedVariant(fingerprint, sourceConfigId);
  const root = { path: folderPath, catalogDirectory: fs.join(folderPath, '.ai-video-cataloger') };
  const artifacts = variantArtifactPaths(fs, root, fingerprint, sourceDescriptor);
  fs.addDirectory(artifacts.directory);
  fs.addFile(artifacts.summaryPath, { content: 'Source summary' });
  fs.addFile(artifacts.summaryJsonPath, { content: '{"description":"English source description"}' });
  if (artifacts.framesDirectory !== null) {
    fs.addDirectory(artifacts.framesDirectory);
    fs.addFile(fs.join(artifacts.framesDirectory, 'frame-001.jpg'), { content: 'frame' });
  }
  fs.addFile(artifacts.transcriptPath, { content: 'Source transcript copied verbatim' });
  fs.addFile(artifacts.transcriptJsonPath, { content: '{"segments":[]}' });
};

describe('importTranslationVariants', () => {
  it('creates, selects, normalizes tags, copies source data and artifacts, upserts, and skips missing sources', async () => {
    const store = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem('/work');
    await seed(store, fs, 'fp-select', 'selected.mp4');
    await seed(store, fs, 'fp-no-select', 'kept.mp4');
    const selectedInputPath = '/work/selected.ndjson';
    fs.addFile(selectedInputPath, {
      content: [
        JSON.stringify(translationRow('fp-select', 'Polski opis')),
        JSON.stringify(translationRow('fp-missing', 'Brak źródła')),
      ].join('\n'),
    });

    const selected = await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: selectedInputPath, dryRun: false, select: true },
    );

    expect(selected.ok && selected.value).toMatchObject({
      total: 2,
      created: 1,
      updated: 0,
      skipped: 1,
      invalid: 1,
      selected: 1,
    });
    if (!selected.ok) throw new Error(selected.error.message);
    const importedConfigId = selected.value.rows[0]?.configId;
    if (importedConfigId === undefined || importedConfigId === null) throw new Error('Expected imported config id');
    const imported = await store.getVariant('fp-select', importedConfigId);
    expect(imported.ok && imported.value).toMatchObject({
      descriptor: {
        family: 'translation',
        providerId: 'codex',
        model: 'gpt-5.5',
        sourceConfigId,
      },
      finalName: 'Polska-nazwa.mp4',
      description: 'Polski opis',
      transcript: 'Source transcript copied verbatim',
      language: 'pl',
      tags: ['jezowak-morski', 'galezie'],
      analyzer: 'translation',
      model: 'gpt-5.5',
      resolvedOutputLanguage: 'pl',
      resolvedTagLanguage: 'pl',
    });
    expect(await store.getExplicitSelectedConfigId('fp-select')).toEqual({ ok: true, value: importedConfigId });
    const root = { path: folderPath, catalogDirectory: fs.join(folderPath, '.ai-video-cataloger') };
    const importedArtifacts = variantOutputPaths(fs, root, 'fp-select', importedConfigId);
    expect(await fs.readTextFile(importedArtifacts.summaryPath)).toEqual({ ok: true, value: 'Source summary' });
    if (!imported.ok || imported.value === null || imported.value.descriptor === null) {
      throw new Error('Expected imported descriptor');
    }
    const sharedArtifacts = variantArtifactPaths(fs, root, 'fp-select', imported.value.descriptor);
    expect(await fs.readTextFile(sharedArtifacts.transcriptPath)).toEqual({
      ok: true,
      value: 'Source transcript copied verbatim',
    });
    expect(sharedArtifacts.framesDirectory).not.toBeNull();
    if (sharedArtifacts.framesDirectory === null) throw new Error('Expected translated frames directory');
    expect(await fs.isFile(fs.join(sharedArtifacts.framesDirectory, 'frame-001.jpg'))).toEqual({ ok: true, value: true });

    const noSelectInputPath = '/work/no-select.ndjson';
    fs.addFile(noSelectInputPath, { content: JSON.stringify(translationRow('fp-no-select', 'Bez wyboru')) });
    const noSelect = await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: noSelectInputPath, dryRun: false, select: false },
    );
    expect(noSelect.ok && noSelect.value.selected).toBe(0);
    expect(await store.getExplicitSelectedConfigId('fp-no-select')).toEqual({ ok: true, value: sourceConfigId });

    fs.addFile(selectedInputPath, { content: JSON.stringify(translationRow('fp-select', 'Opis po aktualizacji')) });
    const rerun = await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: selectedInputPath, dryRun: false, select: true },
    );
    expect(rerun.ok && rerun.value).toMatchObject({ created: 0, updated: 1, skipped: 0, invalid: 0 });
    const variants = await store.listVariants('fp-select');
    expect(variants.ok && variants.value).toHaveLength(2);
  });

  it('validates a dry run without changing variants or selection', async () => {
    const store = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem('/work');
    await seed(store, fs, 'fp-dry-run', 'dry.mp4');
    fs.addFile('/work/dry.ndjson', { content: JSON.stringify(translationRow('fp-dry-run', 'Suchy przebieg')) });

    const result = await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: '/work/dry.ndjson', dryRun: true, select: true },
    );

    expect(result.ok && result.value).toMatchObject({ dryRun: true, created: 1, updated: 0, selected: 1 });
    const variants = await store.listVariants('fp-dry-run');
    expect(variants.ok && variants.value).toHaveLength(1);
    expect(await store.getExplicitSelectedConfigId('fp-dry-run')).toEqual({ ok: true, value: sourceConfigId });
    expect(await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: '', dryRun: true, select: true },
    )).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('counts duplicate identities as one create followed by an update and keeps the last translation', async () => {
    const store = new InMemoryGlobalCatalogStore();
    const fs = new InMemoryFileSystem('/work');
    await seed(store, fs, 'fp-duplicate', 'duplicate.mp4');
    fs.addFile('/work/duplicate.ndjson', {
      content: [
        JSON.stringify(translationRow('fp-duplicate', 'Pierwszy opis')),
        JSON.stringify(translationRow('fp-duplicate', 'Ostatni opis')),
      ].join('\n'),
    });

    const result = await importTranslationVariants(
      { globalCatalog: store, fs },
      { ndjsonPath: '/work/duplicate.ndjson', dryRun: false, select: true },
    );

    expect(result.ok && result.value).toMatchObject({ total: 2, created: 1, updated: 1 });
    if (!result.ok) throw new Error(result.error.message);
    const importedConfigId = result.value.rows[0]?.configId;
    if (importedConfigId === undefined || importedConfigId === null) throw new Error('Expected imported config id');
    const imported = await store.getVariant('fp-duplicate', importedConfigId);
    expect(imported.ok && imported.value?.description).toBe('Ostatni opis');
  });
});
