import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { HuggingFaceWhisperModelDownloader } from '../../adapters/whisper/index.js';
import { OnnxFaceEngineAdapter, createYuNetTensor, warpAlignedFaceRgb, type FaceImageIO } from '../../adapters/faces/index.js';
import { createDeps } from '../../apps/server/src/composition.js';
import { FILE_ARTIFACTS, cosineSimilarity, ok, type AppError, type Result } from '../../core/domain/index.js';
import { facesIndex } from '../../core/server/usecases/faces.js';
import type { FaceDetection } from '../../core/server/index.js';
import type { RgbFrame } from '../../adapters/ffmpeg/index.js';
import { matrixAllowsSkip, matrixHome, missingLegMessage } from './matrix-support.js';

const CELL = 'faces-real-model';
const HOME = matrixHome(process.env);
const TIMEOUT_MS = 900_000;

test.describe.configure({ mode: 'serial' });

test('real YuNet and SFace sessions on synthetic inputs', async () => {
  test.setTimeout(TIMEOUT_MS);
  const downloads = new HuggingFaceWhisperModelDownloader({ homeDirectory: HOME });
  await ensureFaceArtifacts(downloads);
  const frameRef = { current: blankFrame(320, 320) };
  const adapter = new OnnxFaceEngineAdapter({ downloads, imageIO: mutableImageIO(frameRef) });
  try {
    const loaded = await adapter.load();
    expectResult(loaded);

    frameRef.current = blankFrame(320, 320);
    const blank = await adapter.detect('/synthetic/blank.jpg');
    expectResult(blank);
    expect(blank.value).toHaveLength(0);

    frameRef.current = noiseFrame(320, 320);
    const noise = await adapter.detect('/synthetic/noise.jpg');
    expectResult(noise);
    expect(noise.value).toHaveLength(0);

    const firstCrop = alignedCrop(structuredCrop('diagonal'));
    const secondCrop = alignedCrop(structuredCrop('rings'));
    const first = await adapter.embed(firstCrop);
    const firstAgain = await adapter.embed(firstCrop);
    const second = await adapter.embed(secondCrop);
    expectResult(first);
    expectResult(firstAgain);
    expectResult(second);
    expect(norm([...first.value])).toBeCloseTo(1, 5);
    expect(norm([...second.value])).toBeCloseTo(1, 5);
    expect([...first.value].some((value) => value !== 0)).toBe(true);
    expect([...second.value].some((value) => value !== 0)).toBe(true);
    expect([...first.value]).toEqual([...firstAgain.value]);
    expect(cosineSimilarity([...first.value], [...second.value])).toBeLessThan(0.999);

    const prepared = createYuNetTensor({ width: 640, height: 320, data: new Uint8Array(640 * 320 * 3).fill(7) });
    expect(prepared.meta.scale).toBe(0.5);
    expect(prepared.meta.offsetY).toBe(80);
    const warped = warpAlignedFaceRgb(
      { width: 2, height: 2, data: new Uint8Array([0, 0, 0, 100, 0, 0, 200, 0, 0, 255, 0, 0]) },
      { a: 1, b: 0, tx: -0.5, ty: -0.5 },
      1,
      1,
    );
    expect(warped[0]).toBe(139);
  } finally {
    const disposed = await adapter.dispose();
    expectResult(disposed);
  }
});

test('optional sample video runs through facesIndex', async () => {
  test.setTimeout(TIMEOUT_MS);
  const sample = process.env.E2E_FACES_SAMPLE_VIDEO;
  if (sample === undefined || sample.length === 0) {
    test.skip(true, 'Set E2E_FACES_SAMPLE_VIDEO to run the optional real-face video leg');
    return;
  }
  if (!existsSync(sample)) failOrSkip(`sample video does not exist: ${sample}`);
  const downloads = new HuggingFaceWhisperModelDownloader({ homeDirectory: HOME });
  await ensureFaceArtifacts(downloads);
  const deps = createDeps({ homeDirectory: HOME, workingDirectory: dirname(sample) });
  await seedFacesCandidate(deps, sample);
  const enabled = await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
  expectResult(enabled);
  const accepted = await facesIndex(deps, { root: dirname(sample) });
  expectResult(accepted);
  await waitForJob(deps.jobs, accepted.value.jobId);
  const observations = await deps.globalCatalog.listFaceObservations();
  expectResult(observations);
  expect(observations.value.length).toBeGreaterThanOrEqual(1);
});

const ensureFaceArtifacts = async (downloads: HuggingFaceWhisperModelDownloader): Promise<void> => {
  for (const artifact of Object.values(FILE_ARTIFACTS)) {
    const ready = await downloads.isFileArtifactDownloaded(artifact);
    if (!ready.ok) failOrSkip(ready.error.message);
    if (ready.value) continue;
    const downloaded = await downloads.downloadFileArtifact(artifact, { force: false });
    if (!downloaded.ok) failOrSkip(downloaded.error.message);
  }
};

const mutableImageIO = (frameRef: { current: RgbFrame }): FaceImageIO => ({
  decodeFrameRgb: () => Promise.resolve(ok(frameRef.current)),
  encodeJpeg: () => Promise.resolve(ok(undefined)),
});

const blankFrame = (width: number, height: number): RgbFrame => ({
  width,
  height,
  data: new Uint8Array(width * height * 3),
});

const noiseFrame = (width: number, height: number): RgbFrame => {
  const data = new Uint8Array(width * height * 3);
  let state = 123_456_789;
  for (let index = 0; index < data.length; index += 1) {
    state = Math.imul(1_664_525, state) + 1_013_904_223;
    data[index] = (state >>> 24) & 255;
  }
  return { width, height, data };
};

const structuredCrop = (kind: 'diagonal' | 'rings'): Uint8Array => {
  const data = new Uint8Array(112 * 112 * 3);
  for (let y = 0; y < 112; y += 1) {
    for (let x = 0; x < 112; x += 1) {
      const index = (y * 112 + x) * 3;
      const value = kind === 'diagonal'
        ? (x * 3 + y * 5) % 256
        : Math.min(255, Math.round(Math.hypot(x - 56, y - 56) * 4));
      data[index] = value;
      data[index + 1] = (value * 7) % 256;
      data[index + 2] = 255 - value;
    }
  }
  return data;
};

const alignedCrop = (data: Uint8Array) => ({
  frameJpegPath: '/synthetic/crop.jpg',
  detection: detectionFixture(),
  width: 112,
  height: 112,
  data,
});

const detectionFixture = (): FaceDetection => ({
  bbox: { x: 0, y: 0, width: 112, height: 112 },
  landmarks: {
    leftEye: { x: 38, y: 52 },
    rightEye: { x: 74, y: 52 },
    nose: { x: 56, y: 72 },
    leftMouth: { x: 42, y: 92 },
    rightMouth: { x: 71, y: 92 },
  },
  score: 0.99,
});

const norm = (values: readonly number[]): number =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

const seedFacesCandidate = async (deps: ReturnType<typeof createDeps>, videoPath: string): Promise<void> => {
  const folderId = 'faces-matrix-folder';
  const fingerprint = `faces-matrix-${Date.now()}`;
  expectResult(await deps.globalCatalog.upsertFolder({
    folderId,
    currentPath: dirname(videoPath),
    displayName: basename(dirname(videoPath)),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }));
  expectResult(await deps.globalCatalog.upsertFile({
    fingerprint,
    folderId,
    fileName: basename(videoPath),
    size: 1,
    durationS: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: new Date().toISOString(),
    analyzer: 'matrix',
    model: 'faces',
  }));
  expectResult(await deps.globalCatalog.upsertAnalysis({
    fingerprint,
    finalName: basename(videoPath),
    description: 'faces matrix sample',
    transcript: null,
    language: null,
    tags: [],
  }));
};

const waitForJob = async (jobs: ReturnType<typeof createDeps>['jobs'], jobId: string): Promise<void> => {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const record = await jobs.get(jobId);
    expectResult(record);
    if (record.value?.status === 'completed') return;
    if (record.value?.status === 'failed') throw new Error(record.value.error?.message ?? 'facesIndex failed');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
};

const expectResult = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
};

const failOrSkip = (reason: string): never => {
  const message = missingLegMessage(CELL, reason);
  if (matrixAllowsSkip(process.env.E2E_MATRIX_ALLOW_SKIP)) test.skip(true, message);
  throw new Error(message);
};
