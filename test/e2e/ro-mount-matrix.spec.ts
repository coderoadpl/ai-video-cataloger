import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { SqlJsGlobalCatalogStore } from '../../adapters/db/index.js';
import { type AppError, type Result } from '../../core/domain/index.js';
import { addSampleTo, runCli } from './helpers.js';
import { matrixAllowsSkip, missingLegMessage, systemOllamaModelMissingReason } from './matrix-support.js';
import {
  createReadOnlyMount,
  describeTree,
  diskImageUnavailableReason,
  probeReadOnlyWriteRejection,
  releaseReadOnlyMount,
  treeDifference,
} from './ro-mount.js';
import { SAMPLES, type VideoSample } from './samples.js';

test.describe.configure({ mode: 'serial' });

const DETECTION_CELL = 'ro-mount × index-only detection';
const ANALYSIS_CELL = 'ro-mount × local-system × skip';
const LIBRARY_TRASH_CELL = 'ro-mount × library trash read-only refusal';
const MATRIX_MODEL = 'gemma3:4b';
const DETECTION_TIMEOUT_MS = 300_000;
const ANALYSIS_TIMEOUT_MS = 1_800_000;

const failOrSkip = (cell: string, reason: string): never => {
  const message = missingLegMessage(cell, reason);
  if (matrixAllowsSkip(process.env.E2E_MATRIX_ALLOW_SKIP)) test.skip(true, message);
  throw new Error(message);
};

const sampleById = (id: string): VideoSample => {
  const sample = SAMPLES.find((candidate) => candidate.id === id);
  if (sample === undefined) throw new Error(`Missing sample: ${id}`);
  return sample;
};

const expectResult = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
};

const populateClips = async (root: string): Promise<void> => {
  const clipsDirectory = join(root, 'clips');
  mkdirSync(clipsDirectory, { recursive: true });
  const fileName = await addSampleTo(clipsDirectory, sampleById('bbb'));
  // ExFAT cannot hold the fixture's macOS xattrs, so the copy leaves a `._<name>`
  // AppleDouble sidecar; remove it so the mount holds only the one clip we asked for.
  const sidecar = join(clipsDirectory, `._${fileName}`);
  if (existsSync(sidecar)) unlinkSync(sidecar);
};

const populateTrashClip = async (root: string): Promise<void> => {
  const clipsDirectory = join(root, 'clips');
  mkdirSync(clipsDirectory, { recursive: true });
  writeFileSync(join(clipsDirectory, 'readonly-trash.mp4'), Buffer.from([1]));
};

const roHome = (): string => mkdtempSync(join(tmpdir(), 'avc-ro-home-'));

const roEnvironment = (home: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
  ...overrides,
  HOME: home,
  USERPROFILE: home,
  AVC_HOME_DIRECTORY: home,
});

const detectionScanOutputSchema = z.object({
  videos: z.array(z.object({
    filename: z.string(),
    status: z.string(),
  })),
  summary: z.object({
    total: z.number(),
    tracked: z.number(),
  }).passthrough(),
}).passthrough();

const catalogSnapshotSkippedDataSchema = z.object({
  folder: z.string(),
  reason: z.literal('folder_read_only'),
}).passthrough();

const processDriveCompletedDataSchema = z.object({
  filesTotal: z.number(),
  filesDone: z.number(),
  filesSkipped: z.number(),
  filesFailed: z.number(),
  foldersDone: z.number(),
}).passthrough();

const runSummaryLineSchema = z.object({
  type: z.literal('run-summary'),
  snapshotSkipped: z.number(),
}).passthrough();

const findRunSummarySnapshotSkipped = (jsonValues: readonly unknown[]): number => {
  const match = jsonValues.find((value) => runSummaryLineSchema.safeParse(value).success);
  return runSummaryLineSchema.parse(match).snapshotSkipped;
};

const analysisScanOutputSchema = z.object({
  videos: z.array(z.object({
    filename: z.string(),
    status: z.string(),
    artifacts: z.object({
      framePaths: z.array(z.string()).nullable(),
      summaryPath: z.string().nullable(),
      newFilename: z.string().nullable(),
      summary: z.object({ description: z.string() }).nullable(),
    }),
  })),
}).passthrough();

const findRawScanOutput = (jsonValues: readonly unknown[]): z.infer<typeof detectionScanOutputSchema> => {
  const match = jsonValues.find((value) => detectionScanOutputSchema.safeParse(value).success);
  return detectionScanOutputSchema.parse(match);
};

const targetReadOnlyErrorSchema = z.object({
  type: z.literal('error'),
  code: z.literal('TARGET_READ_ONLY'),
  data: z.object({
    roots: z.array(z.string()),
  }).passthrough(),
}).passthrough();

const seedTrashCatalog = async (home: string, entries: readonly {
  folderId: string;
  root: string;
  displayName: string;
  fingerprint: string;
  fileName: string;
}[]): Promise<void> => {
  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  try {
    for (const entry of entries) {
      expectResult(await globalCatalog.upsertFolder({
        folderId: entry.folderId,
        currentPath: entry.root,
        displayName: entry.displayName,
        firstSeenAt: '2026-08-16T12:00:00.000Z',
        lastSeenAt: '2026-08-16T12:00:00.000Z',
      }));
      expectResult(await globalCatalog.upsertFile({
        fingerprint: entry.fingerprint,
        folderId: entry.folderId,
        fileName: entry.fileName,
        size: 1,
        durationS: null,
        width: null,
        height: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: '2026-08-16T12:00:00.000Z',
        analyzer: 'harness',
        model: 'catalog-fixture',
        missingAt: null,
        hiddenAt: null,
        capturedAt: '2026-08-16T12:00:00.000Z',
        capturedAtSource: 'container',
        gpsSource: null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        place: null,
      }));
      expectResult(await globalCatalog.upsertAnalysis({
        fingerprint: entry.fingerprint,
        finalName: null,
        description: `A fixture clip named ${entry.fileName}.`,
        transcript: null,
        language: 'en',
        tags: [],
      }));
    }
  } finally {
    expectResult(await globalCatalog.dispose());
  }
};

const catalogFileExists = async (home: string, fingerprint: string): Promise<boolean> => {
  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  try {
    const file = await globalCatalog.getFile(fingerprint);
    expectResult(file);
    return file.value !== null;
  } finally {
    expectResult(await globalCatalog.dispose());
  }
};

test(DETECTION_CELL, async () => {
  test.setTimeout(DETECTION_TIMEOUT_MS);
  const unavailable = diskImageUnavailableReason();
  if (unavailable !== null) {
    if (process.platform !== 'darwin') failOrSkip(DETECTION_CELL, unavailable);
    throw new Error(missingLegMessage(DETECTION_CELL, unavailable));
  }

  const mount = await createReadOnlyMount({ tag: 'ro-detection', populate: populateClips });
  const home = roHome();
  const environment = roEnvironment(home);
  const clips = join(mount.mountpoint, 'clips');
  try {
    const before = describeTree(mount.mountpoint);

    const rejection = probeReadOnlyWriteRejection(clips);
    console.log(`${DETECTION_CELL}: write rejection errno = ${rejection}`);
    expect(['ENOENT', 'EROFS']).toContain(rejection);

    const scan = await runCli(['scan', clips, '--json'], home, 120_000, environment);
    expect(scan.code, scan.stderr).toBe(0);
    const scanOutput = findRawScanOutput(scan.jsonValues);
    expect(scanOutput.videos).toHaveLength(1);
    expect(scanOutput.videos[0]?.filename).toBe('BigBuckBunny480p30s.mp4');
    expect(scanOutput.videos[0]?.status).toBe('not_tracked');
    expect(scanOutput.summary.total).toBe(1);
    expect(scanOutput.summary.tracked).toBe(0);

    const check = await runCli(['check', clips, '--json'], home, 120_000, environment);
    expect(check.code, check.stderr).toBe(0);

    expect(existsSync(join(clips, '.ai-video-cataloger'))).toBe(false);
    expect(treeDifference(before, describeTree(mount.mountpoint))).toEqual([]);
  } finally {
    releaseReadOnlyMount(mount);
    rmSync(home, { recursive: true, force: true });
  }
});

test(ANALYSIS_CELL, async () => {
  test.setTimeout(ANALYSIS_TIMEOUT_MS);
  const unavailable = diskImageUnavailableReason();
  if (unavailable !== null) {
    if (process.platform !== 'darwin') failOrSkip(ANALYSIS_CELL, unavailable);
    throw new Error(missingLegMessage(ANALYSIS_CELL, unavailable));
  }
  const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const missing = await systemOllamaModelMissingReason(baseUrl, MATRIX_MODEL);
  if (missing !== null) failOrSkip(ANALYSIS_CELL, missing);

  const mount = await createReadOnlyMount({ tag: 'ro-analysis', populate: populateClips });
  const home = roHome();
  const environment = roEnvironment(home, { OLLAMA_HOST: baseUrl });
  const clips = join(mount.mountpoint, 'clips');
  try {
    for (const [key, value] of [
      ['analyzer_backend', 'local'],
      ['local_model', MATRIX_MODEL],
      ['whisper_mode', 'skip'],
      ['frames', '1'],
    ] as const) {
      const configured = await runCli(['config', 'set', key, value, '--json'], home, 60_000, environment);
      expect(configured.code, `${ANALYSIS_CELL} config set ${key}: ${configured.stderr}`).toBe(0);
    }

    const before = describeTree(mount.mountpoint);

    const runDrive = async (): Promise<Awaited<ReturnType<typeof runCli>>> =>
      runCli(
        ['process-drive', mount.mountpoint, '--frames', '1', '--whisper', 'skip', '--timeout', '900', '--json'],
        home,
        ANALYSIS_TIMEOUT_MS,
        environment,
      );

    const run = await runDrive();
    const runErrors = run.events
      .filter((event) => event.type === 'error')
      .map((event) => event.error ?? event.message ?? event.code ?? 'unknown error');
    expect(run.code, `${ANALYSIS_CELL}: ${runErrors.join(' | ')}\n${run.stderr}`).toBe(0);
    expect(run.events.filter((event) => event.type === 'error')).toEqual([]);
    expect(run.events[0]?.type).toBe('started');

    const snapshotSkippedEvent = run.events.find((event) => event.step === 'catalog_snapshot_skipped');
    expect(snapshotSkippedEvent, run.stdout).toBeDefined();
    catalogSnapshotSkippedDataSchema.parse(snapshotSkippedEvent?.data);

    expect(run.events.some((event) => event.step === 'skipping_rename')).toBe(true);

    const completedEvent = run.events.find((event) => event.type === 'completed');
    const completedData = processDriveCompletedDataSchema.parse(completedEvent?.data);
    expect(completedData.filesTotal).toBe(1);
    expect(completedData.filesDone).toBe(1);
    expect(completedData.filesFailed).toBe(0);
    expect(completedData.foldersDone).toBe(1);
    expect(findRunSummarySnapshotSkipped(run.jsonValues)).toBeGreaterThanOrEqual(1);

    const mirrorsRoot = join(home, '.ai-video-cataloger', 'read-only-folders');
    const mirrors = readdirSync(mirrorsRoot);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatch(/^path-[0-9a-f]{8}$/);
    const mirror = join(mirrorsRoot, mirrors[0] ?? '');

    const summaryTextPath = join(mirror, 'summaries', 'BigBuckBunny480p30s.txt');
    expect(existsSync(summaryTextPath)).toBe(true);
    const summaryJsonPath = join(mirror, 'summaries', 'BigBuckBunny480p30s.json');
    expect(existsSync(summaryJsonPath)).toBe(true);

    const frameFiles = readdirSync(join(mirror, 'frames', 'BigBuckBunny480p30s')).filter((name) => name.endsWith('.jpg'));
    expect(frameFiles.length).toBeGreaterThanOrEqual(1);

    expect(existsSync(join(home, '.ai-video-cataloger', 'catalog.db'))).toBe(true);

    const scan = await runCli(['scan', clips, '--json'], home, 120_000, environment);
    expect(scan.code, scan.stderr).toBe(0);
    const scanOutput = analysisScanOutputSchema.parse(
      scan.jsonValues.find((value) => analysisScanOutputSchema.safeParse(value).success),
    );
    const video = scanOutput.videos[0];
    expect(video).toBeDefined();
    expect(video?.status).toBe('completed');
    expect(video?.artifacts.newFilename).toBeNull();
    expect(video?.artifacts.summaryPath?.startsWith(mirrorsRoot)).toBe(true);
    expect(video?.artifacts.framePaths?.length ?? 0).toBeGreaterThan(0);
    for (const framePath of video?.artifacts.framePaths ?? []) {
      expect(framePath.startsWith(mirrorsRoot)).toBe(true);
    }
    expect(video?.artifacts.summary?.description.length ?? 0).toBeGreaterThan(0);
    expect(video?.filename).toBe('BigBuckBunny480p30s.mp4');

    const rerun = await runDrive();
    const rerunErrors = rerun.events
      .filter((event) => event.type === 'error')
      .map((event) => event.error ?? event.message ?? event.code ?? 'unknown error');
    expect(rerun.code, `${ANALYSIS_CELL} second run: ${rerunErrors.join(' | ')}\n${rerun.stderr}`).toBe(0);
    const rerunCompletedEvent = rerun.events.find((event) => event.type === 'completed');
    const rerunData = processDriveCompletedDataSchema.parse(rerunCompletedEvent?.data);
    expect(rerunData.filesDone).toBe(0);
    expect(rerunData.filesSkipped).toBe(1);
    expect(rerunData.filesFailed).toBe(0);

    expect(treeDifference(before, describeTree(mount.mountpoint))).toEqual([]);
    expect(existsSync(join(clips, '.ai-video-cataloger'))).toBe(false);
  } finally {
    releaseReadOnlyMount(mount);
    rmSync(home, { recursive: true, force: true });
  }
});

test(LIBRARY_TRASH_CELL, async () => {
  test.setTimeout(DETECTION_TIMEOUT_MS);
  const unavailable = diskImageUnavailableReason();
  if (unavailable !== null) {
    if (process.platform !== 'darwin') failOrSkip(LIBRARY_TRASH_CELL, unavailable);
    throw new Error(missingLegMessage(LIBRARY_TRASH_CELL, unavailable));
  }

  const mount = await createReadOnlyMount({ tag: 'ro-library-trash', populate: populateTrashClip });
  const home = roHome();
  const environment = roEnvironment(home);
  const readOnlyRoot = join(mount.mountpoint, 'clips');
  const writableRoot = mkdtempSync(join(tmpdir(), 'avc-trash-writable-'));
  const writablePath = join(writableRoot, 'writable-trash.mp4');
  writeFileSync(writablePath, Buffer.from([2]));
  try {
    await seedTrashCatalog(home, [
      {
        folderId: '44444444-4444-4444-8444-444444444444',
        root: writableRoot,
        displayName: 'Writable Trash Fixture',
        fingerprint: 'fp-trash-writable',
        fileName: 'writable-trash.mp4',
      },
      {
        folderId: '55555555-5555-4555-8555-555555555555',
        root: readOnlyRoot,
        displayName: 'Read Only Trash Fixture',
        fingerprint: 'fp-trash-readonly',
        fileName: 'readonly-trash.mp4',
      },
    ]);

    const before = describeTree(mount.mountpoint);
    const result = await runCli(
      [
        'library',
        'trash',
        '--fingerprint',
        'fp-trash-writable',
        '--fingerprint',
        'fp-trash-readonly',
        '--yes',
        '--json',
      ],
      home,
      120_000,
      environment,
    );
    expect(result.code, `${LIBRARY_TRASH_CELL}: ${result.stdout}\n${result.stderr}`).toBe(46);
    const error = targetReadOnlyErrorSchema.parse(
      result.jsonValues.find((value) => targetReadOnlyErrorSchema.safeParse(value).success),
    );
    expect(error.data.roots).toContain(readOnlyRoot);
    expect(existsSync(writablePath)).toBe(true);
    expect(existsSync(join(readOnlyRoot, 'readonly-trash.mp4'))).toBe(true);
    await expect.poll(() => catalogFileExists(home, 'fp-trash-writable')).toBe(true);
    await expect.poll(() => catalogFileExists(home, 'fp-trash-readonly')).toBe(true);
    expect(treeDifference(before, describeTree(mount.mountpoint))).toEqual([]);
  } finally {
    releaseReadOnlyMount(mount);
    rmSync(home, { recursive: true, force: true });
    rmSync(writableRoot, { recursive: true, force: true });
  }
});
