import {
  FACE_ENGINE_VERSION,
  FACE_LIMITS,
  FILE_ARTIFACTS,
  classifyFace,
  clusterFaceObservations,
  findNewClusterSeed,
  normalizeEmbedding,
  passesFaceQuality,
  shouldStoreExemplar,
  updateCentroid,
  appError,
  ok,
  type AppError,
  type FaceClusterInput,
  type FaceObservation,
  type Person,
  type Result,
} from '@core/domain/index.js';

import {
  JOB_CANCELLED_ERROR_MESSAGE,
  type AlignedFaceCrop,
  type FaceDetection,
  type FaceEnginePort,
  type FaceIndexCandidate,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobProgress,
  type JobsPort,
  type MediaPort,
  type ModelDownloadPort,
  type ConfigStore,
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

export type FacesIndexDeps = Omit<FacesDeps, 'jobs'>;

export type FacesReclusterDeps = Pick<FacesDeps, 'config' | 'fs' | 'globalCatalog'>;

export interface FacesReclusterOutput {
  dryRun: boolean;
  observations: number;
  personsBefore: number;
  personsAfter: number;
  observationsReassigned: number;
  observationsAssigned: number;
  observationsUnassigned: number;
  namesCarried: number;
  namesDropped: string[];
  personsWithoutExemplar: number;
  elapsedMs: number;
}

const maxConsecutiveFailures = 5;

export interface FacesIndexFailure {
  path: string;
  fingerprint: string;
  code: AppError['code'];
  message: string;
}

export interface FacesIndexOutput {
  root: string;
  filesScanned: number;
  filesIndexed: number;
  observationsAdded: number;
  peopleCreated: number;
  filesFailed: number;
  failures: FacesIndexFailure[];
  aborted: boolean;
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
  exemplarCropPaths: string[];
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
    run: (context) => runFacesIndexJob(deps, { root: deps.fs.resolve(input.root) }, context),
  });
};

export const runFacesIndexJob = async (
  deps: FacesIndexDeps,
  input: { root: string },
  progress?: JobExecutionContext,
): Promise<Result<FacesIndexOutput, AppError>> => {
  const pass = await runFacesIndexPass(deps, input, progress);
  if (!pass.ok || !pass.value.aborted) return pass;
  const lastCode = pass.value.failures[pass.value.failures.length - 1]?.code ?? 'processing_error';
  return {
    ok: false,
    error: appError(
      'drive_run_aborted',
      `Aborted faces index after ${maxConsecutiveFailures} consecutive ${lastCode} failures. Re-run the same root to resume.`,
      { root: input.root, filesIndexed: pass.value.filesIndexed, failures: pass.value.failures },
    ),
  };
};

export const facesRecluster = async (
  deps: FacesDeps,
  input: { dryRun: boolean },
): Promise<Result<{ jobId: string }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  return deps.jobs.enqueue({
    kind: 'faces_recluster',
    payload: input,
    resourceKey: 'faces-recluster',
    run: (context) => runFacesReclusterPass(deps, input, context),
  });
};

export const runFacesReclusterPass = async (
  deps: FacesReclusterDeps,
  input: { dryRun: boolean },
  progress?: JobExecutionContext,
): Promise<Result<FacesReclusterOutput, AppError>> => {
  const startedAt = Date.now();
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;
  const peopleBefore = await deps.globalCatalog.listPeople();
  if (!peopleBefore.ok) return peopleBefore;

  const started = await report(progress, {
    step: 'faces_clustering',
    percentage: 0,
    total: Math.max(observations.value.length, 1),
    data: { dryRun: input.dryRun, observations: observations.value.length },
  });
  if (!started.ok) return started;

  const preCancellation = cancelled(progress);
  if (!preCancellation.ok) return preCancellation;

  const clusterInputs: FaceClusterInput[] = observations.value.map((observation) => ({
    obsId: observation.obsId,
    embedding: observation.embedding,
    quality: observation.quality,
  }));
  const outcome = clusterFaceObservations(clusterInputs);

  const postCancellation = cancelled(progress);
  if (!postCancellation.ok) return postCancellation;

  const namedPeople = inheritNames(outcome, {
    oldPeople: peopleBefore.value,
    oldAssignments: new Map(observations.value.map((observation) => [observation.obsId, observation.personId])),
  });

  const nowIso = new Date().toISOString();
  const people: Person[] = namedPeople.clusters.map((cluster) => ({
    personId: cluster.personId,
    displayName: cluster.displayName,
    kind: 'face',
    createdAt: nowIso,
    centroid: cluster.centroid,
    exemplarCount: cluster.memberObsIds.length,
  }));
  const assignments: { obsId: string; personId: string | null }[] = [
    ...outcome.clusters.flatMap((cluster) => cluster.memberObsIds.map((obsId) => ({ obsId, personId: cluster.personId }))),
    ...outcome.unassignedObsIds.map((obsId) => ({ obsId, personId: null })),
  ];

  const cropPathByObsId = new Map(observations.value.map((observation) => [observation.obsId, observation.cropPath]));
  const personsWithoutExemplar = outcome.clusters.filter((cluster) =>
    !cluster.memberObsIds.some((obsId) => cropPathByObsId.get(obsId) !== null)).length;

  let observationsReassigned: number;
  if (input.dryRun) {
    const before = new Map(observations.value.map((observation) => [observation.obsId, observation.personId]));
    observationsReassigned = assignments.filter((assignment) => before.get(assignment.obsId) !== assignment.personId).length;
  } else {
    const replaced = await deps.globalCatalog.replaceFaceClustering({ people, assignments });
    if (!replaced.ok) return replaced;
    observationsReassigned = replaced.value.observationsReassigned;
    const flushed = await deps.globalCatalog.flush();
    if (!flushed.ok) return flushed;
  }

  const output: FacesReclusterOutput = {
    dryRun: input.dryRun,
    observations: observations.value.length,
    personsBefore: peopleBefore.value.length,
    personsAfter: people.length,
    observationsReassigned,
    observationsAssigned: outcome.clusters.reduce((sum, cluster) => sum + cluster.memberObsIds.length, 0),
    observationsUnassigned: outcome.unassignedObsIds.length,
    namesCarried: namedPeople.namesCarried,
    namesDropped: namedPeople.namesDropped,
    personsWithoutExemplar,
    elapsedMs: Date.now() - startedAt,
  };

  const done = await report(progress, { step: 'faces_done', percentage: 100, data: { ...output } });
  if (!done.ok) return done;
  return ok(output);
};

interface NamedCluster {
  personId: string;
  displayName: string | null;
  centroid: number[];
  memberObsIds: string[];
}

const inheritNames = (
  outcome: { clusters: readonly { personId: string; centroid: number[]; memberObsIds: readonly string[] }[] },
  history: { oldPeople: readonly Person[]; oldAssignments: ReadonlyMap<string, string | null> },
): { clusters: NamedCluster[]; namesCarried: number; namesDropped: string[] } => {
  const oldNames = new Map(
    history.oldPeople
      .filter((person): person is Person & { displayName: string } => person.displayName !== null)
      .map((person) => [person.personId, person.displayName]),
  );

  const claimedNames = new Set<string>();
  const clusters: NamedCluster[] = [];
  for (const cluster of outcome.clusters) {
    const plurality = new Map<string, number>();
    for (const obsId of cluster.memberObsIds) {
      const oldPersonId = history.oldAssignments.get(obsId);
      if (oldPersonId === null || oldPersonId === undefined) continue;
      const name = oldNames.get(oldPersonId);
      if (name === undefined) continue;
      plurality.set(name, (plurality.get(name) ?? 0) + 1);
    }
    const ranked = [...plurality.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    clusters.push({
      personId: cluster.personId,
      displayName: ranked[0]?.[0] ?? null,
      centroid: cluster.centroid,
      memberObsIds: [...cluster.memberObsIds],
    });
  }

  const byName = new Map<string, { clusterIndex: number; votes: number }[]>();
  clusters.forEach((cluster, index) => {
    if (cluster.displayName === null) return;
    const votes = cluster.memberObsIds.filter((obsId) => {
      const oldPersonId = history.oldAssignments.get(obsId);
      return oldPersonId !== null && oldPersonId !== undefined && oldNames.get(oldPersonId) === cluster.displayName;
    }).length;
    const existing = byName.get(cluster.displayName) ?? [];
    existing.push({ clusterIndex: index, votes });
    byName.set(cluster.displayName, existing);
  });

  const clusterSize = (index: number): number => clusters[index]?.memberObsIds.length ?? 0;
  const clusterPersonId = (index: number): string => clusters[index]?.personId ?? '';

  let namesCarried = 0;
  for (const [name, candidates] of byName) {
    const winner = [...candidates].sort((left, right) =>
      right.votes - left.votes
      || clusterSize(right.clusterIndex) - clusterSize(left.clusterIndex)
      || clusterPersonId(left.clusterIndex).localeCompare(clusterPersonId(right.clusterIndex)))[0];
    for (const candidate of candidates) {
      if (winner !== undefined && candidate.clusterIndex === winner.clusterIndex) continue;
      const loser = clusters[candidate.clusterIndex];
      if (loser !== undefined) loser.displayName = null;
    }
    if (winner !== undefined) {
      claimedNames.add(name);
      namesCarried += 1;
    }
  }

  const namesDropped = [...oldNames.values()].filter((name) => !claimedNames.has(name)).sort();
  return { clusters, namesCarried, namesDropped };
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
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  return ok({ enabled: true, artifactsReady: artifactsReady.value, ...counts.value });
};

const cancelled = (progress: JobExecutionContext | undefined): Result<void, AppError> => {
  if (progress?.signal.aborted === true) {
    return { ok: false, error: appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE) };
  }
  return ok(undefined);
};

const report = (
  progress: JobExecutionContext | undefined,
  progressInput: JobProgress,
): Promise<Result<void, AppError>> =>
  progress === undefined ? Promise.resolve(ok(undefined)) : progress.reportProgress(progressInput);

export const runFacesIndexPass = async (
  deps: FacesIndexDeps,
  input: { root: string },
  progress?: JobExecutionContext,
): Promise<Result<FacesIndexOutput, AppError>> => {
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  if (!artifactsReady.value) return { ok: false, error: appError('model_not_installed', 'Face artifacts are not installed') };
  const candidates = await deps.globalCatalog.listFaceIndexCandidates(input.root);
  if (!candidates.ok) return candidates;
  const started = await report(progress, {
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
  let filesFailed = 0;
  let aborted = false;
  const failures: FacesIndexFailure[] = [];
  let streak = 0;
  let streakCode: AppError['code'] | null = null;
  const seeded = await deps.globalCatalog.listUnassignedFaceObservations();
  if (!seeded.ok) return seeded;
  let contexts: ObservationContext[] = seeded.value.map(persistedContext);

  try {
    for (let candidateIndex = 0; candidateIndex < candidates.value.length; candidateIndex += 1) {
      const candidate = candidates.value[candidateIndex];
      if (candidate === undefined) continue;
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      const outcome = await indexCandidate(deps, candidate, contexts, progress, candidateIndex, candidates.value.length);
      contexts = outcome.contexts;
      if (!outcome.result.ok) {
        if (isCancellation(progress, outcome.result.error)) return outcome.result;
        const fingerprint = candidate.file.fingerprint;
        const videoPath = deps.fs.join(candidate.folder.currentPath, candidate.file.fileName);
        const failureCode = outcome.result.error.code;
        failures.push({ path: videoPath, fingerprint, code: failureCode, message: outcome.result.error.message });
        filesFailed += 1;
        const failed = await report(progress, {
          step: 'faces_file_failed',
          current: candidateIndex + 1,
          total: candidates.value.length,
          data: { fingerprint, videoPath, code: failureCode, message: outcome.result.error.message },
        });
        if (!failed.ok) return failed;
        streak = failureCode === streakCode ? streak + 1 : 1;
        streakCode = failureCode;
        if (streak >= maxConsecutiveFailures) {
          aborted = true;
          break;
        }
        continue;
      }
      observationsAdded += outcome.result.value.observationsAdded;
      peopleCreated += outcome.result.value.peopleCreated;
      filesIndexed += 1;
      streak = 0;
      streakCode = null;
      for (const context of contexts) releaseCropPixels(context.alignedCrop);
    }
  } finally {
    await deps.faceEngine.dispose();
  }

  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;

  const done = await report(progress, {
    step: 'faces_done',
    percentage: 100,
    data: { filesIndexed, observationsAdded, peopleCreated, filesFailed, aborted },
  });
  if (!done.ok) return done;
  return ok({
    root: input.root,
    filesScanned: candidates.value.length,
    filesIndexed,
    observationsAdded,
    peopleCreated,
    filesFailed,
    failures,
    aborted,
  });
};

const isCancellation = (progress: JobExecutionContext | undefined, error: AppError): boolean =>
  progress?.signal.aborted === true || error.message === JOB_CANCELLED_ERROR_MESSAGE;

interface IndexCandidateOutcome {
  result: Result<{ observationsAdded: number; peopleCreated: number }, AppError>;
  contexts: ObservationContext[];
}

const indexCandidate = async (
  deps: FacesIndexDeps,
  candidate: FaceIndexCandidate,
  contextsIn: ObservationContext[],
  progress: JobExecutionContext | undefined,
  candidateIndex: number,
  candidatesTotal: number,
): Promise<IndexCandidateOutcome> => {
  let contexts = contextsIn;
  const fingerprint = candidate.file.fingerprint;
  const stale = candidate.previousEngineVersion !== null && candidate.previousEngineVersion < FACE_ENGINE_VERSION;
  if (stale) {
    const purged = await deps.globalCatalog.deleteFaceObservationsForFile(fingerprint);
    if (!purged.ok) return { result: purged, contexts };
    const removedCrops = await deleteCropPaths(deps.fs, purged.value.cropPaths);
    if (!removedCrops.ok) return { result: removedCrops, contexts };
    contexts = contexts.filter((context) => context.observation.fingerprint !== fingerprint);
  }
  const existing = await deps.globalCatalog.listFaceObservations({ fingerprint });
  if (!existing.ok) return { result: existing, contexts };
  const existingObsIds = new Set(existing.value.map((observation) => observation.obsId));
  const videoPath = deps.fs.join(candidate.folder.currentPath, candidate.file.fileName);
  const frameDirectory = deps.fs.join(deps.fs.tempDirectory(), 'ai-video-cataloger', 'faces', fingerprint);
  const extracting = await report(progress, {
    step: 'faces_extracting_frames',
    current: candidateIndex + 1,
    total: candidatesTotal,
    data: { fingerprint, videoPath },
  });
  if (!extracting.ok) return { result: extracting, contexts };
  const frames = await deps.media.extractFrames({
    videoPath,
    outputDirectory: frameDirectory,
    frameCount: FACE_LIMITS.maxFramesPerVideo,
    signal: progress?.signal,
  });
  if (!frames.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: frames, contexts };
  }
  const probe = await deps.media.probe({ videoPath });
  if (!probe.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: probe, contexts };
  }
  const added = await indexFramesForFile(deps, {
    fingerprint,
    videoPath,
    durationS: probe.value.duration,
    framePaths: frames.value.framePaths,
  }, contexts, existingObsIds, progress);
  if (!added.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: added, contexts };
  }
  const completed = await deps.globalCatalog.completeFaceIndex(fingerprint, FACE_ENGINE_VERSION);
  if (!completed.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: completed, contexts };
  }
  // best effort: a leftover temp frame directory is a disk-space leak, not a reason to
  // fail an index that is already stored
  await deps.fs.deletePath(frameDirectory);
  return { result: added, contexts };
};

const indexFramesForFile = async (
  deps: FacesIndexDeps,
  input: { fingerprint: string; videoPath: string; durationS: number | null; framePaths: string[] },
  contexts: ObservationContext[],
  existingObsIds: ReadonlySet<string>,
  progress: JobExecutionContext | undefined,
): Promise<Result<{ observationsAdded: number; peopleCreated: number }, AppError>> => {
  let observationsAdded = 0;
  let peopleCreated = 0;
  for (let frameIndex = 0; frameIndex < input.framePaths.length; frameIndex += 1) {
    const framePath = input.framePaths[frameIndex];
    if (framePath === undefined) continue;
    const detecting = await report(progress, {
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
  deps: FacesIndexDeps,
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
  const cropPath = assignedPersonId === null ? null : await nextCropPath(deps, assignedPersonId, input.fingerprint, aligned.value);
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
  deps: FacesIndexDeps,
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
  for (const index of seed) {
    const context = unassigned[index];
    if (context === undefined) continue;
    const cropPath = context.alignedCrop.data !== undefined
      ? await nextCropPath(deps, personId, context.observation.fingerprint, context.alignedCrop)
      : null;
    if (typeof cropPath !== 'string' && cropPath !== null) return cropPath;
    const observation = { ...context.observation, personId, cropPath };
    const updated = await deps.globalCatalog.upsertFaceObservation(observation);
    if (!updated.ok) return updated;
    context.observation = observation;
    releaseCropPixels(context.alignedCrop);
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
  deps: FacesIndexDeps,
  personId: string,
  fingerprint: string,
  alignedCrop: AlignedFaceCrop,
): Promise<string | null | Result<never, AppError>> => {
  const observations = await deps.globalCatalog.listFaceObservations({ personId });
  if (!observations.ok) return observations;
  if (!shouldStoreExemplar({ existing: observations.value, fingerprint })) return null;
  const crops = observations.value.filter((observation) => observation.cropPath !== null).length;
  const directory = deps.fs.join(deps.fs.dirname(deps.globalCatalog.databasePath()), 'faces', personId);
  const ensured = await deps.fs.ensureDirectory(directory);
  if (!ensured.ok) return ensured;
  const cropPath = deps.fs.join(directory, `exemplar-${String(crops + 1).padStart(3, '0')}.jpg`);
  const written = await deps.faceEngine.writeCrop(alignedCrop, cropPath);
  if (!written.ok) return written;
  return cropPath;
};

export const facesEnabled = async (
  deps: Pick<FacesDeps, 'config' | 'fs'>,
  folder?: string | undefined,
): Promise<Result<boolean, AppError>> => {
  const resolved = await resolveConfigValues(deps.config, folder === undefined ? undefined : deps.fs.resolve(folder));
  if (!resolved.ok) return resolved;
  const enabled = resolved.value.effective.faces_enabled;
  return ok(enabled === 'true' || enabled === 'yes' || enabled === '1');
};

const ensureFacesEnabled = async (
  deps: Pick<FacesDeps, 'config' | 'fs'>,
  folder?: string | undefined,
): Promise<Result<void, AppError>> => {
  const enabled = await facesEnabled(deps, folder);
  if (!enabled.ok) return enabled;
  if (enabled.value) return ok(undefined);
  return { ok: false, error: appError('faces_disabled', 'Face indexing is disabled. Set faces_enabled=true to enable it.') };
};

export const faceArtifactsInstalled = async (downloads: ModelDownloadPort): Promise<Result<boolean, AppError>> => {
  for (const artifact of Object.values(FILE_ARTIFACTS)) {
    const downloaded = await downloads.isFileArtifactDownloaded(artifact);
    if (!downloaded.ok) return downloaded;
    if (!downloaded.value) return ok(false);
  }
  return ok(true);
};

const personView = (person: Person, observations: readonly FaceObservation[]): FacePersonView => {
  const matching = observations.filter((observation) => observation.personId === person.personId);
  const exemplarCropPaths = matching
    .filter((observation): observation is FaceObservation & { cropPath: string } => observation.cropPath !== null)
    .map((observation) => observation.cropPath)
    .slice(0, FACE_LIMITS.maxExemplarsPerPerson);
  return {
    ...person,
    observationCount: matching.length,
    exemplarCropPath: exemplarCropPaths[0] ?? null,
    exemplarCropPaths,
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
