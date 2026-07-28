import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NodeFileSystemPort } from '@adapters/fs/index.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/index.js';
import {
  configDescriptorSchema,
  configId,
  derivedFolderId,
  type AppError,
  type CatalogVariant,
  type Result,
} from '@core/domain/index.js';
import { variantArtifactPaths } from '@core/server/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

interface VariantFixture {
  videoPath: string;
  firstConfigId: string;
  secondConfigId: string;
}

const requiredValue = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const seedVariants = async (folder: string, home: string): Promise<VariantFixture> => {
  const videoPath = join(folder, 'clip.mp4');
  writeFileSync(videoPath, Buffer.alloc(2048, 1));
  const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
  const fingerprint = requiredValue(await fs.partialContentHash(videoPath));
  if (fingerprint === null) throw new Error('Expected a video fingerprint');
  const folderId = derivedFolderId(folder);
  const firstDescriptor = configDescriptorSchema.parse({
    family: 'local',
    providerId: 'local',
    modelTag: 'gemma3:12b',
    whisper_mode: 'local',
    whisper_model: 'base',
    frames: 3,
    output_language: 'en',
    promptVersion: 1,
  });
  const secondDescriptor = configDescriptorSchema.parse({
    ...firstDescriptor,
    output_language: 'pl',
  });
  const firstConfigId = configId(firstDescriptor);
  const secondConfigId = configId(secondDescriptor);
  const baseVariant = {
    fingerprint,
    finalName: null,
    transcript: 'Shared transcript',
    analyzer: 'local',
    model: 'gemma3:12b',
    usage: null,
  };
  const variants: CatalogVariant[] = [
    {
      ...baseVariant,
      configId: firstConfigId,
      descriptor: firstDescriptor,
      description: 'English description',
      language: 'en',
      tags: ['english'],
      createdAt: '2026-08-02T10:00:00.000Z',
    },
    {
      ...baseVariant,
      configId: secondConfigId,
      descriptor: secondDescriptor,
      description: 'Polski opis',
      language: 'pl',
      tags: ['polski'],
      createdAt: '2026-08-02T11:00:00.000Z',
      usage: { estimatedCostUsd: 0.0123 },
    },
  ];
  const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  requiredValue(await store.upsertFolder({
    folderId,
    currentPath: folder,
    displayName: 'fixture',
    firstSeenAt: '2026-08-02T09:00:00.000Z',
    lastSeenAt: '2026-08-02T11:00:00.000Z',
  }));
  requiredValue(await store.upsertFile({
    fingerprint,
    folderId,
    fileName: 'clip.mp4',
    size: statSync(videoPath).size,
    durationS: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-08-02T11:00:00.000Z',
    analyzer: 'local',
    model: 'gemma3:12b',
    missingAt: null,
  }));
  for (const variant of variants) requiredValue(await store.upsertVariant(variant));
  requiredValue(await store.setSelectedVariant(fingerprint, firstConfigId));
  requiredValue(await store.setFolderDefaultVariant(folderId, firstConfigId));
  const root = { path: folder, catalogDirectory: join(folder, '.ai-video-cataloger') };
  for (const variant of variants) {
    if (variant.descriptor === null) throw new Error('Expected a descriptor');
    const paths = variantArtifactPaths(fs, root, fingerprint, variant.descriptor);
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.summaryPath, variant.description ?? '');
    writeFileSync(paths.summaryJsonPath, JSON.stringify({ description: variant.description }));
    if (paths.framesDirectory !== null) {
      mkdirSync(paths.framesDirectory, { recursive: true });
      writeFileSync(join(paths.framesDirectory, 'frame-001.jpg'), Buffer.from([1]));
    }
    mkdirSync(fs.dirname(paths.transcriptPath), { recursive: true });
    writeFileSync(paths.transcriptPath, variant.transcript ?? '');
  }
  requiredValue(await store.dispose());
  return { videoPath, firstConfigId, secondConfigId };
};

describe('variants commands', () => {
  let folder: string;
  let home: string;

  beforeEach(() => {
    folder = createTestDir();
    home = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(folder);
    cleanupTestDir(home);
  });

  it('lists one NDJSON row per variant and renders a human table', async () => {
    const fixture = await seedVariants(folder, home);
    const json = await runCli(['variants', 'list', fixture.videoPath, '--json'], { cwd: folder, env: { HOME: home } });
    const events = parseJsonEvents(json.stdout);
    const rows = events.filter((event) => typeof event.configId === 'string');

    expect(json.exitCode).toBe(0);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'variants_list' });
    expect(rows).toEqual([
      expect.objectContaining({
        configId: fixture.secondConfigId,
        descriptor: expect.objectContaining({ output_language: 'pl', promptVersion: 1 }),
        selected: false,
        analyzer: 'local',
        model: 'gemma3:12b',
        estimatedCostUsd: 0.0123,
      }),
      expect.objectContaining({
        configId: fixture.firstConfigId,
        descriptor: expect.objectContaining({ output_language: 'en', promptVersion: 1 }),
        selected: true,
        analyzer: 'local',
        model: 'gemma3:12b',
      }),
    ]);
    expect(findEvent(events, 'completed')).toMatchObject({ data: { count: 2 } });

    const human = await runCli(['variants', 'list', fixture.videoPath], { cwd: folder, env: { HOME: home } });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('SELECTED\tCONFIG\tANALYZER\tMODEL\tCREATED\tESTIMATED COST (USD)');
    expect(human.stdout).toContain(fixture.firstConfigId);
    expect(human.stdout).toContain(fixture.secondConfigId);
  });

  it('selects a variant and maps a missing variant to exit code 45', async () => {
    const fixture = await seedVariants(folder, home);
    const selected = await runCli(
      ['variants', 'select', fixture.videoPath, '--config', fixture.secondConfigId, '--json'],
      { cwd: folder, env: { HOME: home } },
    );

    expect(selected.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(selected.stdout), 'completed')).toMatchObject({
      data: { configId: fixture.secondConfigId },
    });

    const missing = await runCli(
      ['variants', 'select', fixture.videoPath, '--config', 'cfg_000000000000', '--json'],
      { cwd: folder, env: { HOME: home } },
    );
    expect(missing.exitCode).toBe(45);
    expect(findEvent(parseJsonEvents(missing.stdout), 'error')).toMatchObject({ code: 'VARIANT_NOT_FOUND' });
  });

  it('deletes one variant and refuses to delete the last survivor', async () => {
    const fixture = await seedVariants(folder, home);
    const deleted = await runCli(
      ['variants', 'delete', fixture.videoPath, '--config', fixture.secondConfigId, '--json'],
      { cwd: folder, env: { HOME: home } },
    );

    expect(deleted.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(deleted.stdout), 'completed')).toMatchObject({
      data: {
        configId: fixture.secondConfigId,
        selectedConfigId: fixture.firstConfigId,
      },
    });

    const conflict = await runCli(
      ['variants', 'delete', fixture.videoPath, '--config', fixture.firstConfigId, '--json'],
      { cwd: folder, env: { HOME: home } },
    );
    expect(conflict.exitCode).toBe(6);
    expect(findEvent(parseJsonEvents(conflict.stdout), 'error')).toMatchObject({ code: 'CONFLICT' });
  });

  it('sets and clears the folder default with lifecycle envelopes', async () => {
    const fixture = await seedVariants(folder, home);
    const set = await runCli(
      ['variants', 'default', folder, '--config', fixture.secondConfigId, '--json'],
      { cwd: folder, env: { HOME: home } },
    );

    expect(set.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(set.stdout), 'completed')).toMatchObject({
      data: { defaultConfigId: fixture.secondConfigId, resolvedConfigId: fixture.secondConfigId },
    });

    const cleared = await runCli(['variants', 'default', folder, '--clear', '--json'], {
      cwd: folder,
      env: { HOME: home },
    });
    expect(cleared.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(cleared.stdout), 'completed')).toMatchObject({
      data: { defaultConfigId: null },
    });
  });

  it('documents the variants command family without adding process matrix options', async () => {
    const variantsHelp = await runCli(['variants', '--help'], { cwd: folder, env: { HOME: home } });
    const processHelp = await runCli(['process', '--help'], { cwd: folder, env: { HOME: home } });

    expect(variantsHelp.stdout).toContain('list');
    expect(variantsHelp.stdout).toContain('select');
    expect(variantsHelp.stdout).toContain('delete');
    expect(variantsHelp.stdout).toContain('default');
    expect(processHelp.stdout).not.toContain('--config');
  });
});
