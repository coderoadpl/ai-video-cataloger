import {
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
}

interface ObservationContext {
  observation: FaceObservation;
  videoPath: string;
  frameIndex: number;
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

export const facesPeople = async (deps: FacesDeps): Promise<Result<{ people: Person[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  return ok({ people: people.value });
};

export const facesName = async (
  deps: FacesDeps,
  input: { personId: string; displayName: string },
): Promise<Result<{ personId: string; displayName: string; affectedFingerprints: string[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  return deps.globalCatalog.setPersonName(input.personId, input.displayName.trim());
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
  const contexts: ObservationContext[] = [];

  try {
    for (let candidateIndex = 0; candidateIndex < candidates.value.length; candidateIndex += 1) {
      const candidate = candidates.value[candidateIndex];
      if (candidate === undefined) continue;
      const videoPath = deps.fs.join(candidate.folder.currentPath, candidate.file.fileName);
      const frameDirectory = deps.fs.join(deps.fs.tempDirectory(), 'ai-video-cataloger', 'faces', candidate.file.fingerprint);
      const extracting = await progress.reportProgress({
        step: 'faces_extracting_frames',
        current: candidateIndex + 1,
        total: candidates.value.length,
        data: { fingerprint: candidate.file.fingerprint, videoPath },
      });
      if (!extracting.ok) return extracting;
      const frames = await deps.media.extractFrames({
        videoPath,
        outputDirectory: frameDirectory,
        frameCount: FACE_LIMITS.maxFramesPerVideo,
        signal: progress.signal,
      });
      if (!frames.ok) return frames;
      const added = await indexFramesForFile(deps, {
        fingerprint: candidate.file.fingerprint,
        videoPath,
        framePaths: frames.value.framePaths,
      }, contexts, progress);
      if (!added.ok) return added;
      observationsAdded += added.value.observationsAdded;
      peopleCreated += added.value.peopleCreated;
      filesIndexed += 1;
    }
  } finally {
    await deps.faceEngine.dispose();
  }

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
  input: { fingerprint: string; videoPath: string; framePaths: string[] },
  contexts: ObservationContext[],
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
    const detections = await deps.faceEngine.detect(framePath);
    if (!detections.ok) return detections;
    let detectionIndex = 0;
    for (const detection of detections.value) {
      const indexed = await indexDetection(deps, input, framePath, frameIndex, detectionIndex, detection, contexts);
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
  input: { fingerprint: string; videoPath: string },
  framePath: string,
  frameIndex: number,
  detectionIndex: number,
  detection: FaceDetection,
  contexts: ObservationContext[],
): Promise<Result<{ observationsAdded: number; peopleCreated: number }, AppError>> => {
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
  const cropPath = assignedPersonId === null ? null : await nextCropPath(deps, assignedPersonId, input.videoPath, frameIndex);
  if (typeof cropPath !== 'string' && cropPath !== null) return cropPath;
  const observation: FaceObservation = {
    obsId: `${input.fingerprint}:face:${frameIndex + 1}:${detectionIndex + 1}`,
    fingerprint: input.fingerprint,
    kind: 'face',
    frameTsS: frameIndex + 1,
    bbox: detection.bbox,
    embedding,
    quality: detection.score,
    personId: assignedPersonId,
    cropPath,
  };
  const stored = await deps.globalCatalog.upsertFaceObservation(observation);
  if (!stored.ok) return stored;
  contexts.push({ observation, videoPath: input.videoPath, frameIndex });
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
    const cropPath = assigned < FACE_LIMITS.maxExemplarsPerPerson
      ? await nextCropPath(deps, personId, context.videoPath, context.frameIndex)
      : null;
    if (typeof cropPath !== 'string' && cropPath !== null) return cropPath;
    const observation = { ...context.observation, personId, cropPath };
    const updated = await deps.globalCatalog.upsertFaceObservation(observation);
    if (!updated.ok) return updated;
    context.observation = observation;
    assigned += 1;
  }
  return ok(1);
};

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
  videoPath: string,
  frameIndex: number,
): Promise<string | null | Result<never, AppError>> => {
  const observations = await deps.globalCatalog.listFaceObservations({ personId });
  if (!observations.ok) return observations;
  const crops = observations.value.filter((observation) => observation.cropPath !== null).length;
  if (crops >= FACE_LIMITS.maxExemplarsPerPerson) return null;
  const directory = deps.fs.join(deps.fs.dirname(deps.globalCatalog.databasePath()), 'faces', personId);
  const ensured = await deps.fs.ensureDirectory(directory);
  if (!ensured.ok) return ensured;
  const cropPath = deps.fs.join(directory, `exemplar-${String(crops + 1).padStart(3, '0')}.jpg`);
  const generated = await deps.media.thumbnail({
    videoPath,
    thumbnailPath: cropPath,
    seekPercent: (frameIndex + 1) / (FACE_LIMITS.maxFramesPerVideo + 1),
    width: FACE_LIMITS.exemplarCropMaxPx,
    height: FACE_LIMITS.exemplarCropMaxPx,
    force: true,
  });
  if (!generated.ok) return generated;
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
