import { describe, expect, it } from 'vitest';

import {
  facesForget,
  facesIndex,
  facesMerge,
  facesName,
  facesPeople,
  facesPurge,
  facesStatus,
} from './faces.js';
import type { FacesDeps } from './faces.js';
import {
  InMemoryConfig,
  InMemoryDownloads,
  InMemoryFileSystem,
  InMemoryGlobalCatalogStore,
  InMemoryJobs,
  InMemoryMedia,
} from '../../../test/server/usecases/test-fakes.js';
import { normalizeEmbedding, ok, type AppError, type FaceObservation, type Person, type Result } from '@core/domain/index.js';
import type { AlignedFaceCrop, DependencyStatus, FaceDetection, FaceEnginePort, FaceFrameInput } from '../ports.js';

const unit128 = (offset = 0): number[] =>
  normalizeEmbedding(Array.from({ length: 128 }, (_value, index) => (index === offset ? 1 : 0.001)));

class FakeFaceEngine implements FaceEnginePort {
  loadCalls = 0;
  disposeCalls = 0;
  readonly cropWrites: string[] = [];
  readonly detectInputs: Array<FaceFrameInput | string> = [];
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
    return Promise.resolve(ok([this.detection]));
  }

  align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    return Promise.resolve(ok({ frameJpegPath, detection, width: 112, height: 112 }));
  }

  embed(): Promise<Result<Float32Array, AppError>> {
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
  frameTsS: overrides.frameTsS ?? 1,
  bbox: overrides.bbox ?? { x: 0, y: 0, width: 100, height: 100 },
  embedding: overrides.embedding ?? unit128(),
  quality: overrides.quality ?? 0.95,
  personId: overrides.personId ?? null,
  cropPath: overrides.cropPath ?? null,
});

const buildDeps = (): FacesDeps & {
  config: InMemoryConfig;
  downloads: InMemoryDownloads;
  globalCatalog: InMemoryGlobalCatalogStore;
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
    fs: new InMemoryFileSystem(),
    media: new InMemoryMedia(),
    jobs: new InMemoryJobs(),
    faceEngine: new FakeFaceEngine(),
  };
};

const enableFaces = async (deps: FacesDeps): Promise<void> => {
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
});

describe('facesIndex', () => {
  const seedCatalog = async (deps: FacesDeps): Promise<void> => {
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
      gpsLat: null,
      gpsLon: null,
      processedAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'claude',
      model: 'sonnet',
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

  it('caps exemplar crops per person at the configured limit', async () => {
    const deps = buildDeps();
    await enableFaces(deps);
    await seedCatalog(deps);

    await facesIndex(deps, { root: '/work/videos' });

    const people = await deps.globalCatalog.listPeople();
    expect(people.ok).toBe(true);
    if (!people.ok) throw new Error('expected people');
    const personId = people.value[0]?.personId;
    expect(personId).toBeDefined();
    if (personId === undefined) throw new Error('expected a clustered person');
    const observations = await deps.globalCatalog.listFaceObservations({ personId });
    expect(observations.ok).toBe(true);
    if (!observations.ok) throw new Error(observations.error.message);
    const crops = observations.value.filter((observation) => observation.cropPath !== null).length;
    expect(crops).toBe(5);
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
});
