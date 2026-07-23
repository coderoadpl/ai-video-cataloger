import {
  FACE_ENGINE_VERSION,
  FACE_LIMITS,
  FILE_ARTIFACTS,
  classifyFace,
  findNewClusterSeed,
  normalizeEmbedding,
  passesFaceQuality,
  updateCentroid,
  appError,
  ok,
  type AppError,
  type FaceObservation,
  type Person,
  type Result,
} from '@core/domain/index.js';

import type {
  AlignedFaceCrop,
  FaceDetection,
  FaceEnginePort,
  FileSystemPort,
  GlobalCatalogStore,
  JobExecutionContext,
  JobsPort,
  MediaPort,
  ModelDownloadPort,
  ConfigStore,
} from '../ports.js';
import { resolveConfigValues } from './config-resolution.js';

export interface FacesDeps {
  config: ConfigStore;
  downloads: ModelDownloadPort;
  faceEngine: FaceEnginePort;
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
  jobs: JobsPort;
  media: MediaPort;
}

export interface FacesIndexOutput {
  root: string;
  filesScanned: number;
  filesIndexed: number;
  observationsAdded: number;
  peopleCreated: number;
}

export interface FacesStatusOutput {
  enabled: boolean;
  artifactsReady: boolean;
  people: number;
  observations: number;
  assignedObservations: number;
  unassignedObservations: number;
  filesIndexed: number;
  staleVersionFiles: number;
}

interface ObservationContext {
  observation: FaceObservation;
  alignedCrop: AlignedFaceCrop;
}

interface FacePersonView extends Person {
  observationCount: number;
  exemplarCropPath: string | null;
}

export const facesIndex = async (
  deps: FacesDeps,
  input: { root: string },
): Promise<Result<{ jobId: string }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps, input.root);
  if (!enabled.ok) return enabled;
  return deps.jobs.enqueue({
    kind: 'faces_index',
    payload: input,
    resourceKey: `faces-index:${deps.fs.resolve(input.root)}`,
    run: (context) => runFacesIndex(deps, { root: deps.fs.resolve(input.root) }, context),
  });
};

export const facesPeople = async (deps: FacesDeps): Promise<Result<{ people: FacePersonView[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;
  return ok({ people: people.value.map((person) => personView(person, observations.value)) });
};

export const facesName = async (
  deps: FacesDeps,
  input: { personId: string; displayName: string },
): Promise<Result<{ personId: string; displayName: string; affectedFingerprints: string[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const named = await deps.globalCatalog.setPersonName(input.personId, input.displayName.trim());
  if (!named.ok) return named;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  return named;
};

export const facesMerge = async (
  deps: FacesDeps,
  input: { fromPersonId: string; toPersonId: string },
): Promise<Result<{ fromPersonId: string; toPersonId: string; movedObservations: number; affectedFingerprints: string[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  if (input.fromPersonId === input.toPersonId) {
    return { ok: false, error: appError('validation', 'Cannot merge a person into itself') };
  }
  return deps.globalCatalog.mergePeople(input);
};

export const facesForget = async (
  deps: FacesDeps,
  input: { personId: string; force: boolean },
): Promise<Result<{ personId: string; deleted: boolean; cropPathsDeleted: number; affectedFingerprints: string[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  if (!input.force) return { ok: false, error: appError('confirmation_required', 'Forget requires --force flag') };
  const forgotten = await deps.globalCatalog.forgetPerson(input.personId);
  if (!forgotten.ok) return forgotten;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  const deleted = await deleteCropPaths(deps.fs, forgotten.value.cropPaths);
  if (!deleted.ok) return deleted;
  return ok({
    personId: forgotten.value.personId,
    deleted: forgotten.value.deleted,
    cropPathsDeleted: deleted.value,
    affectedFingerprints: forgotten.value.affectedFingerprints,
  });
};

export const facesPurge = async (
  deps: FacesDeps,
  input: { force: boolean },
): Promise<Result<{ peopleDeleted: number; observationsDeleted: number; cropPathsDeleted: number }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  if (!input.force) return { ok: false, error: appError('confirmation_required', 'Purge requires --force flag') };
  const purged = await deps.globalCatalog.purgeFaces();
  if (!purged.ok) return purged;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  const deleted = await deleteCropPaths(deps.fs, purged.value.cropPaths);
  if (!deleted.ok) return deleted;
  return ok({
    peopleDeleted: purged.value.peopleDeleted,
    observationsDeleted: purged.value.observationsDeleted,
    cropPathsDeleted: deleted.value,
  });
};

export const facesStatus = async (deps: FacesDeps): Promise<Result<FacesStatusOutput, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const counts = await deps.globalCatalog.faceStatus();
  if (!counts.ok) return counts;
  const artifactsReady = await faceArtifactsReady(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  return ok({ enabled: true, artifactsReady: artifactsReady.value, ...counts.value });
};

const runFacesIndex = async (
  deps: FacesDeps,
  input: { root: string },
  progress: JobExecutionContext,
): Promise<Result<FacesIndexOutput, AppError>> => {
  const artifactsReady = await faceArtifactsReady(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  if (!artifactsReady.value) return { ok: false, error: appError('model_not_installed', 'Face artifacts are not installed') };
  const candidates = await deps.globalCatalog.listFaceIndexCandidates(input.root);
  if (!candidates.ok) return candidates;
  const started = await progress.reportProgress({
    step: 'faces_scanning',
    percentage: 0,
    total: Math.max(candidates.value.length, 1),
    data: { root: input.root, filesTotal: candidates.value.length },
  });
  if (!started.ok) return started;

  const loaded = await deps.faceEngine.load();
  if (!loaded.ok) return loaded;
  let filesIndexed = 0;
  let observationsAdded = 0;
  let peopleCreated = 0;
  const seeded = await deps.globalCatalog.listUnassignedFaceObservations();
  if (!seeded.ok) return seeded;
  let contexts: ObservationContext[] = seeded.value.map(persistedContext);

  try {
    for (let candidateIndex = 0; candidateIndex < candidates.value.length; candidateIndex += 1) {
      const candidate = candidates.value[candidateIndex];
      if (candidate === undefined) continue;
      const fingerprint = candidate.file.fingerprint;
      const stale = candidate.previousEngineVersion !== null && candidate.previousEngineVersion < FACE_ENGINE_VERSION;
      if (stale) {
        const purged = await deps.globalCatalog.deleteFaceObservationsForFile(fingerprint);
        if (!purged.ok) return purged;
        contexts = contexts.filter((context) => context.observation.fingerprint !== fingerprint);
      }
      const existing = await deps.globalCatalog.listFaceObservations({ fingerprint });
      if (!existing.ok) return existing;
      const existingObsIds = new Set(existing.value.map((observation) => observation.obsId));
      const videoPath = deps.fs.join(candidate.folder.currentPath, candidate.file.fileName);
      const frameDirectory = deps.fs.join(deps.fs.tempDirectory(), 'ai-video-cataloger', 'faces', fingerprint);
      const extracting = await progress.reportProgress({
        step: 'faces_extracting_frames',
        current: candidateIndex + 1,
        total: candidates.value.length,
        data: { fingerprint, videoPath },
      });
      if (!extracting.ok) return extracting;
      const frames = await deps.media.extractFrames({
        videoPath,
        outputDirectory: frameDirectory,
        frameCount: FACE_LIMITS.maxFramesPerVideo,
        signal: progress.signal,
      });
      if (!frames.ok) return frames;
      const probe = await deps.media.probe({ videoPath });
      if (!probe.ok) return probe;
      const added = await indexFramesForFile(deps, {
        fingerprint,
        videoPath,
        durationS: probe.value.duration,
        framePaths: frames.value.framePaths,
      }, contexts, existingObsIds, progress);
      if (!added.ok) return added;
      const completed = await deps.globalCatalog.completeFaceIndex(fingerprint, FACE_ENGINE_VERSION);
      if (!completed.ok) return completed;
      observationsAdded += added.value.observationsAdded;
      peopleCreated += added.value.peopleCreated;
      filesIndexed += 1;
      for (const context of contexts) releaseCropPixels(context.alignedCrop);
    }
  } finally {
    await deps.faceEngine.dispose();
  }

  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;

  const done = await progress.reportProgress({
    step: 'faces_done',
    percentage: 100,
    data: { filesIndexed, observationsAdded, peopleCreated },
  });
  if (!done.ok) return done;
  return ok({
    root: input.root,
    filesScanned: candidates.value.length,
    filesIndexed,
    observationsAdded,
    peopleCreated,
  });
};

const indexFramesForFile = async (
  deps: FacesDeps,
  input: { fingerprint: string; videoPath: string; durationS: number | null; framePaths: string[] },
  contexts: ObservationContext[],
  existingObsIds: ReadonlySet<string>,
  progress: JobExecutionContext,
): Promise<Result<{ observationsAdded: number; peopleCreated: number }, AppError>> => {
  let observationsAdded = 0;
  let peopleCreated = 0;
  for (let frameIndex = 0; frameIndex < input.framePaths.length; frameIndex += 1) {
    const framePath = input.framePaths[frameIndex];
    if (framePath === undefined) continue;
    const detecting = await progress.reportProgress({
      step: 'faces_detecting',
      current: frameIndex + 1,
      total: input.framePaths.length,
      data: { fingerprint: input.fingerprint, framePath },
    });
    if (!detecting.ok) return detecting;
    const timestampS = frameTimestamp(input.durationS, frameIndex, input.framePaths.length);
    const detections = await deps.faceEngine.detect({
      kind: 'video-timestamp',
      videoPath: input.videoPath,
      timestampS,
      fallbackFrameJpegPath: framePath,
    });
    if (!detections.ok) return detections;
    let detectionIndex = 0;
    for (const detection of detections.value) {
      const indexed = await indexDetection(deps, { fingerprint: input.fingerprint, frameTsS: timestampS }, framePath, frameIndex, detectionIndex, detection, contexts, existingObsIds);
      if (!indexed.ok) return indexed;
      observationsAdded += indexed.value.observationsAdded;
      peopleCreated += indexed.value.peopleCreated;
      detectionIndex += 1;
    }
  }
  return ok({ observationsAdded, peopleCreated });
};

const indexDetection = async (
  deps: FacesDeps,
  input: { fingerprint: string; frameTsS: number },
  framePath: string,
  frameIndex: number,
  detectionIndex: number,
  detection: FaceDetection,
  contexts: ObservationContext[],
  existingObsIds: ReadonlySet<string>,
): Promise<Result<{ observationsAdded: number; peopleCreated: number }, AppError>> => {
  const obsId = `${input.fingerprint}:face:${frameIndex + 1}:${detectionIndex + 1}`;
  if (existingObsIds.has(obsId)) return ok({ observationsAdded: 0, peopleCreated: 0 });
  const boxPx = Math.min(detection.bbox.width, detection.bbox.height);
  if (!passesFaceQuality({ score: detection.score, boxPx })) return ok({ observationsAdded: 0, peopleCreated: 0 });
  const aligned = await deps.faceEngine.align(framePath, detection);
  if (!aligned.ok) return aligned;
  const embedded = await deps.faceEngine.embed(aligned.value);
  if (!embedded.ok) return embedded;
  const embedding = normalizeEmbedding([...embedded.value]);
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const assignment = classifyFace(embedding, people.value.map((person) => ({ personId: person.personId, centroid: person.centroid })));
  const assignedPersonId = assignment.decision === 'assign' ? assignment.personId : null;
  const cropPath = assignedPersonId === null ? null : await nextCropPath(deps, assignedPersonId, aligned.value);
  if (typeof cropPath !== 'string' && cropPath !== null) return cropPath;
  const observation: FaceObservation = {
    obsId,
    fingerprint: input.fingerprint,
    kind: 'face',
    frameTsS: input.frameTsS,
    bbox: detection.bbox,
    embedding,
    quality: detection.score,
    personId: assignedPersonId,
    cropPath,
  };
  const stored = await deps.globalCatalog.upsertFaceObservation(observation);
  if (!stored.ok) return stored;
  if (assignedPersonId !== null) releaseCropPixels(aligned.value);
  contexts.push({ observation, alignedCrop: aligned.value });
  if (assignedPersonId !== null) {
    const updated = await updatePersonCentroid(deps.globalCatalog, assignedPersonId, embedding);
    if (!updated.ok) return updated;
    return ok({ observationsAdded: 1, peopleCreated: 0 });
  }
  const clustered = await seedNewPersonIfReady(deps, contexts);
  if (!clustered.ok) return clustered;
  return ok({ observationsAdded: 1, peopleCreated: clustered.value });
};

const seedNewPersonIfReady = async (
  deps: FacesDeps,
  contexts: ObservationContext[],
): Promise<Result<number, AppError>> => {
  const unassigned = contexts.filter((context) => context.observation.personId === null);
  const seed = findNewClusterSeed(unassigned.map((context) => context.observation.embedding));
  if (seed.length === 0) return ok(0);
  const personId = `person-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const embeddings = seed.map((index) => unassigned[index]?.observation.embedding).filter((value): value is number[] => value !== undefined);
  const person: Person = {
    personId,
    displayName: null,
    kind: 'face',
    createdAt: new Date().toISOString(),
    centroid: centroidFor(embeddings),
    exemplarCount: embeddings.length,
  };
  const stored = await deps.globalCatalog.upsertPerson(person);
  if (!stored.ok) return stored;
  let assigned = 0;
  for (const index of seed) {
    const context = unassigned[index];
    if (context === undefined) continue;
    const cropPath = assigned < FACE_LIMITS.maxExemplarsPerPerson && context.alignedCrop.data !== undefined
      ? await nextCropPath(deps, personId, context.alignedCrop)
      : null;
    if (typeof cropPath !== 'string' && cropPath !== null) return cropPath;
    const observation = { ...context.observation, personId, cropPath };
    const updated = await deps.globalCatalog.upsertFaceObservation(observation);
    if (!updated.ok) return updated;
    context.observation = observation;
    releaseCropPixels(context.alignedCrop);
    assigned += 1;
  }
  return ok(1);
};

const frameTimestamp = (durationS: number | null, frameIndex: number, frameCount: number): number =>
  durationS === null ? frameIndex + 1 : durationS * ((frameIndex + 1) / (frameCount + 1));

const updatePersonCentroid = async (
  store: GlobalCatalogStore,
  personId: string,
  embedding: readonly number[],
): Promise<Result<void, AppError>> => {
  const person = await store.getPerson(personId);
  if (!person.ok) return person;
  if (person.value === null) return { ok: false, error: appError('not_found', `Person not found: ${personId}`) };
  return store.upsertPerson({
    ...person.value,
    centroid: updateCentroid(person.value.centroid, person.value.exemplarCount, embedding),
    exemplarCount: person.value.exemplarCount + 1,
  });
};

const nextCropPath = async (
  deps: FacesDeps,
  personId: string,
  alignedCrop: AlignedFaceCrop,
): Promise<string | null | Result<never, AppError>> => {
  const observations = await deps.globalCatalog.listFaceObservations({ personId });
  if (!observations.ok) return observations;
  const crops = observations.value.filter((observation) => observation.cropPath !== null).length;
  if (crops >= FACE_LIMITS.maxExemplarsPerPerson) return null;
  const directory = deps.fs.join(deps.fs.dirname(deps.globalCatalog.databasePath()), 'faces', personId);
  const ensured = await deps.fs.ensureDirectory(directory);
  if (!ensured.ok) return ensured;
  const cropPath = deps.fs.join(directory, `exemplar-${String(crops + 1).padStart(3, '0')}.jpg`);
  const written = await deps.faceEngine.writeCrop(alignedCrop, cropPath);
  if (!written.ok) return written;
  return cropPath;
};

const ensureFacesEnabled = async (
  deps: Pick<FacesDeps, 'config' | 'fs'>,
  folder?: string | undefined,
): Promise<Result<void, AppError>> => {
  const resolved = await resolveConfigValues(deps.config, folder === undefined ? undefined : deps.fs.resolve(folder));
  if (!resolved.ok) return resolved;
  const enabled = resolved.value.effective.faces_enabled;
  if (enabled === 'true' || enabled === 'yes' || enabled === '1') return ok(undefined);
  return { ok: false, error: appError('faces_disabled', 'Face indexing is disabled. Set faces_enabled=true to enable it.') };
};

const faceArtifactsReady = async (downloads: ModelDownloadPort): Promise<Result<boolean, AppError>> => {
  for (const artifact of Object.values(FILE_ARTIFACTS)) {
    const downloaded = await downloads.isFileArtifactDownloaded(artifact);
    if (!downloaded.ok) return downloaded;
    if (!downloaded.value) return ok(false);
  }
  return ok(true);
};

const personView = (person: Person, observations: readonly FaceObservation[]): FacePersonView => {
  const matching = observations.filter((observation) => observation.personId === person.personId);
  const exemplar = matching.find((observation) => observation.cropPath !== null);
  return {
    ...person,
    observationCount: matching.length,
    exemplarCropPath: exemplar?.cropPath ?? null,
  };
};

const releaseCropPixels = (crop: AlignedFaceCrop): void => {
  crop.data = undefined;
};

const persistedContext = (observation: FaceObservation): ObservationContext => ({
  observation,
  alignedCrop: {
    frameJpegPath: observation.cropPath ?? '',
    detection: {
      bbox: observation.bbox,
      landmarks: {
        leftEye: { x: 0, y: 0 },
        rightEye: { x: 0, y: 0 },
        nose: { x: 0, y: 0 },
        leftMouth: { x: 0, y: 0 },
        rightMouth: { x: 0, y: 0 },
      },
      score: observation.quality,
    },
    width: 0,
    height: 0,
    data: undefined,
  },
});

const deleteCropPaths = async (fs: FileSystemPort, cropPaths: readonly string[]): Promise<Result<number, AppError>> => {
  let deleted = 0;
  for (const cropPath of cropPaths) {
    const result = await fs.deleteFile(cropPath);
    if (!result.ok) return result;
    deleted += 1;
  }
  return ok(deleted);
};

const centroidFor = (embeddings: readonly (readonly number[])[]): number[] => {
  if (embeddings.length === 0) return Array.from({ length: 128 }, () => 0);
  const totals = Array.from({ length: 128 }, () => 0);
  for (const embedding of embeddings) {
    embedding.forEach((value, index) => {
      const current = totals[index];
      if (current !== undefined) totals[index] = current + value;
    });
  }
  return normalizeEmbedding(totals.map((value) => value / embeddings.length));
};
