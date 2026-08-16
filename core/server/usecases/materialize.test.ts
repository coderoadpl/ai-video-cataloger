import { describe, expect, it } from 'vitest';

import {
  appError,
  configDescriptorSchema,
  configId,
  derivedFolderId,
  type AppError,
  type CatalogFile,
  type CatalogVariant,
  type ConfigDescriptor,
  type Result,
} from '@core/domain/index.js';

import { readOnlyArtifactRootById } from './artifact-root.js';
import { sharedArtifactPaths, variantOutputPaths } from './artifact-store.js';
import { materializeCatalog } from './materialize.js';
import {
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
} from '../../../test/server/usecases/test-fakes.js';
import type { JobExecutionContext, JobProgress } from '../ports.js';

const folder = '/work/folder';
const videoPath = `${folder}/clip.mp4`;
const fingerprint = 'fp-clip-1';
const mtimeMs = new Date('2026-01-02T12:00:00.000Z').getTime();
const idleSignal = new AbortController().signal;

const descriptor: ConfigDescriptor = configDescriptorSchema.parse({
  family: 'local',
  providerId: 'local',
  modelTag: 'gemma3:12b',
  whisper_mode: 'skip',
  frames: 3,
  output_language: 'en',
  promptVersion: 1,
});
const cfgId = configId(descriptor);

interface Fixture {
  fs: InMemoryFileSystem;
  globalCatalog: InMemoryGlobalCatalogStore;
  originalFolderId: string;
  mirrorPath: string;
}

interface SeedOptions {
  finalName?: string | null;
  withSummaryArtifact?: boolean;
  withFrames?: boolean;
  fs?: InMemoryFileSystem;
  globalCatalog?: InMemoryGlobalCatalogStore;
}

const seedFixture = async (options: SeedOptions = {}): Promise<Fixture> => {
  const fs = options.fs ?? new InMemoryFileSystem('/work');
  const globalCatalog = options.globalCatalog ?? new InMemoryGlobalCatalogStore();
  const originalFolderId = derivedFolderId(fs.resolve(folder));
  const mirrorRoot = readOnlyArtifactRootById(fs, originalFolderId);

  fs.addFile(videoPath, { content: 'video-bytes', hash: fingerprint, size: 2048, mtimeMs });

  const withSummary = options.withSummaryArtifact ?? true;
  if (withSummary) {
    const outputs = variantOutputPaths(fs, mirrorRoot, fingerprint, cfgId);
    const shared = sharedArtifactPaths(fs, mirrorRoot, fingerprint, descriptor);
    fs.addFile(outputs.summaryJsonPath, {
      content: JSON.stringify({
        schemaVersion: 1,
        description: 'A walk on the beach',
        suggestedFilename: 'Beach Walk',
        fullAnalysis: 'Full analysis text',
        tags: ['beach'],
        analyzedAt: '2026-01-02T10:00:00.000Z',
      }),
    });
    fs.addFile(outputs.summaryPath, { content: 'Summary text' });
    fs.addFile(outputs.debugLogPath, { content: 'debug' });
    fs.addFile(shared.transcriptPath, { content: 'transcript' });
    if (shared.framesDirectory !== null && (options.withFrames ?? true)) {
      fs.addFile(fs.join(shared.framesDirectory, 'frame-001.jpg'), { content: 'jpg-frame' });
    }
    fs.addFile(fs.join(mirrorRoot.catalogDirectory, 'thumbnails', 'clip.jpg'), { content: 'jpg-bytes' });
  }

  await globalCatalog.upsertFolder({
    folderId: originalFolderId,
    currentPath: folder,
    displayName: 'folder',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  });
  const file: CatalogFile = {
    fingerprint,
    folderId: originalFolderId,
    fileName: 'clip.mp4',
    size: 2048,
    durationS: null,
    width: null,
    height: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-01-01T00:00:00.000Z',
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
  };
  await globalCatalog.upsertFile(file);
  const variant: CatalogVariant = {
    fingerprint,
    configId: cfgId,
    descriptor,
    finalName: options.finalName === undefined ? null : options.finalName,
    description: 'A walk on the beach',
    transcript: null,
    language: 'en',
    tags: ['beach'],
    analyzer: 'local',
    model: 'gemma3:12b',
    createdAt: '2026-01-01T00:00:00.000Z',
    usage: null,
    resolvedOutputLanguage: null,
    resolvedTagLanguage: null,
  };
  await globalCatalog.upsertVariant(variant);
  await globalCatalog.setSelectedVariant(fingerprint, cfgId);

  return { fs, globalCatalog, originalFolderId, mirrorPath: mirrorRoot.catalogDirectory };
};

class RecordingFileSystem extends InMemoryFileSystem {
  constructor(private readonly calls: string[]) {
    super('/work');
  }

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    if (to.endsWith('.mp4')) this.calls.push('rename_video');
    return super.renamePath(from, to);
  }
}

class RecordingGlobalCatalog extends InMemoryGlobalCatalogStore {
  constructor(private readonly calls: string[]) {
    super();
  }

  override upsertVariant(variant: CatalogVariant): Promise<Result<void, AppError>> {
    this.calls.push('catalog_final_name');
    return super.upsertVariant(variant);
  }

  override relocateFile(fingerprint: string, folderId: string, fileName: string): Promise<Result<void, AppError>> {
    this.calls.push('catalog_relocate');
    return super.relocateFile(fingerprint, folderId, fileName);
  }
}

class UnreadableVariantsCatalog extends InMemoryGlobalCatalogStore {
  override listVariants(): Promise<Result<CatalogVariant[], AppError>> {
    return Promise.resolve({ ok: false, error: appError('internal', 'Variant listing failed') });
  }
}

const snapshotFs = (fs: InMemoryFileSystem): unknown => fs.snapshot();

const events = (progress: JobProgress[]): JobExecutionContext => ({
  signal: idleSignal,
  reportProgress: (event) => {
    progress.push(event);
    return Promise.resolve({ ok: true, value: undefined });
  },
});

describe('materializeCatalog', () => {
  it('applies the full write set once and never creates a per-folder catalog.db', async () => {
    const { fs, globalCatalog } = await seedFixture();
    const progress: JobProgress[] = [];

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false }, events(progress));

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary).toMatchObject({
      filesMaterialized: 1,
      filesUnchanged: 0,
      filesSkipped: 0,
      filesFailed: 0,
      collisions: 0,
    });

    const newPath = `${folder}/2026-01-02_beach-walk.mp4`;
    expect(await fs.isFile(newPath)).toEqual({ ok: true, value: true });
    expect(await fs.isFile(videoPath)).toEqual({ ok: true, value: false });
    expect(await fs.isFile(fs.join(folder, '.ai-video-cataloger', 'folder-id'))).toEqual({ ok: true, value: true });
    expect(await fs.isFile(fs.join(folder, '.ai-video-cataloger', 'catalog.ndjson'))).toEqual({ ok: true, value: true });
    expect(await fs.isFile(fs.join(folder, '.ai-video-cataloger', 'catalog.db'))).toEqual({ ok: true, value: false });
    expect(await fs.isFile(fs.join(folder, '.ai-video-cataloger', 'variants', fingerprint, cfgId, 'summary.json'))).toEqual({ ok: true, value: true });
    expect(await fs.isFile(fs.join(folder, 'summaries', '2026-01-02_beach-walk.json'))).toEqual({ ok: true, value: true });
    expect(await fs.isFile(fs.join(folder, 'transcripts', '2026-01-02_beach-walk.txt'))).toEqual({ ok: true, value: true });
    expect(await fs.isFile(fs.join(folder, '.ai-video-cataloger', 'thumbnails', '2026-01-02_beach-walk.jpg'))).toEqual({ ok: true, value: true });

    const storedFile = await globalCatalog.getFile(fingerprint);
    expect(storedFile.ok && storedFile.value?.fileName).toBe('2026-01-02_beach-walk.mp4');
    const storedVariant = await globalCatalog.getVariant(fingerprint, cfgId);
    expect(storedVariant.ok && storedVariant.value?.finalName).toBe('2026-01-02_beach-walk.mp4');

    const fileEvent = progress.find((event) => event.step === 'materialize_file');
    expect(fileEvent?.data).toMatchObject({
      finalName: '2026-01-02_beach-walk.mp4',
      appliedName: '2026-01-02_beach-walk.mp4',
      collision: false,
      changed: true,
      dryRun: false,
    });
    expect(fileEvent?.data).toMatchObject({
      operations: ['artifact_store', 'catalog_final_name', 'rename_video', 'catalog_relocate', 'project_selected', 'copy_thumbnail'],
    });
  });

  it('P6: never writes a timeline-sourced coordinate into the media file', async () => {
    const { fs, globalCatalog, originalFolderId } = await seedFixture();
    await globalCatalog.upsertFile({
      fingerprint,
      folderId: originalFolderId,
      fileName: 'clip.mp4',
      size: 2048,
      durationS: null,
      width: null,
      height: null,
      gpsLat: 10.5,
      gpsLon: 20.5,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'local',
      model: 'gemma3:12b',
      missingAt: null,
      capturedAt: '2026-01-02T09:35:11.000Z',
      capturedAtSource: 'container',
      gpsSource: 'timeline',
      gpsAccuracyM: 150,
      gpsIntervalKind: 'visit',
      gpsResolvedAt: '2026-01-03T00:00:00.000Z',
      place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 120, dataset: 'test-dataset' },
    });
    const before = await fs.readTextFile(videoPath);

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    expect(result.value.filesMaterialized).toBe(1);
    const after = await fs.readTextFile(`${folder}/2026-01-02_beach-walk.mp4`);
    expect(before).toEqual({ ok: true, value: 'video-bytes' });
    expect(after).toEqual(before);
    const stored = await globalCatalog.getFile(fingerprint);
    expect(stored.ok && stored.value?.gpsSource).toBe('timeline');
  });

  it('is a no-op on a second run', async () => {
    const { fs, globalCatalog } = await seedFixture();
    const first = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });
    expect(first.ok).toBe(true);
    const snapshotAfterFirst = snapshotFs(fs);

    const second = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });
    if (!second.ok) throw new Error(`${second.error.code}: ${second.error.message}`);
    const summary = second.value;
    expect(summary).toMatchObject({ filesMaterialized: 0, filesUnchanged: 1, filesSkipped: 0, filesFailed: 0 });
    expect(snapshotFs(fs)).toEqual(snapshotAfterFirst);
  });

  it('--dry-run writes nothing and reports the full plan', async () => {
    const { fs, globalCatalog } = await seedFixture();
    const before = snapshotFs(fs);
    const countsBefore = await globalCatalog.counts();
    const progress: JobProgress[] = [];

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: true }, events(progress));

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary).toMatchObject({ dryRun: true, filesMaterialized: 1, filesUnchanged: 0, filesSkipped: 0 });
    expect(snapshotFs(fs)).toEqual(before);
    const countsAfter = await globalCatalog.counts();
    expect(countsAfter).toEqual(countsBefore);

    const fileEvent = progress.find((event) => event.step === 'materialize_file');
    expect(fileEvent?.data).toMatchObject({
      dryRun: true,
      operations: ['artifact_store', 'catalog_final_name', 'rename_video', 'catalog_relocate', 'project_selected', 'copy_thumbnail'],
    });
  });

  it('resolves a name collision with a numeric suffix and never overwrites', async () => {
    const { fs, globalCatalog } = await seedFixture();
    fs.addFile(`${folder}/2026-01-02_beach-walk.mp4`, { content: 'someone-elses-video', hash: 'other-fp' });

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary.collisions).toBe(1);
    expect(await fs.isFile(`${folder}/2026-01-02_beach-walk-2.mp4`)).toEqual({ ok: true, value: true });
    const planted = await fs.readTextFile(`${folder}/2026-01-02_beach-walk.mp4`);
    expect(planted).toEqual({ ok: true, value: 'someone-elses-video' });
  });

  it('skips a file with no catalog entry as not_in_catalog, without renaming or writing to it', async () => {
    const fs = new InMemoryFileSystem('/work');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    fs.addFile(videoPath, { content: 'video-bytes', hash: 'unknown-fp' });
    const progress: JobProgress[] = [];

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false }, events(progress));

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary).toMatchObject({ filesSkipped: 1, skipped: { notInCatalog: 1, noVariant: 0, noFinalName: 0, fingerprintUnavailable: 0, duplicate: 0 } });
    expect(await fs.isFile(videoPath)).toEqual({ ok: true, value: true });
    const skipEvent = progress.find((event) => event.step === 'file-skipped');
    expect(skipEvent?.data).toMatchObject({ reason: 'not_in_catalog' });
  });

  it('skips a file whose fingerprint is unavailable', async () => {
    const fs = new InMemoryFileSystem('/work');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    fs.addFile(videoPath, { content: 'video-bytes' });

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary.skipped.fingerprintUnavailable).toBe(1);
  });

  it('skips a file with a variant but no derivable final name', async () => {
    const { fs, globalCatalog } = await seedFixture({ withSummaryArtifact: false });

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary.skipped.noFinalName).toBe(1);
    expect(await fs.isFile(videoPath)).toEqual({ ok: true, value: true });
  });

  it('skips a duplicate whose canonical copy already exists elsewhere', async () => {
    const { fs, globalCatalog } = await seedFixture({ finalName: '2026-01-02_beach-walk.mp4' });
    const otherFolder = '/work/other';
    const otherPath = `${otherFolder}/clip-copy.mp4`;
    fs.addFile(otherPath, { content: 'video-bytes', hash: fingerprint });

    const canonicalFolder = await globalCatalog.getFolder(derivedFolderId(fs.resolve(folder)));
    expect(canonicalFolder.ok && canonicalFolder.value !== null).toBe(true);

    const result = await materializeCatalog({ fs, globalCatalog }, { root: otherFolder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary.skipped.duplicate).toBe(1);
    expect(await fs.isFile(otherPath)).toEqual({ ok: true, value: true });
  });

  it('aborts with target_read_only when the folder is not writable in apply mode', async () => {
    const { fs, globalCatalog } = await seedFixture();
    fs.markReadOnly(folder);

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'target_read_only' } });
  });

  it('keeps planning under --dry-run when the folder is still read-only, and counts it', async () => {
    const { fs, globalCatalog } = await seedFixture();
    fs.markReadOnly(folder);

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: true });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const summary = result.value;
    expect(summary.foldersNotWritable).toBe(1);
    expect(summary.filesMaterialized).toBe(1);
  });

  it('cancels mid-run without touching files after the cancellation point', async () => {
    const fs = new InMemoryFileSystem('/work');
    const globalCatalog = new InMemoryGlobalCatalogStore();
    const secondVideoPath = `${folder}/clip-2.mp4`;
    fs.addFile(videoPath, { content: 'video-bytes', hash: 'unknown-fp-1' });
    fs.addFile(secondVideoPath, { content: 'video-bytes-2', hash: 'unknown-fp-2' });
    const controller = new AbortController();

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false }, {
      signal: controller.signal,
      reportProgress: (event) => {
        if (event.step === 'file-skipped') controller.abort();
        return Promise.resolve({ ok: true, value: undefined });
      },
    });

    expect(result).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
  });

  it('writes the catalog final name before the rename and the file name after it', async () => {
    const calls: string[] = [];
    const fs = new RecordingFileSystem(calls);
    const globalCatalog = new RecordingGlobalCatalog(calls);
    await seedFixture({ fs, globalCatalog });
    calls.length = 0;

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(['catalog_final_name', 'rename_video', 'catalog_relocate']);
  });

  it('maps a write blocked by a read-only subtree to target_read_only', async () => {
    const { fs, globalCatalog } = await seedFixture();
    fs.markReadOnly(`${folder}/summaries`);

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'target_read_only' } });
  });

  it('projects the selected variant when the mirror holds no frames', async () => {
    const { fs, globalCatalog } = await seedFixture({ withFrames: false });

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    expect(result.value).toMatchObject({ filesMaterialized: 1, filesFailed: 0 });
    expect(await fs.isFile(fs.join(folder, 'summaries', '2026-01-02_beach-walk.json'))).toEqual({ ok: true, value: true });
    expect(await fs.isDirectory(fs.join(folder, 'frames', '2026-01-02_beach-walk'))).toEqual({ ok: true, value: false });
  });

  it('aborts with drive_run_aborted after five consecutive file failures', async () => {
    const globalCatalog = new UnreadableVariantsCatalog();
    const { fs } = await seedFixture({ globalCatalog, finalName: '2026-01-02_beach-walk.mp4' });
    for (let index = 2; index <= 5; index += 1) {
      const extraFingerprint = `${fingerprint}-${index}`;
      fs.addFile(`${folder}/clip-${index}.mp4`, { content: `video-${index}`, hash: extraFingerprint, size: 2048, mtimeMs });
      await globalCatalog.upsertFile({
        fingerprint: extraFingerprint,
        folderId: derivedFolderId(fs.resolve(folder)),
        fileName: `clip-${index}.mp4`,
        size: 2048,
        durationS: null,
        width: null,
        height: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: '2026-01-01T00:00:00.000Z',
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
      await globalCatalog.upsertVariant({
        fingerprint: extraFingerprint,
        configId: cfgId,
        descriptor,
        finalName: `2026-01-02_beach-walk-${index}.mp4`,
        description: 'A walk on the beach',
        transcript: null,
        language: 'en',
        tags: ['beach'],
        analyzer: 'local',
        model: 'gemma3:12b',
        createdAt: '2026-01-01T00:00:00.000Z',
        usage: null,
        resolvedOutputLanguage: null,
        resolvedTagLanguage: null,
      });
      await globalCatalog.setSelectedVariant(extraFingerprint, cfgId);
    }
    const progress: JobProgress[] = [];

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false }, events(progress));

    expect(result).toMatchObject({ ok: false, error: { code: 'drive_run_aborted' } });
    expect(progress.find((event) => event.step === 'run-summary')?.data).toMatchObject({ filesFailed: 5 });
  });

  it('returns drive_root_empty when the root has no catalog folders', async () => {
    const fs = new InMemoryFileSystem('/work');
    fs.addDirectory(folder);
    const globalCatalog = new InMemoryGlobalCatalogStore();

    const result = await materializeCatalog({ fs, globalCatalog }, { root: folder, dryRun: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'drive_root_empty' } });
  });
});
