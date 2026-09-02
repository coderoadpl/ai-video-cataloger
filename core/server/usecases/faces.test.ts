import { describe, expect, it } from 'vitest';

import {
  facesExemplars,
  facesForget,
  facesIndex,
  facesMerge,
  facesName,
  facesPeople,
  facesPurge,
  facesRecluster,
  facesStatus,
  runFacesExemplarsPass,
  runFacesIndexJob,
  runFacesIndexPass,
  runFacesReclusterPass,
} from './faces.js';
import type { FacesDeps, FacesReclusterDeps } from './faces.js';
import {
  InMemoryConfig,
  InMemoryDownloads,
  InMemoryFaceEngine,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryJobs,
  InMemoryMedia,
  InMemoryPhotosStore,
} from '../../../test/server/usecases/test-fakes.js';
import { FACE_ENGINE_VERSION, FACE_QUALITY, appError, normalizeEmbedding, ok, type AppError, type FaceObservation, type Person, type Result } from '@core/domain/index.js';
import type { AlignedFaceCrop, DependencyStatus, FaceDetection, FaceEnginePort, FaceFrameInput, JobExecutionContext, JobProgress } from '../ports.js';

const unit128 = (offset = 0): number[] =>
  normalizeEmbedding(Array.from({ length: 128 }, (_value, index) => (index === offset ? 1 : 0.001)));

class FakeFaceEngine implements FaceEnginePort {
  loadCalls = 0;
  disposeCalls = 0;
  embedCalls = 0;
  readonly cropWrites: string[] = [];
  readonly producedCrops: AlignedFaceCrop[] = [];
  readonly detectInputs: Array<FaceFrameInput | string> = [];
  readonly detectionByVideoPath = new Map<string, FaceDetection>();
  readonly detectFailureVideoPaths = new Set<string>();
  readonly zeroDetectionImagePaths = new Set<string>();
  detection: FaceDetection = {
    bbox: { x: 0, y: 0, width: 200, height: 200 },
    landmarks: {
      leftEye: { x: 70, y: 90 },
      rightEye: { x: 130, y: 90 },
      nose: { x: 100, y: 120 },
      leftMouth: { x: 80, y: 160 },
      rightMouth: { x: 120, y: 160 },
    },
    score: 0.95,
  };
  embedding = unit128();

  load(): Promise<Result<void, AppError>> {
    this.loadCalls += 1;
    return Promise.resolve(ok(undefined));
  }

  detect(input: FaceFrameInput | string): Promise<Result<FaceDetection[], AppError>> {
    this.detectInputs.push(input);
    if (typeof input === 'object' && input.kind === 'image-path' && this.zeroDetectionImagePaths.has(input.frameJpegPath)) {
      return Promise.resolve(ok([]));
    }
    if (typeof input === 'object' && input.kind === 'video-timestamp' && this.detectFailureVideoPaths.has(input.videoPath)) {
      return Promise.resolve({ ok: false, error: appError('processing_error', `Failed to decode ${input.videoPath}`) });
    }
    const override = typeof input === 'object' && input.kind === 'video-timestamp'
      ? this.detectionByVideoPath.get(input.videoPath)
      : undefined;
    return Promise.resolve(ok([override ?? this.detection]));
  }

  align(frame: FaceFrameInput | string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    const normalized: FaceFrameInput = typeof frame === 'string' ? { kind: 'image-path', frameJpegPath: frame } : frame;
    const crop: AlignedFaceCrop = { frame: normalized, detection, width: 112, height: 112, data: new Uint8Array(112 * 112 * 3) };
    this.producedCrops.push(crop);
    return Promise.resolve(ok(crop));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
    this.embedCalls += 1;
    return Promise.resolve(ok(new Float32Array(this.embedding)));
  }

  writeCrop(_alignedCrop: AlignedFaceCrop, outputPath: string): Promise<Result<void, AppError>> {
    this.cropWrites.push(outputPath);
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    this.disposeCalls += 1;
    return Promise.resolve(ok(undefined));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({ name: 'faces', available: true, version: null, source: 'managed', path: null, installHint: '' }));
  }
}

class ScriptedFaceEngine implements FaceEnginePort {
  detectCalls = 0;
  failAtCall: number | null = null;
  maxDetections = Number.POSITIVE_INFINITY;
  embedding = unit128();
  readonly cropWrites: string[] = [];
  detection: FaceDetection = {
    bbox: { x: 0, y: 0, width: 200, height: 200 },
    landmarks: {
      leftEye: { x: 130, y: 90 },
      rightEye: { x: 70, y: 90 },
      nose: { x: 100, y: 120 },
      leftMouth: { x: 120, y: 160 },
      rightMouth: { x: 80, y: 160 },
    },
    score: 0.95,
  };

  load(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  detect(): Promise<Result<FaceDetection[], AppError>> {
    this.detectCalls += 1;
    if (this.failAtCall !== null && this.detectCalls === this.failAtCall) {
      return Promise.resolve({ ok: false, error: appError('processing_error', 'scripted detect failure') });
    }
    if (this.detectCalls > this.maxDetections) return Promise.resolve(ok([]));
    return Promise.resolve(ok([this.detection]));
  }

  align(frame: FaceFrameInput | string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    const normalized: FaceFrameInput = typeof frame === 'string' ? { kind: 'image-path', frameJpegPath: frame } : frame;
    return Promise.resolve(ok({ frame: normalized, detection, width: 112, height: 112, data: new Uint8Array(112 * 112 * 3) }));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
    return Promise.resolve(ok(new Float32Array(this.embedding)));
  }

  writeCrop(_alignedCrop: AlignedFaceCrop, outputPath: string): Promise<Result<void, AppError>> {
    this.cropWrites.push(outputPath);
    return Promise.resolve(ok(undefined));
  }

  dispose(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }

  dependency(): Promise<Result<DependencyStatus, AppError>> {
    return Promise.resolve(ok({ name: 'faces', available: true, version: null, source: 'managed', path: null, installHint: '' }));
  }
}

const personFixture = (overrides: Partial<Person> = {}): Person => ({
  personId: overrides.personId ?? 'person-1',
  displayName: overrides.displayName ?? null,
  kind: 'face',
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  centroid: overrides.centroid ?? unit128(),
  exemplarCount: overrides.exemplarCount ?? 1,
});

const observationFixture = (overrides: Partial<FaceObservation> = {}): FaceObservation => ({
  obsId: overrides.obsId ?? 'obs-1',
  fingerprint: overrides.fingerprint ?? 'fp-1',
  kind: 'face',
  frameTsS: overrides.frameTsS === undefined ? 1 : overrides.frameTsS,
  bbox: overrides.bbox ?? { x: 0, y: 0, width: 100, height: 100 },
  embedding: overrides.embedding ?? unit128(),
  quality: overrides.quality ?? 0.95,
  personId: overrides.personId ?? null,
  cropPath: overrides.cropPath ?? null,
  media: overrides.media ?? 'video',
});

const buildDeps = (): FacesDeps & {
  config: InMemoryConfig;
  downloads: InMemoryDownloads;
  globalCatalog: InMemoryGlobalCatalogStore;
  photos: InMemoryPhotosStore;
  fs: InMemoryFileSystem;
  media: InMemoryMedia;
  faceEngine: FakeFaceEngine;
} => {
  const downloads = new InMemoryDownloads();
  downloads.downloadedArtifacts.add('face-detector/yunet-2023mar');
  downloads.downloadedArtifacts.add('face-embedder/sface-2021dec');
  return {
    config: new InMemoryConfig(),
    downloads,
    globalCatalog: new InMemoryGlobalCatalogStore(),
    photos: new InMemoryPhotosStore(),
    fs: new InMemoryFileSystem(),
    media: new InMemoryMedia(),
    jobs: new InMemoryJobs(),
    faceEngine: new FakeFaceEngine(),
  };
};

const enableFaces = async (deps: Pick<FacesDeps, 'config'>): Promise<void> => {
  await deps.config.set({ kind: 'home' }, 'faces_enabled', 'true');
};

describe('faces use-cases gating', () => {
  it('returns the disabled error for every entry point when faces_enabled is off', async () => {
    const deps = buildDeps();
    const results = await Promise.all([
      facesPeople(deps),
      facesName(deps, { personId: 'p', displayName: 'A' }),
      facesMerge(deps, { fromPersonId: 'a', toPersonId: 'b' }),
      facesForget(deps, { personId: 'p', force: true }),
      facesPurge(deps, { force: true }),
      facesStatus(deps),
      facesIndex(deps, { root: '/work/videos' }),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected disabled error');
      expect(result.error.code).toBe('faces_disabled');
    }
  });
});

describe('faces people management', () => {
  it('names a person and reports the affected fingerprints for search sync', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-a', personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o2', fingerprint: 'fp-b', personId: 'p1' }));

    const result = await facesName(deps, { personId: 'p1', displayName: 'Alice' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.displayName).toBe('Alice');
    expect(result.value.affectedFingerprints.sort()).toEqual(['fp-a', 'fp-b']);
  });

  it('rejects merging a person into itself', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const result = await facesMerge(deps, { fromPersonId: 'p1', toPersonId: 'p1' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected validation error');
    expect(result.error.code).toBe('validation');
  });

  it('merges people and moves their observations', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'from' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'to' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-a', personId: 'from' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o2', fingerprint: 'fp-b', personId: 'from' }));

    const result = await facesMerge(deps, { fromPersonId: 'from', toPersonId: 'to' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.movedObservations).toBe(2);
    const people = await deps.globalCatalog.listPeople();
    expect(people.ok && people.value.map((person) => person.personId)).toEqual(['to']);
  });
});

describe('faces forget and purge delete crop files', () => {
  it('forget requires force and deletes the person crop files from disk', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const cropPath = '/home/.ai-video-cataloger/faces/p1/exemplar-001.jpg';
    deps.fs.addFile(cropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-a', personId: 'p1', cropPath }));

    const unforced = await facesForget(deps, { personId: 'p1', force: false });
    expect(unforced.ok).toBe(false);
    if (unforced.ok) throw new Error('expected confirmation error');
    expect(unforced.error.code).toBe('confirmation_required');

    const result = await facesForget(deps, { personId: 'p1', force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropPathsDeleted).toBe(1);
    const exists = await deps.fs.exists(cropPath);
    expect(exists.ok && exists.value).toBe(false);
    const people = await deps.globalCatalog.listPeople();
    expect(people.ok && people.value.length).toBe(0);
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-a' });
    expect(observations.ok && observations.value.length).toBe(0);
  });

  it('purge wipes all faces rows and their crop files', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const cropPath = '/home/.ai-video-cataloger/faces/p1/exemplar-001.jpg';
    deps.fs.addFile(cropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-a', personId: 'p1', cropPath }));

    const result = await facesPurge(deps, { force: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ peopleDeleted: 1, observationsDeleted: 1, cropPathsDeleted: 1 });
    const status = await facesStatus(deps);
    expect(status.ok && status.value.observations).toBe(0);
  });

  it('reports indexed files and stale completion state per medium', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-video:face:1:1',
      fingerprint: 'fp-video',
      media: 'video',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'ph_0000000000000001:face:1:1',
      fingerprint: 'ph_0000000000000001',
      media: 'photo',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'ph_0000000000000001:face:1:2',
      fingerprint: 'ph_0000000000000001',
      media: 'photo',
    }));
    await deps.photos.completePhotoFaceIndex('ph_0000000000000002', FACE_ENGINE_VERSION - 1);

    const result = await facesStatus(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      filesIndexed: 2,
      videosIndexed: 1,
      photosIndexed: 1,
      stalePhotoFiles: 1,
    });
  });

  it('forget re-anchors a stale-home crop path before deleting it', async () => {
    const deps = buildDeps();
    deps.globalCatalog = new InMemoryGlobalCatalogStore('/new-home/.ai-video-cataloger/catalog.db');
    await enableFaces(deps);
    const currentCropPath = '/new-home/.ai-video-cataloger/faces/p1/exemplar-001.jpg';
    deps.fs.addFile(currentCropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'o1',
      fingerprint: 'fp-a',
      personId: 'p1',
      cropPath: '/old-home/.ai-video-cataloger/faces/p1/exemplar-001.jpg',
    }));

    const result = await facesForget(deps, { personId: 'p1', force: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropPathsDeleted).toBe(1);
    const exists = await deps.fs.exists(currentCropPath);
    expect(exists.ok && exists.value).toBe(false);
  });

  it('purge re-anchors a stale-home crop path before deleting it', async () => {
    const deps = buildDeps();
    deps.globalCatalog = new InMemoryGlobalCatalogStore('/new-home/.ai-video-cataloger/catalog.db');
    await enableFaces(deps);
    const currentCropPath = '/new-home/.ai-video-cataloger/faces/p1/exemplar-001.jpg';
    deps.fs.addFile(currentCropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'o1',
      fingerprint: 'fp-a',
      personId: 'p1',
      cropPath: '/old-home/.ai-video-cataloger/faces/p1/exemplar-001.jpg',
    }));

    const result = await facesPurge(deps, { force: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropPathsDeleted).toBe(1);
    const exists = await deps.fs.exists(currentCropPath);
    expect(exists.ok && exists.value).toBe(false);
  });
});

describe('facesIndex', () => {
  const seedCatalog = async (deps: FacesDeps & { fs: InMemoryFileSystem }): Promise<void> => {
    deps.fs.addDirectory('/work/videos');
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-1111-1111-111111111111',
      currentPath: '/work/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-clip',
      folderId: '11111111-1111-1111-1111-111111111111',
      fileName: 'clip.mp4',
      size: 1,
      durationS: 10,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await deps.globalCatalog.upsertAnalysis({
      fingerprint: 'fp-clip',
      finalName: 'clip',
      description: 'a clip',
      transcript: null,
      language: null,
      tags: [],
    });
  };

  it('indexes candidate files, clusters a person, and is idempotent on re-run', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);
    deps.media.durations.set('/work/videos/clip.mp4', 14);

    const first = await facesIndex(deps, { root: '/work/videos' });
    expect(first.ok).toBe(true);

    const afterFirst = await facesStatus(deps);
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) throw new Error(afterFirst.error.message);
    expect(afterFirst.value.observations).toBe(6);
    expect(afterFirst.value.people).toBe(1);
    expect(deps.faceEngine.detectInputs[0]).toEqual({
      kind: 'video-timestamp',
      videoPath: '/work/videos/clip.mp4',
      timestampS: 2,
      fallbackFrameJpegPath: '/tmp/ai-video-cataloger/faces/fp-clip/frame-001.jpg',
    });

    const second = await facesIndex(deps, { root: '/work/videos' });
    expect(second.ok).toBe(true);
    const afterSecond = await facesStatus(deps);
    expect(afterSecond.ok && afterSecond.value.observations).toBe(6);
  });

  it('indexes photo proxies with native geometry and completes zero-face photos', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    deps.fs.addDirectory('/work/photos');
    const firstFingerprint = 'ph_0000000000000001';
    const secondFingerprint = 'ph_0000000000000002';
    const firstProxy = `/home/.ai-video-cataloger/photo-artifacts/proxies/${firstFingerprint}.jpg`;
    const secondProxy = `/home/.ai-video-cataloger/photo-artifacts/proxies/${secondFingerprint}.jpg`;
    deps.fs.addFile(firstProxy, { content: 'proxy-one' });
    deps.fs.addFile(secondProxy, { content: 'proxy-two' });
    for (const [fingerprint, fileName, proxyWidth, proxyHeight] of [
      [firstFingerprint, 'one.jpg', 1280, 720],
      [secondFingerprint, 'two.jpg', 720, 1280],
    ] as const) {
      await deps.photos.upsertPhoto({
        fingerprint,
        folderId: 'photo-folder',
        fileName,
        currentPath: `/work/photos/${fileName}`,
        ext: 'jpg',
        size: 1,
        width: proxyWidth,
        height: proxyHeight,
        orientation: null,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        fNumber: null,
        exposureTime: null,
        exifRating: null,
        capturedAt: null,
        capturedAtSource: 'file_mtime',
        gpsLat: null,
        gpsLon: null,
        gpsSource: null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        placeName: null,
        placeRegion: null,
        placeCountry: null,
        placeCountryCode: null,
        placeDistanceM: null,
        placeDataset: null,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        exifReadAt: '2026-01-01T00:00:00.000Z',
        proxyState: 'done',
        proxyWidth,
        proxyHeight,
        thumbState: 'done',
        missingAt: null,
        selectedConfigId: null,
      });
      await deps.photos.upsertSighting({
        fingerprint,
        currentPath: `/work/photos/${fileName}`,
        folderId: 'photo-folder',
        size: 1,
        mtimeMs: 1,
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      });
    }
    deps.faceEngine.zeroDetectionImagePaths.add(secondProxy);

    const result = await runFacesIndexPass(deps, { root: '/work/photos' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.photo).toEqual({
      inScope: 2,
      scanned: 2,
      indexed: 2,
      observationsAdded: 1,
      failed: 0,
    });
    expect(deps.faceEngine.detectInputs).toContainEqual({ kind: 'image-path', frameJpegPath: firstProxy });
    expect(deps.faceEngine.detectInputs).toContainEqual({ kind: 'image-path', frameJpegPath: secondProxy });
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: firstFingerprint });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    expect(observations.value).toEqual([
      expect.objectContaining({
        obsId: `${firstFingerprint}:face:1:1`,
        media: 'photo',
        frameTsS: null,
        bbox: expect.objectContaining({ sourceWidth: 1280, sourceHeight: 720 }),
        cropPath: expect.stringMatching(/faces\/obs\/ph_0000000000000001\/1-1\.jpg$/),
      }),
    ]);
    expect(deps.photos.faceIndexState.get(firstFingerprint)).toBe(FACE_ENGINE_VERSION);
    expect(deps.photos.faceIndexState.get(secondFingerprint)).toBe(FACE_ENGINE_VERSION);
    expect(deps.faceEngine.cropWrites).toEqual([
      expect.stringMatching(/faces\/obs\/ph_0000000000000001\/1-1\.jpg$/),
    ]);
  });

  it('writes a crop for every detected face, including the ones no person claims yet', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);

    const result = await facesIndex(deps, { root: '/work/videos' });
    expect(result.ok).toBe(true);

    expect(deps.faceEngine.cropWrites).toHaveLength(6);
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-clip' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    expect(observations.value).toHaveLength(6);
    expect(observations.value.every((observation) => observation.cropPath !== null)).toBe(true);
  });

  it('stores crops per observation, not per person', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);

    const result = await facesIndex(deps, { root: '/work/videos' });
    expect(result.ok).toBe(true);

    for (const cropPath of deps.faceEngine.cropWrites) {
      expect(cropPath).toMatch(/faces\/obs\/fp-clip\/\d+-\d+\.jpg$/);
      expect(cropPath).not.toMatch(/person-/);
    }
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-clip' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    const directories = new Set(observations.value.map((observation) => observation.cropPath?.split('/').slice(0, -1).join('/')));
    expect(directories.size).toBe(1);
  });

  it('reports the distinct disabled error when the models are missing', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);
    deps.downloads.downloadedArtifacts.clear();

    const result = await facesIndex(deps, { root: '/work/videos' });
    expect(result.ok).toBe(true);
    const status = await deps.jobs.list();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('expected jobs');
    const record = status.value.at(-1);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('model_not_installed');
  });

  it('runs without a job context and still stores observations', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);
    deps.media.durations.set('/work/videos/clip.mp4', 14);

    const result = await runFacesIndexPass(deps, { root: '/work/videos' });

    expect(result.ok).toBe(true);
    const status = await facesStatus(deps);
    expect(status.ok && status.value.observations).toBe(6);
  });

  it('deletes the per-file temp frame directory once its observations are stored', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);
    deps.media.durations.set('/work/videos/clip.mp4', 14);

    const result = await facesIndex(deps, { root: '/work/videos' });

    expect(result.ok).toBe(true);
    const frame = await deps.fs.exists('/tmp/ai-video-cataloger/faces/fp-clip/frame-001.jpg');
    expect(frame.ok && frame.value).toBe(false);
    const status = await facesStatus(deps);
    expect(status.ok && status.value.observations).toBe(6);
  });

  it('indexes a clip that has fewer frames than requested', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);
    deps.media.durations.set('/work/videos/clip.mp4', 0.1);
    deps.media.frameLimits.set('/work/videos/clip.mp4', 3);

    const result = await runFacesIndexPass(deps, { root: '/work/videos' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.filesFailed).toBe(0);
    expect(result.value.filesIndexed).toBe(1);
    expect(result.value.observationsAdded).toBeGreaterThan(0);
  });

  it('indexes an NFD-passed root against an NFC-stored catalog folder', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const nfcRoot = '/work/Å-ring'.normalize('NFC');
    const nfdRoot = '/work/Å-ring'.normalize('NFD');
    deps.fs.addDirectory(nfdRoot);
    await deps.globalCatalog.upsertFolder({
      folderId: '11111111-1111-1111-1111-111111111111',
      currentPath: nfcRoot,
      displayName: 'Å-ring',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-clip',
      folderId: '11111111-1111-1111-1111-111111111111',
      fileName: 'clip.mp4',
      size: 1,
      durationS: 10,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await deps.globalCatalog.upsertAnalysis({
      fingerprint: 'fp-clip',
      finalName: 'clip',
      description: 'a clip',
      transcript: null,
      language: null,
      tags: [],
    });
    deps.media.durations.set(`${nfcRoot}/clip.mp4`, 14);

    const result = await runFacesIndexPass(deps, { root: nfdRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.foldersMatched).toBe(1);
    expect(result.value.filesScanned).toBe(1);
    expect(result.value.filesIndexed).toBe(1);
  });

  it('fails with drive_root_empty when the root exists but no catalog folder matches', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    deps.fs.addDirectory('/work/videos');

    const result = await runFacesIndexPass(deps, { root: '/work/videos' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected drive_root_empty');
    expect(result.error.code).toBe('drive_root_empty');
  });

  it('fails with folder_not_found when the root does not exist on disk', async () => {
    const deps = buildDeps();
    await enableFaces(deps);

    const result = await runFacesIndexPass(deps, { root: '/work/does-not-exist' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected folder_not_found');
    expect(result.error.code).toBe('folder_not_found');
  });
});

const folderId = '11111111-1111-1111-1111-111111111111';

const buildScriptableDeps = (): FacesDeps & { fs: InMemoryFileSystem } => {
  const downloads = new InMemoryDownloads();
  downloads.downloadedArtifacts.add('face-detector/yunet-2023mar');
  downloads.downloadedArtifacts.add('face-embedder/sface-2021dec');
  return {
    config: new InMemoryConfig(),
    downloads,
    globalCatalog: new InMemoryGlobalCatalogStore(),
    photos: new InMemoryPhotosStore(),
    fs: new InMemoryFileSystem(),
    media: new InMemoryMedia(),
    jobs: new InMemoryJobs(),
    faceEngine: new ScriptedFaceEngine(),
  };
};

const seedFolder = async (deps: FacesDeps & { fs: InMemoryFileSystem }): Promise<void> => {
  deps.fs.addDirectory('/work/videos');
  await deps.globalCatalog.upsertFolder({
    folderId,
    currentPath: '/work/videos',
    displayName: 'videos',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  });
};

const seedFile = async (deps: FacesDeps, fingerprint: string, fileName: string): Promise<void> => {
  await deps.globalCatalog.upsertFile({
    fingerprint,
    folderId,
    fileName,
    size: 1,
    durationS: 10,
    width: null,
    height: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-01-01T00:00:00.000Z',
    analyzer: 'claude',
    model: 'sonnet',
    missingAt: null,
    capturedAt: null,
    capturedAtSource: null,
    gpsSource: null,
    gpsAccuracyM: null,
    gpsIntervalKind: null,
    gpsResolvedAt: null,
    place: null,
  });
  await deps.globalCatalog.upsertAnalysis({
    fingerprint,
    finalName: fileName,
    description: 'a clip',
    transcript: null,
    language: null,
    tags: [],
  });
};

describe('facesIndex resume after interruption', () => {
  it('recovers every face of a file that was interrupted after storing one observation', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-clip', 'clip.mp4');

    const interrupting = new ScriptedFaceEngine();
    interrupting.failAtCall = 2;
    deps.faceEngine = interrupting;
    const firstRun = await facesIndex(deps, { root: '/work/videos' });
    expect(firstRun.ok).toBe(true);

    const afterInterrupt = await facesStatus(deps);
    expect(afterInterrupt.ok).toBe(true);
    if (!afterInterrupt.ok) throw new Error(afterInterrupt.error.message);
    expect(afterInterrupt.value.observations).toBe(1);
    expect(afterInterrupt.value.people).toBe(0);

    const resuming = new ScriptedFaceEngine();
    resuming.maxDetections = 3;
    deps.faceEngine = resuming;
    const secondRun = await facesIndex(deps, { root: '/work/videos' });
    expect(secondRun.ok).toBe(true);

    const afterResume = await facesStatus(deps);
    expect(afterResume.ok).toBe(true);
    if (!afterResume.ok) throw new Error(afterResume.error.message);
    expect(afterResume.value.observations).toBe(3);
    expect(afterResume.value.people).toBe(1);
    expect(afterResume.value.unassignedObservations).toBe(0);
  });
});

describe('facesIndex cross-run clustering', () => {
  it('reloads persisted unassigned observations so a person forms across two runs', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');

    const firstEngine = new ScriptedFaceEngine();
    firstEngine.maxDetections = 1;
    deps.faceEngine = firstEngine;
    const firstRun = await facesIndex(deps, { root: '/work/videos' });
    expect(firstRun.ok).toBe(true);

    const afterFirst = await facesStatus(deps);
    expect(afterFirst.ok && afterFirst.value.people).toBe(0);
    expect(afterFirst.ok && afterFirst.value.unassignedObservations).toBe(1);

    await seedFile(deps, 'fp-b', 'b.mp4');
    const secondEngine = new ScriptedFaceEngine();
    secondEngine.maxDetections = 1;
    deps.faceEngine = secondEngine;
    const secondRun = await facesIndex(deps, { root: '/work/videos' });
    expect(secondRun.ok).toBe(true);

    const afterSecond = await facesStatus(deps);
    expect(afterSecond.ok).toBe(true);
    if (!afterSecond.ok) throw new Error(afterSecond.error.message);
    expect(afterSecond.value.people).toBe(1);
    expect(afterSecond.value.assignedObservations).toBe(2);
    expect(afterSecond.value.unassignedObservations).toBe(0);

    const reloaded = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-a' });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) throw new Error(reloaded.error.message);
    expect(reloaded.value.every((observation) => observation.personId !== null)).toBe(true);
  });
});

describe('facesIndex stale-version re-indexing', () => {
  it('deletes wrong-space observations and re-indexes a file marked with an older engine version', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-clip', 'clip.mp4');
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-clip:face:9:9',
      fingerprint: 'fp-clip',
      embedding: unit128(5),
    }));
    await deps.globalCatalog.completeFaceIndex('fp-clip', 1);

    const beforeStatus = await facesStatus(deps);
    expect(beforeStatus.ok && beforeStatus.value.staleVersionFiles).toBe(1);

    const engine = new ScriptedFaceEngine();
    engine.maxDetections = 3;
    deps.faceEngine = engine;
    const run = await facesIndex(deps, { root: '/work/videos' });
    expect(run.ok).toBe(true);

    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-clip' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    expect(observations.value.map((observation) => observation.obsId)).not.toContain('fp-clip:face:9:9');
    expect(observations.value.length).toBe(3);

    const afterStatus = await facesStatus(deps);
    expect(afterStatus.ok).toBe(true);
    if (!afterStatus.ok) throw new Error(afterStatus.error.message);
    expect(afterStatus.value.staleVersionFiles).toBe(0);
    expect(afterStatus.value.people).toBe(1);
  });

  it('re-anchors a stale-home crop path before deleting it during the stale-engine purge', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-clip', 'clip.mp4');
    const currentCropPath = '/home/.ai-video-cataloger/faces/obs/fp-clip/9-9.jpg';
    deps.fs.addFile(currentCropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-clip:face:9:9',
      fingerprint: 'fp-clip',
      embedding: unit128(5),
      cropPath: '/old-home/.ai-video-cataloger/faces/obs/fp-clip/9-9.jpg',
    }));
    await deps.globalCatalog.completeFaceIndex('fp-clip', 1);

    const engine = new ScriptedFaceEngine();
    engine.maxDetections = 0;
    deps.faceEngine = engine;
    const run = await facesIndex(deps, { root: '/work/videos' });
    expect(run.ok).toBe(true);

    const exists = await deps.fs.exists(currentCropPath);
    expect(exists.ok && exists.value).toBe(false);
  });
});

const events = (progress: JobProgress[], signal = new AbortController().signal): JobExecutionContext => ({
  signal,
  reportProgress: (event) => {
    progress.push(event);
    return Promise.resolve(ok(undefined));
  },
});

describe('facesIndex single-file tolerance', () => {
  it('records an undecodable file and keeps indexing', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');
    await seedFile(deps, 'fp-b', 'b.mp4');
    await seedFile(deps, 'fp-c', 'c.mp4');
    deps.media.frameFailures.set('/work/videos/b.mp4', appError('processing_error', 'Decoded RGB frame size mismatch: expected 15925248, got 0'));
    const progress: JobProgress[] = [];

    const result = await runFacesIndexPass(deps, { root: '/work/videos' }, events(progress));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.filesIndexed).toBe(2);
    expect(result.value.filesFailed).toBe(1);
    expect(result.value.aborted).toBe(false);
    expect(result.value.failures).toHaveLength(1);
    expect(result.value.failures[0]).toMatchObject({ fingerprint: 'fp-b', code: 'processing_error' });
    expect(deps.globalCatalog.faceIndexState.has('fp-b')).toBe(false);
    expect(deps.globalCatalog.faceIndexState.has('fp-a')).toBe(true);
    expect(deps.globalCatalog.faceIndexState.has('fp-c')).toBe(true);
    expect(progress.filter((event) => event.step === 'faces_file_failed')).toHaveLength(1);
  });

  it('aborts after five consecutive same-class failures', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    const fileNames = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4', 'f.mp4'];
    for (const [index, fileName] of fileNames.entries()) {
      await seedFile(deps, `fp-${String(index)}`, fileName);
    }
    for (const fileName of fileNames.slice(0, 5)) {
      deps.media.frameFailures.set(`/work/videos/${fileName}`, appError('processing_error', 'poisoned'));
    }

    const result = await runFacesIndexPass(deps, { root: '/work/videos' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.aborted).toBe(true);
    expect(result.value.filesFailed).toBe(5);
    expect(deps.media.frameInputs).toHaveLength(5);
  });

  it('does not abort when failure classes alternate', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    const fileNames = Array.from({ length: 8 }, (_value, index) => `${String(index)}.mp4`);
    for (const [index, fileName] of fileNames.entries()) {
      await seedFile(deps, `fp-${String(index)}`, fileName);
      const code = index % 2 === 0 ? 'processing_error' : 'read_error';
      deps.media.frameFailures.set(`/work/videos/${fileName}`, appError(code, 'poisoned'));
    }

    const result = await runFacesIndexPass(deps, { root: '/work/videos' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.aborted).toBe(false);
    expect(result.value.filesFailed).toBe(8);
    expect(deps.media.frameInputs).toHaveLength(8);
  });

  it('faces index job maps a streak abort to drive_run_aborted', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    const fileNames = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4'];
    for (const [index, fileName] of fileNames.entries()) {
      await seedFile(deps, `fp-${String(index)}`, fileName);
      deps.media.frameFailures.set(`/work/videos/${fileName}`, appError('processing_error', 'poisoned'));
    }

    const jobResult = await facesIndex(deps, { root: '/work/videos' });
    expect(jobResult.ok).toBe(true);
    if (!jobResult.ok) throw new Error(jobResult.error.message);
    const jobs = await deps.jobs.list();
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) throw new Error('expected jobs');
    const record = jobs.value.find((job) => job.jobId === jobResult.value.jobId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('drive_run_aborted');

    const direct = await runFacesIndexJob(deps, { root: '/work/videos' });
    expect(direct).toMatchObject({ ok: false, error: { code: 'drive_run_aborted' } });
  });

  it('cancellation still stops the pass without recording it as a per-file failure', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');
    await seedFile(deps, 'fp-b', 'b.mp4');
    const controller = new AbortController();
    const progress: JobProgress[] = [];

    const result = await runFacesIndexPass(deps, { root: '/work/videos' }, {
      signal: controller.signal,
      reportProgress: (event) => {
        progress.push(event);
        if (event.step === 'faces_extracting_frames' && event.data?.fingerprint === 'fp-a') controller.abort();
        return Promise.resolve(ok(undefined));
      },
    });

    expect(result).toMatchObject({ ok: false, error: { message: 'Job cancelled' } });
    expect(progress.some((event) => event.step === 'faces_file_failed')).toBe(false);
  });
});

describe('facesIndex seeded person keeps its detection-time crops', () => {
  it('keeps crop paths stable when a person is seeded from the pool', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');

    const engine = new ScriptedFaceEngine();
    engine.maxDetections = 2;
    deps.faceEngine = engine;
    const result = await facesIndex(deps, { root: '/work/videos' });
    expect(result.ok).toBe(true);

    const status = await facesStatus(deps);
    expect(status.ok && status.value.people).toBe(1);

    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-a' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    const assigned = observations.value.filter((observation) => observation.personId !== null);
    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.every((observation) => observation.cropPath !== null)).toBe(true);
    expect(engine.cropWrites.sort()).toEqual(observations.value.map((observation) => observation.cropPath).sort());
  });
});

describe('facesPeople exemplar diversity', () => {
  it('shows the best face across distinct files', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', quality: 0.6, cropPath: '/crops/fp-a/1-1.jpg',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p1', quality: 0.9, cropPath: '/crops/fp-b/1-1.jpg',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-c:face:1:1', fingerprint: 'fp-c', personId: 'p1', quality: 0.75, cropPath: '/crops/fp-c/1-1.jpg',
    }));

    const result = await facesPeople(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const person = result.value.people.find((candidate) => candidate.personId === 'p1');
    expect(person?.exemplarCropPaths).toEqual(['/crops/fp-b/1-1.jpg', '/crops/fp-c/1-1.jpg', '/crops/fp-a/1-1.jpg']);
    expect(person?.exemplarCropPath).toBe('/crops/fp-b/1-1.jpg');
  });
});

describe('facesPeople re-anchors stale-home crop paths', () => {
  it('resolves exemplar crops recorded under a previous home against the current home', async () => {
    const deps = buildDeps();
    deps.globalCatalog = new InMemoryGlobalCatalogStore('/new-home/.ai-video-cataloger/catalog.db');
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-a:face:1:1',
      fingerprint: 'fp-a',
      personId: 'p1',
      cropPath: '/old-home/.ai-video-cataloger/faces/obs/fp-a/1-1.jpg',
    }));

    const result = await facesPeople(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const person = result.value.people.find((candidate) => candidate.personId === 'p1');
    expect(person?.exemplarCropPath).toBe('/new-home/.ai-video-cataloger/faces/obs/fp-a/1-1.jpg');
  });
});

describe('facesRecluster', () => {
  const buildReclusterDeps = (): FacesDeps & {
    config: InMemoryConfig;
    downloads: InMemoryDownloads;
    globalCatalog: InMemoryGlobalCatalogStore;
    fs: InMemoryFileSystem;
    media: InMemoryMedia;
    faceEngine: InMemoryFaceEngine;
  } => ({
    ...buildDeps(),
    faceEngine: new InMemoryFaceEngine(),
  });

  it('recluster never extracts a frame and never runs the detector', async () => {
    const deps = buildReclusterDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-a', embedding: unit128(0) }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o2', fingerprint: 'fp-b', embedding: unit128(0) }));

    const result = await facesRecluster(deps, { dryRun: false });
    expect(result.ok).toBe(true);

    expect(deps.media.frameInputs.length).toBe(0);
    expect(deps.faceEngine.loadCalls).toBe(0);
    expect(deps.faceEngine.detectCalls).toBe(0);
  });

  it('counts a person whose only crop is outranked as still having no photo', async () => {
    const deps = buildReclusterDeps();
    await enableFaces(deps);
    for (let index = 0; index < 6; index += 1) {
      await deps.globalCatalog.upsertFaceObservation(observationFixture({
        obsId: `o${index}`,
        fingerprint: `fp-${index}`,
        embedding: unit128(0),
        quality: 0.9 - index * 0.01,
        cropPath: index === 5 ? '/crops/fp-5/1-1.jpg' : null,
      }));
    }

    const result = await runFacesReclusterPass(deps, { dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.personsAfter).toBe(1);
    expect(result.value.personsWithoutExemplar).toBe(1);

    const people = await facesPeople(deps);
    expect(people.ok).toBe(true);
    if (!people.ok) throw new Error(people.error.message);
    expect(people.value.people[0]?.exemplarCropPaths).toEqual([]);
  });

  it('splits a merged person into two and drops old names', async () => {
    const deps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: new InMemoryGlobalCatalogStore() };
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'legacy-person', displayName: 'Legacy Name' }));
    for (let index = 0; index < 4; index += 1) {
      await deps.globalCatalog.upsertFaceObservation(observationFixture({
        obsId: `a${index}`,
        fingerprint: `fp-a${index}`,
        embedding: unit128(0),
        personId: 'legacy-person',
      }));
    }
    for (let index = 0; index < 2; index += 1) {
      await deps.globalCatalog.upsertFaceObservation(observationFixture({
        obsId: `b${index}`,
        fingerprint: `fp-b${index}`,
        embedding: unit128(5),
        personId: 'legacy-person',
      }));
    }

    const result = await runFacesReclusterPass(deps, { dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.personsBefore).toBe(1);
    expect(result.value.personsAfter).toBe(2);
    expect(result.value.observationsReassigned).toBe(6);
    expect(result.value.namesCarried).toBe(0);
    expect(result.value.namesDropped).toEqual(['Legacy Name']);
    expect(result.value.largestClusters).toEqual([
      { personId: 'person-a0', observations: 4 },
      { personId: 'person-b0', observations: 2 },
    ]);

    const people = await deps.globalCatalog.listPeople();
    expect(people.ok).toBe(true);
    if (!people.ok) throw new Error('expected people');
    expect(people.value.every((person) => person.displayName === null)).toBe(true);
  });

  it('writes nothing on a dry run but predicts the real run', async () => {
    const dryStore = new InMemoryGlobalCatalogStore();
    const realStore = new InMemoryGlobalCatalogStore();
    const dryDeps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: dryStore };
    const realDeps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: realStore };
    for (const deps of [dryDeps, realDeps]) {
      await enableFaces(deps);
      await deps.globalCatalog.upsertPerson(personFixture({ personId: 'legacy-person', displayName: 'Legacy Name' }));
      await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'a0', fingerprint: 'fp-a0', embedding: unit128(0), personId: 'legacy-person' }));
      await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'a1', fingerprint: 'fp-a1', embedding: unit128(0), personId: 'legacy-person' }));
    }
    const flushCountBefore = dryStore.flushCount;

    const dryRunResult = await runFacesReclusterPass(dryDeps, { dryRun: true });
    const realResult = await runFacesReclusterPass(realDeps, { dryRun: false });
    expect(dryRunResult.ok).toBe(true);
    expect(realResult.ok).toBe(true);
    if (!dryRunResult.ok || !realResult.ok) throw new Error('expected ok');
    expect(dryRunResult.value.personsAfter).toBe(realResult.value.personsAfter);
    expect(dryRunResult.value.observationsReassigned).toBe(realResult.value.observationsReassigned);
    expect(dryStore.flushCount).toBe(flushCountBefore);

    const peopleAfterDry = await dryDeps.globalCatalog.listPeople();
    expect(peopleAfterDry.ok).toBe(true);
    if (!peopleAfterDry.ok) throw new Error('expected people');
    expect(peopleAfterDry.value.some((person) => person.personId === 'legacy-person')).toBe(true);
  });

  it('leaves stored observations below the face quality floor unassigned', async () => {
    const deps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: new InMemoryGlobalCatalogStore() };
    await enableFaces(deps);
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'good-1',
      fingerprint: 'fp-good-1',
      embedding: unit128(0),
      quality: FACE_QUALITY.minScore,
      bbox: { x: 0, y: 0, width: FACE_QUALITY.minBoxPx, height: FACE_QUALITY.minBoxPx },
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'good-2',
      fingerprint: 'fp-good-2',
      embedding: unit128(0),
      quality: 0.9,
      bbox: { x: 0, y: 0, width: FACE_QUALITY.minBoxPx + 10, height: FACE_QUALITY.minBoxPx + 10 },
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'low-score',
      fingerprint: 'fp-low-score',
      embedding: unit128(0),
      quality: FACE_QUALITY.minScore - 0.01,
      bbox: { x: 0, y: 0, width: FACE_QUALITY.minBoxPx + 10, height: FACE_QUALITY.minBoxPx + 10 },
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'small-box',
      fingerprint: 'fp-small-box',
      embedding: unit128(0),
      quality: 0.9,
      bbox: { x: 0, y: 0, width: FACE_QUALITY.minBoxPx - 1, height: FACE_QUALITY.minBoxPx - 1 },
    }));

    const result = await runFacesReclusterPass(deps, { dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.observationsAssigned).toBe(2);
    expect(result.value.observationsUnassigned).toBe(2);

    const observations = await deps.globalCatalog.listFaceObservations();
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value.filter((observation) => observation.personId === null).map((observation) => observation.obsId).sort()).toEqual(['low-score', 'small-box']);
  });

  it('clusters video and photo observations into one media-agnostic identity', async () => {
    const deps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: new InMemoryGlobalCatalogStore() };
    await enableFaces(deps);
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-video:face:1:1',
      fingerprint: 'fp-video',
      embedding: unit128(0),
      media: 'video',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'ph_photo:face:1:1',
      fingerprint: 'ph_photo',
      embedding: unit128(0),
      media: 'photo',
    }));

    const result = await runFacesReclusterPass(deps, { dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.personsAfter).toBe(1);

    const observations = await deps.globalCatalog.listFaceObservations();
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(new Set(observations.value.map((observation) => observation.personId)).size).toBe(1);
  });

  it('selects exemplars from both video and photo observations', async () => {
    const deps = buildReclusterDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-video:face:1:1',
      fingerprint: 'fp-video',
      personId: 'p1',
      cropPath: '/home/.ai-video-cataloger/faces/obs/fp-video/1-1.jpg',
      media: 'video',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'ph_photo:face:1:1',
      fingerprint: 'ph_photo',
      personId: 'p1',
      cropPath: '/home/.ai-video-cataloger/faces/obs/ph_photo/1-1.jpg',
      media: 'photo',
    }));

    const result = await facesPeople(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.people[0]?.exemplarCropPaths).toEqual([
      '/home/.ai-video-cataloger/faces/obs/fp-video/1-1.jpg',
      '/home/.ai-video-cataloger/faces/obs/ph_photo/1-1.jpg',
    ]);
  });

  it('carries crop paths under the new owner and counts persons without an exemplar', async () => {
    const deps: FacesReclusterDeps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem(), globalCatalog: new InMemoryGlobalCatalogStore() };
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'legacy-person', displayName: 'Legacy Name' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'a0',
      fingerprint: 'fp-a0',
      embedding: unit128(0),
      personId: 'legacy-person',
      cropPath: '/home/.ai-video-cataloger/faces/legacy/exemplar-001.jpg',
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'a1',
      fingerprint: 'fp-a1',
      embedding: unit128(0),
      personId: 'legacy-person',
      cropPath: null,
    }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'b0', fingerprint: 'fp-b0', embedding: unit128(5) }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'b1', fingerprint: 'fp-b1', embedding: unit128(5) }));

    const result = await runFacesReclusterPass(deps, { dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.personsWithoutExemplar).toBe(1);

    const reloaded = await deps.globalCatalog.listFaceObservations();
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) throw new Error('expected observations');
    const carried = reloaded.value.find((observation) => observation.obsId === 'a0');
    expect(carried?.cropPath).toBe('/home/.ai-video-cataloger/faces/legacy/exemplar-001.jpg');
  });

  it('every rebuilt cluster of two or more observations keeps a photographed observation', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');
    const engineA = new ScriptedFaceEngine();
    engineA.maxDetections = 1;
    deps.faceEngine = engineA;
    await facesIndex(deps, { root: '/work/videos' });

    await seedFile(deps, 'fp-b', 'b.mp4');
    const engineB = new ScriptedFaceEngine();
    engineB.maxDetections = 1;
    deps.faceEngine = engineB;
    await facesIndex(deps, { root: '/work/videos' });

    const status = await runFacesReclusterPass(deps, { dryRun: false });
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error(status.error.message);
    expect(status.value.personsWithoutExemplar).toBe(0);

    const people = await deps.globalCatalog.listPeople();
    expect(people.ok).toBe(true);
    if (!people.ok) throw new Error('expected people');
    const observations = await deps.globalCatalog.listFaceObservations();
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    for (const person of people.value) {
      const owned = observations.value.filter((observation) => observation.personId === person.personId);
      if (owned.length < 2) continue;
      expect(owned.some((observation) => observation.cropPath !== null)).toBe(true);
    }
  });

  it('exemplars of a rebuilt person still span more than one file', async () => {
    const deps = buildScriptableDeps();
    await enableFaces(deps);
    await seedFolder(deps);
    await seedFile(deps, 'fp-a', 'a.mp4');
    const engineA = new ScriptedFaceEngine();
    engineA.maxDetections = 1;
    deps.faceEngine = engineA;
    await facesIndex(deps, { root: '/work/videos' });

    await seedFile(deps, 'fp-b', 'b.mp4');
    const engineB = new ScriptedFaceEngine();
    engineB.maxDetections = 1;
    deps.faceEngine = engineB;
    await facesIndex(deps, { root: '/work/videos' });

    const reclustered = await runFacesReclusterPass(deps, { dryRun: false });
    expect(reclustered.ok).toBe(true);

    const people = await facesPeople(deps);
    expect(people.ok).toBe(true);
    if (!people.ok) throw new Error(people.error.message);
    const person = people.value.people.find((candidate) => candidate.exemplarCropPaths.length >= 2);
    expect(person).toBeDefined();
    const fingerprints = new Set(person?.exemplarCropPaths.map((cropPath) => cropPath.split('/').slice(0, -1).join('/')));
    expect(fingerprints.size).toBeGreaterThan(1);
  });
});

describe('facesRecluster does not invalidate the engine version', () => {
  it('leaves faceIndexState untouched', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalogFor(deps);
    await deps.globalCatalog.completeFaceIndex('fp-clip', FACE_ENGINE_VERSION);
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'o1', fingerprint: 'fp-clip', embedding: unit128(0) }));

    const before = deps.globalCatalog.deleteFaceObservationsForFileCalls;
    const indexed = await runFacesIndexPass(deps, { root: '/work/videos' });
    expect(indexed.ok).toBe(true);
    expect(deps.globalCatalog.deleteFaceObservationsForFileCalls).toBe(before);
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-clip' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value.map((observation) => observation.obsId)).toContain('o1');

    const reclustered = await runFacesReclusterPass(deps, { dryRun: false });
    expect(reclustered.ok).toBe(true);
    const status = await deps.globalCatalog.faceStatus();
    expect(status.ok && status.value.staleVersionFiles).toBe(0);
  });
});

const seedCatalogFor = async (deps: FacesDeps & { fs: InMemoryFileSystem }): Promise<void> => {
  deps.fs.addDirectory('/work/videos');
  await deps.globalCatalog.upsertFolder({
    folderId: '11111111-1111-1111-1111-111111111111',
    currentPath: '/work/videos',
    displayName: 'videos',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  });
  await deps.globalCatalog.upsertFile({
    fingerprint: 'fp-clip',
    folderId: '11111111-1111-1111-1111-111111111111',
    fileName: 'clip.mp4',
    size: 1,
    durationS: 10,
    width: null,
    height: null,
    gpsLat: null,
    gpsLon: null,
    processedAt: '2026-01-01T00:00:00.000Z',
    analyzer: 'claude',
    model: 'sonnet',
    missingAt: null,
    capturedAt: null,
    capturedAtSource: null,
    gpsSource: null,
    gpsAccuracyM: null,
    gpsIntervalKind: null,
    gpsResolvedAt: null,
    place: null,
  });
  await deps.globalCatalog.upsertAnalysis({
    fingerprint: 'fp-clip',
    finalName: 'clip',
    description: 'a clip',
    transcript: null,
    language: null,
    tags: [],
  });
};

describe('facesExemplars', () => {
  const seedVideo = async (
    deps: FacesDeps & { fs: InMemoryFileSystem },
    fingerprint: string,
    fileName: string,
  ): Promise<void> => {
    await deps.globalCatalog.upsertFolder({
      folderId,
      currentPath: '/work/videos',
      displayName: 'videos',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.globalCatalog.upsertFile({
      fingerprint,
      folderId,
      fileName,
      size: 1,
      durationS: 10,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await deps.globalCatalog.upsertAnalysis({
      fingerprint,
      finalName: fileName,
      description: 'a clip',
      transcript: null,
      language: null,
      tags: [],
    });
    deps.fs.addFile(`/work/videos/${fileName}`, { content: 'video' });
  };

  const boxFixture = { x: 0, y: 0, width: 200, height: 200 };

  it('fills the missing exemplar crops for the faces a person would show', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await seedVideo(deps, 'fp-b', 'b.mp4');
    await seedVideo(deps, 'fp-c', 'c.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p2' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p1', bbox: boxFixture, cropPath: null }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-c:face:1:1', fingerprint: 'fp-c', personId: 'p2', bbox: boxFixture, cropPath: null }));

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropsWritten).toBe(3);
    expect(result.value.peopleWithoutExemplarBefore).toBe(2);
    expect(result.value.peopleWithoutExemplarAfter).toBe(0);

    const observations = await deps.globalCatalog.listFaceObservations();
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value.every((observation) => observation.cropPath !== null)).toBe(true);
  });

  it('re-anchors a stale-home crop path before checking whether it still exists', async () => {
    const deps = buildDeps();
    deps.globalCatalog = new InMemoryGlobalCatalogStore('/new-home/.ai-video-cataloger/catalog.db');
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    const currentCropPath = '/new-home/.ai-video-cataloger/faces/obs/fp-a/1-1.jpg';
    deps.fs.addFile(currentCropPath, { content: 'jpg' });
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-a:face:1:1',
      fingerprint: 'fp-a',
      personId: 'p1',
      bbox: boxFixture,
      cropPath: '/old-home/.ai-video-cataloger/faces/obs/fp-a/1-1.jpg',
    }));

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropsWritten).toBe(0);
    expect(result.value.peopleWithoutExemplarBefore).toBe(0);
    expect(result.value.peopleWithoutExemplarAfter).toBe(0);
  });

  it('never re-embeds and never re-indexes while filling crops', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    const deleteCallsBefore = deps.globalCatalog.deleteFaceObservationsForFileCalls;

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });
    expect(result.ok).toBe(true);
    expect(deps.faceEngine.embedCalls).toBe(0);
    expect(deps.globalCatalog.deleteFaceObservationsForFileCalls).toBe(deleteCallsBefore);
    const state = await deps.globalCatalog.faceStatus();
    expect(state.ok && state.value.staleVersionFiles).toBe(0);
  });

  it('skips a detection that no longer matches the stored box, and survives an unreachable file', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await seedVideo(deps, 'fp-b', 'b.mp4');
    await deps.globalCatalog.upsertFile({
      fingerprint: 'fp-missing',
      folderId,
      fileName: 'missing.mp4',
      size: 1,
      durationS: 10,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await deps.globalCatalog.upsertAnalysis({
      fingerprint: 'fp-missing',
      finalName: 'missing.mp4',
      description: 'a clip',
      transcript: null,
      language: null,
      tags: [],
    });
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p2' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p3' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p2', bbox: boxFixture, cropPath: null }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-missing:face:1:1', fingerprint: 'fp-missing', personId: 'p3', bbox: boxFixture, cropPath: null }));
    deps.faceEngine.detectionByVideoPath.set('/work/videos/b.mp4', {
      ...deps.faceEngine.detection,
      bbox: { x: 500, y: 500, width: 200, height: 200 },
    });

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.detectionsMismatched).toBe(1);
    expect(result.value.filesUnavailable).toBe(1);
    expect(result.value.cropsWritten).toBe(1);

    const dryDeps = buildDeps();
    await enableFaces(dryDeps);
    await seedVideo(dryDeps, 'fp-a', 'a.mp4');
    await seedVideo(dryDeps, 'fp-b', 'b.mp4');
    await dryDeps.globalCatalog.upsertFile({
      fingerprint: 'fp-missing',
      folderId,
      fileName: 'missing.mp4',
      size: 1,
      durationS: 10,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
      missingAt: null,
      capturedAt: null,
      capturedAtSource: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    });
    await dryDeps.globalCatalog.upsertAnalysis({
      fingerprint: 'fp-missing',
      finalName: 'missing.mp4',
      description: 'a clip',
      transcript: null,
      language: null,
      tags: [],
    });
    await dryDeps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await dryDeps.globalCatalog.upsertPerson(personFixture({ personId: 'p2' }));
    await dryDeps.globalCatalog.upsertPerson(personFixture({ personId: 'p3' }));
    await dryDeps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    await dryDeps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p2', bbox: boxFixture, cropPath: null }));
    await dryDeps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-missing:face:1:1', fingerprint: 'fp-missing', personId: 'p3', bbox: boxFixture, cropPath: null }));

    const dryResult = await runFacesExemplarsPass(dryDeps, { dryRun: true, limit: null });
    expect(dryResult.ok).toBe(true);
    if (!dryResult.ok) throw new Error(dryResult.error.message);
    expect(dryResult.value.cropsWritten).toBe(0);
    expect(dryResult.value.detectionsMismatched).toBe(0);
    expect(dryResult.value.filesUnavailable).toBe(1);
    expect(dryDeps.faceEngine.detectInputs).toHaveLength(0);
  });

  it('survives a file whose frames cannot be decoded and keeps repairing the rest', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await seedVideo(deps, 'fp-b', 'b.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p2' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p2', bbox: boxFixture, cropPath: null }));
    deps.faceEngine.detectFailureVideoPaths.add('/work/videos/a.mp4');

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.filesUnavailable).toBe(1);
    expect(result.value.cropsWritten).toBe(1);

    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-b' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value[0]?.cropPath).not.toBeNull();
  });

  it('treats a crop whose file vanished as missing', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: 'fp-a:face:1:1',
      fingerprint: 'fp-a',
      personId: 'p1',
      bbox: boxFixture,
      cropPath: '/home/.ai-video-cataloger/faces/obs/fp-a/1-1.jpg',
    }));

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.cropsWritten).toBe(1);

    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint: 'fp-a' });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value[0]?.cropPath).not.toBeNull();
  });

  const seedPhoto = async (
    deps: FacesDeps & { fs: InMemoryFileSystem; photos: InMemoryPhotosStore },
    fingerprint: string,
    fileName: string,
    proxyState: 'done' | 'failed' = 'done',
  ): Promise<string> => {
    const proxyPath = `/home/.ai-video-cataloger/photo-artifacts/proxies/${fingerprint}.jpg`;
    if (proxyState === 'done') deps.fs.addFile(proxyPath, { content: 'proxy' });
    await deps.photos.upsertPhoto({
      fingerprint,
      folderId: 'photo-folder',
      fileName,
      currentPath: `/work/photos/${fileName}`,
      ext: 'jpg',
      size: 1,
      width: 1280,
      height: 720,
      orientation: null,
      cameraMake: null,
      cameraModel: null,
      lens: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      exifRating: null,
      capturedAt: null,
      capturedAtSource: 'file_mtime',
      gpsLat: null,
      gpsLon: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      placeName: null,
      placeRegion: null,
      placeCountry: null,
      placeCountryCode: null,
      placeDistanceM: null,
      placeDataset: null,
      discoveredAt: '2026-01-01T00:00:00.000Z',
      exifReadAt: '2026-01-01T00:00:00.000Z',
      proxyState,
      proxyWidth: proxyState === 'done' ? 1280 : null,
      proxyHeight: proxyState === 'done' ? 720 : null,
      thumbState: 'done',
      missingAt: null,
      selectedConfigId: null,
    });
    return proxyPath;
  };

  it('repairs a photo crop from the photo proxy instead of reporting the photo unavailable', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const fingerprint = 'ph_0000000000000001';
    const proxyPath = await seedPhoto(deps, fingerprint, 'one.jpg');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: `${fingerprint}:face:1:1`,
      fingerprint,
      personId: 'p1',
      frameTsS: null,
      media: 'photo',
      bbox: boxFixture,
      cropPath: null,
    }));

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.filesUnavailable).toBe(0);
    expect(result.value.filesVisited).toBe(1);
    expect(result.value.cropsWritten).toBe(1);
    expect(result.value.peopleWithoutExemplarAfter).toBe(0);
    expect(deps.faceEngine.detectInputs).toContainEqual({ kind: 'image-path', frameJpegPath: proxyPath });
    const observations = await deps.globalCatalog.listFaceObservations({ fingerprint });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error('expected observations');
    expect(observations.value[0]?.cropPath).toMatch(/faces\/obs\/ph_0000000000000001\/1-1\.jpg$/);
  });

  it('counts a photo whose proxy is missing as unavailable rather than failing the pass', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const fingerprint = 'ph_0000000000000002';
    await seedPhoto(deps, fingerprint, 'two.jpg', 'failed');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({
      obsId: `${fingerprint}:face:1:1`,
      fingerprint,
      personId: 'p1',
      frameTsS: null,
      media: 'photo',
      bbox: boxFixture,
      cropPath: null,
    }));

    const result = await runFacesExemplarsPass(deps, { dryRun: false, limit: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.filesUnavailable).toBe(1);
    expect(result.value.cropsWritten).toBe(0);
  });

  it('facesExemplars enqueues a job that runs the pass and gates on faces_enabled', async () => {
    const deps = buildDeps();
    const disabled = await facesExemplars(deps, { dryRun: false, limit: null });
    expect(disabled.ok).toBe(false);
    if (disabled.ok) throw new Error('expected disabled error');
    expect(disabled.error.code).toBe('faces_disabled');

    await enableFaces(deps);
    await seedVideo(deps, 'fp-a', 'a.mp4');
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', bbox: boxFixture, cropPath: null }));
    const enqueued = await facesExemplars(deps, { dryRun: false, limit: null });
    expect(enqueued.ok).toBe(true);
    const jobs = await deps.jobs.list();
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) throw new Error('expected jobs');
    expect(jobs.value.at(-1)?.status).toBe('completed');
  });
});

describe('faces jobs share a single faces-write resource', () => {
  const blockedJob = (): { run: () => Promise<Result<unknown, AppError>>; release: () => void } => {
    let release: () => void = () => {};
    const blocking = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { run: async () => { await blocking; return ok({}); }, release };
  };

  it('rejects a concurrent facesRecluster while a faces-write job is running', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const blocked = blockedJob();
    const holder = deps.jobs.enqueue({ kind: 'faces_index', payload: {}, resourceKey: 'faces-write', run: blocked.run });

    const recluster = await facesRecluster(deps, { dryRun: false });
    expect(recluster).toMatchObject({ ok: false, error: { code: 'conflict' } });

    blocked.release();
    await holder;
  });

  it('rejects a concurrent facesExemplars while a faces-write job is running', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    const blocked = blockedJob();
    const holder = deps.jobs.enqueue({ kind: 'faces_index', payload: {}, resourceKey: 'faces-write', run: blocked.run });

    const exemplars = await facesExemplars(deps, { dryRun: false, limit: null });
    expect(exemplars).toMatchObject({ ok: false, error: { code: 'conflict' } });

    blocked.release();
    await holder;
  });

  it('rejects a concurrent facesIndex while facesRecluster holds faces-write', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    deps.fs.addDirectory('/work/videos');
    const blocked = blockedJob();
    const holder = deps.jobs.enqueue({ kind: 'faces_recluster', payload: {}, resourceKey: 'faces-write', run: blocked.run });

    const index = await facesIndex(deps, { root: '/work/videos' });
    expect(index).toMatchObject({ ok: false, error: { code: 'conflict' } });

    blocked.release();
    await holder;
  });
});

describe('facesPeople per-medium counts', () => {
  it('reports how many of a person\'s observations are videos and how many are photos', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p1' }));
    await deps.globalCatalog.upsertPerson(personFixture({ personId: 'p2' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-a:face:1:1', fingerprint: 'fp-a', personId: 'p1', media: 'video' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'ph_1:face:1:1', fingerprint: 'ph_1', personId: 'p1', frameTsS: null, media: 'photo' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'ph_2:face:1:1', fingerprint: 'ph_2', personId: 'p1', frameTsS: null, media: 'photo' }));
    await deps.globalCatalog.upsertFaceObservation(observationFixture({ obsId: 'fp-b:face:1:1', fingerprint: 'fp-b', personId: 'p2', media: 'video' }));

    const result = await facesPeople(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const first = result.value.people.find((person) => person.personId === 'p1');
    const second = result.value.people.find((person) => person.personId === 'p2');
    expect(first).toMatchObject({ observationCount: 3, videoCount: 1, photoCount: 2 });
    expect(second).toMatchObject({ observationCount: 1, videoCount: 1, photoCount: 0 });
  });
});
