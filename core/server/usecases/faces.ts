import {
  EXEMPLAR_BBOX_MIN_IOU,
  FACE_ENGINE_VERSION,
  FACE_LIMITS,
  FILE_ARTIFACTS,
  boxIoU,
  classifyFace,
  clusterFaceObservations,
  findNewClusterSeed,
  normalizeEmbedding,
  parseFaceObsId,
  passesFaceQuality,
  planExemplarBackfill,
  faceCropFileName,
  selectExemplars,
  updateCentroid,
  appError,
  ok,
  type AppError,
  type ExemplarPlanObservation,
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
  type FaceFrameInput,
  type FileSystemPort,
  type GlobalCatalogStore,
  type JobExecutionContext,
  type JobProgress,
  type JobsPort,
  type MediaPort,
  type ModelDownloadPort,
  type PhotoFaceIndexCandidate,
  type PhotosStore,
  type ConfigStore,
} from '../ports.js';
import { resolveConfigValues } from './config-resolution.js';
import { photoArtifactsRoot, photoProxyPath } from './photo-artifacts.js';

export interface FacesDeps {
  config: ConfigStore;
  downloads: ModelDownloadPort;
  faceEngine: FaceEnginePort;
  fs: FileSystemPort;
  globalCatalog: GlobalCatalogStore;
  jobs: JobsPort;
  media: MediaPort;
  photos: PhotosStore;
}

export type FacesIndexDeps = Omit<FacesDeps, 'jobs' | 'photos'> & { photos?: PhotosStore | undefined };

export type FacesReclusterDeps = Pick<FacesDeps, 'config' | 'fs' | 'globalCatalog'>;

export type FacesExemplarsDeps = Omit<FacesDeps, 'jobs'>;

export interface FacesExemplarsOutput {
  dryRun: boolean;
  people: number;
  peopleWithoutExemplarBefore: number;
  peopleWithoutExemplarAfter: number;
  filesPlanned: number;
  filesVisited: number;
  filesUnavailable: number;
  cropsPlanned: number;
  cropsWritten: number;
  detectionsMismatched: number;
  observationsUnaddressable: number;
  limitReached: boolean;
  elapsedMs: number;
}

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
  largestClusters: { personId: string; observations: number }[];
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
  foldersMatched: number;
  filesInScope: number;
  filesScanned: number;
  filesIndexed: number;
  observationsAdded: number;
  peopleCreated: number;
  filesFailed: number;
  failures: FacesIndexFailure[];
  aborted: boolean;
  photo: {
    inScope: number;
    scanned: number;
    indexed: number;
    observationsAdded: number;
    failed: number;
  };
}

export type PhotoFacesIndexOutput = FacesIndexOutput['photo'];

export interface FacesStatusOutput {
  enabled: boolean;
  artifactsReady: boolean;
  people: number;
  observations: number;
  assignedObservations: number;
  unassignedObservations: number;
  filesIndexed: number;
  videosIndexed: number;
  photosIndexed: number;
  staleVersionFiles: number;
  stalePhotoFiles: number;
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
    resourceKey: 'faces-write',
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
    resourceKey: 'faces-write',
    run: (context) => runFacesReclusterPass(deps, input, context),
  });
};

export const facesExemplars = async (
  deps: FacesDeps,
  input: { dryRun: boolean; limit: number | null },
): Promise<Result<{ jobId: string }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  return deps.jobs.enqueue({
    kind: 'faces_exemplars',
    payload: input,
    resourceKey: 'faces-write',
    run: (context) => runFacesExemplarsPass(deps, input, context),
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
    boxPx: Math.min(observation.bbox.width, observation.bbox.height),
  }));
  const outcome = clusterFaceObservations(clusterInputs);

  const postCancellation = cancelled(progress);
  if (!postCancellation.ok) return postCancellation;

  const namesDropped = peopleBefore.value
    .map((person) => person.displayName)
    .filter((displayName): displayName is string => displayName !== null)
    .sort();

  const nowIso = new Date().toISOString();
  const people: Person[] = outcome.clusters.map((cluster) => ({
    personId: cluster.personId,
    displayName: null,
    kind: 'face',
    createdAt: nowIso,
    centroid: cluster.centroid,
    exemplarCount: cluster.memberObsIds.length,
  }));
  const assignments: { obsId: string; personId: string | null }[] = [
    ...outcome.clusters.flatMap((cluster) => cluster.memberObsIds.map((obsId) => ({ obsId, personId: cluster.personId }))),
    ...outcome.unassignedObsIds.map((obsId) => ({ obsId, personId: null })),
  ];

  const observationByObsId = new Map(observations.value.map((observation) => [observation.obsId, observation]));
  const personsWithoutExemplar = outcome.clusters.filter((cluster) => {
    const members = cluster.memberObsIds
      .map((obsId) => observationByObsId.get(obsId))
      .filter((observation): observation is FaceObservation => observation !== undefined);
    return !selectExemplars(members).some((observation) => observation.cropPath !== null);
  }).length;

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
    namesCarried: 0,
    namesDropped,
    personsWithoutExemplar,
    largestClusters: outcome.clusters
      .map((cluster) => ({ personId: cluster.personId, observations: cluster.memberObsIds.length }))
      .sort((left, right) => right.observations - left.observations || left.personId.localeCompare(right.personId))
      .slice(0, 5),
    elapsedMs: Date.now() - startedAt,
  };

  const done = await report(progress, { step: 'faces_done', percentage: 100, data: { ...output } });
  if (!done.ok) return done;
  return ok(output);
};

export const facesPeople = async (deps: FacesDeps): Promise<Result<{ people: FacePersonView[] }, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;
  const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  return ok({ people: people.value.map((person) => personView(person, observations.value, currentCatalogDir)) });
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
  const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  const deleted = await deleteCropPaths(deps.fs, forgotten.value.cropPaths.map((path) => reanchorFaceCropPath(currentCatalogDir, path)));
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
  const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  const deleted = await deleteCropPaths(deps.fs, purged.value.cropPaths.map((path) => reanchorFaceCropPath(currentCatalogDir, path)));
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
  const stalePhotoFiles = await deps.photos.countStalePhotoFaceIndexFiles(FACE_ENGINE_VERSION);
  if (!stalePhotoFiles.ok) return stalePhotoFiles;
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  return ok({ enabled: true, artifactsReady: artifactsReady.value, ...counts.value, stalePhotoFiles: stalePhotoFiles.value });
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
  const rootExists = await deps.fs.exists(input.root);
  if (!rootExists.ok) return rootExists;
  if (!rootExists.value) return { ok: false, error: appError('folder_not_found', `Root not found: ${input.root}`) };
  const scope = await deps.globalCatalog.listFaceIndexCandidates(input.root);
  if (!scope.ok) return scope;
  const photoScope = deps.photos === undefined
    ? ok({ inScope: 0, candidates: [] })
    : await deps.photos.listPhotoFaceIndexCandidates(input.root);
  if (!photoScope.ok) return photoScope;
  if (scope.value.foldersMatched === 0 && photoScope.value.inScope === 0) {
    return {
      ok: false,
      error: appError('drive_root_empty', `No catalog folders found under: ${input.root}`, {
        root: input.root,
        catalogFolders: 0,
        photosInScope: 0,
      }),
    };
  }
  const started = await report(progress, {
    step: 'faces_scanning',
    percentage: 0,
    total: Math.max(scope.value.candidates.length, 1),
    data: {
      root: input.root,
      filesTotal: scope.value.candidates.length,
      foldersTotal: scope.value.foldersMatched,
      filesInScope: scope.value.filesInScope,
    },
  });
  if (!started.ok) return started;
  if (deps.photos !== undefined) {
    const photoStarted = await report(progress, {
      step: 'photo-faces-scanning',
      percentage: 0,
      total: Math.max(photoScope.value.candidates.length, 1),
      data: {
        root: input.root,
        photosTotal: photoScope.value.candidates.length,
        photosInScope: photoScope.value.inScope,
      },
    });
    if (!photoStarted.ok) return photoStarted;
  }

  let filesIndexed = 0;
  let observationsAdded = 0;
  let peopleCreated = 0;
  let filesFailed = 0;
  let aborted = false;
  const failures: FacesIndexFailure[] = [];
  let streak = 0;
  let streakCode: AppError['code'] | null = null;
  let photosIndexed = 0;
  let photoObservationsAdded = 0;
  let photoPeopleCreated = 0;
  let photosFailed = 0;
  const seeded = await deps.globalCatalog.listUnassignedFaceObservations();
  if (!seeded.ok) return seeded;
  let pool: FaceObservation[] = [...seeded.value];
  const loaded = await deps.faceEngine.load();
  if (!loaded.ok) return loaded;

  try {
    for (let candidateIndex = 0; candidateIndex < scope.value.candidates.length; candidateIndex += 1) {
      const candidate = scope.value.candidates[candidateIndex];
      if (candidate === undefined) continue;
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      const outcome = await indexCandidate(deps, candidate, pool, progress, candidateIndex, scope.value.candidates.length);
      pool = outcome.pool;
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
          total: scope.value.candidates.length,
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
    }
    for (let candidateIndex = 0; candidateIndex < photoScope.value.candidates.length; candidateIndex += 1) {
      if (aborted) break;
      const candidate = photoScope.value.candidates[candidateIndex];
      if (candidate === undefined) continue;
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      if (deps.photos === undefined) continue;
      const outcome = await indexPhotoCandidate(
        deps,
        deps.photos,
        candidate,
        pool,
        progress,
        candidateIndex,
        photoScope.value.candidates.length,
      );
      pool = outcome.pool;
      if (!outcome.result.ok) {
        if (isCancellation(progress, outcome.result.error)) return outcome.result;
        photosFailed += 1;
        const failed = await report(progress, {
          step: 'photo-faces-file-failed',
          current: candidateIndex + 1,
          total: photoScope.value.candidates.length,
          data: {
            fingerprint: candidate.fingerprint,
            photoPath: candidate.currentPath,
            code: outcome.result.error.code,
            message: outcome.result.error.message,
          },
        });
        if (!failed.ok) return failed;
        continue;
      }
      photosIndexed += 1;
      photoObservationsAdded += outcome.result.value.observationsAdded;
      photoPeopleCreated += outcome.result.value.peopleCreated;
      peopleCreated += outcome.result.value.peopleCreated;
    }
  } finally {
    await deps.faceEngine.dispose();
  }

  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  if (deps.photos !== undefined) {
    const photosFlushed = await deps.photos.flush();
    if (!photosFlushed.ok) return photosFlushed;
  }

  const photo = {
    inScope: photoScope.value.inScope,
    scanned: photoScope.value.candidates.length,
    indexed: photosIndexed,
    observationsAdded: photoObservationsAdded,
    failed: photosFailed,
  };
  if (deps.photos !== undefined) {
    const photoDone = await report(progress, {
      step: 'photo-faces-summary',
      percentage: 100,
      data: { root: input.root, ...photo, peopleCreated: photoPeopleCreated },
    });
    if (!photoDone.ok) return photoDone;
  }

  const done = await report(progress, {
    step: 'faces_done',
    percentage: 100,
    data: { filesIndexed, observationsAdded, peopleCreated, filesFailed, aborted, photo },
  });
  if (!done.ok) return done;
  return ok({
    root: input.root,
    foldersMatched: scope.value.foldersMatched,
    filesInScope: scope.value.filesInScope,
    filesScanned: scope.value.candidates.length,
    filesIndexed,
    observationsAdded,
    peopleCreated,
    filesFailed,
    failures,
    aborted,
    photo,
  });
};

export const runPhotoFacesIndexPass = async (
  deps: FacesIndexDeps & { photos: PhotosStore },
  input: { root: string },
  progress?: JobExecutionContext,
): Promise<Result<PhotoFacesIndexOutput, AppError>> => {
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  if (!artifactsReady.value) return { ok: false, error: appError('model_not_installed', 'Face artifacts are not installed') };
  const scope = await deps.photos.listPhotoFaceIndexCandidates(input.root);
  if (!scope.ok) return scope;
  const started = await report(progress, {
    step: 'photo-faces-scanning',
    percentage: 0,
    total: Math.max(scope.value.candidates.length, 1),
    data: { root: input.root, photosTotal: scope.value.candidates.length, photosInScope: scope.value.inScope },
  });
  if (!started.ok) return started;
  if (scope.value.candidates.length === 0) {
    const output: PhotoFacesIndexOutput = {
      inScope: scope.value.inScope,
      scanned: 0,
      indexed: 0,
      observationsAdded: 0,
      failed: 0,
    };
    const done = await report(progress, {
      step: 'photo-faces-summary',
      percentage: 100,
      data: { root: input.root, ...output, peopleCreated: 0 },
    });
    return done.ok ? ok(output) : done;
  }
  const seeded = await deps.globalCatalog.listUnassignedFaceObservations();
  if (!seeded.ok) return seeded;
  let pool: FaceObservation[] = [...seeded.value];
  const loaded = await deps.faceEngine.load();
  if (!loaded.ok) return loaded;
  let indexed = 0;
  let observationsAdded = 0;
  let peopleCreated = 0;
  let failed = 0;
  try {
    for (let candidateIndex = 0; candidateIndex < scope.value.candidates.length; candidateIndex += 1) {
      const candidate = scope.value.candidates[candidateIndex];
      if (candidate === undefined) continue;
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      const outcome = await indexPhotoCandidate(
        deps,
        deps.photos,
        candidate,
        pool,
        progress,
        candidateIndex,
        scope.value.candidates.length,
      );
      pool = outcome.pool;
      if (!outcome.result.ok) {
        if (isCancellation(progress, outcome.result.error)) return outcome.result;
        failed += 1;
        const failedReport = await report(progress, {
          step: 'photo-faces-file-failed',
          current: candidateIndex + 1,
          total: scope.value.candidates.length,
          data: {
            fingerprint: candidate.fingerprint,
            photoPath: candidate.currentPath,
            code: outcome.result.error.code,
            message: outcome.result.error.message,
          },
        });
        if (!failedReport.ok) return failedReport;
        continue;
      }
      indexed += 1;
      observationsAdded += outcome.result.value.observationsAdded;
      peopleCreated += outcome.result.value.peopleCreated;
    }
  } finally {
    await deps.faceEngine.dispose();
  }
  const catalogFlushed = await deps.globalCatalog.flush();
  if (!catalogFlushed.ok) return catalogFlushed;
  const photosFlushed = await deps.photos.flush();
  if (!photosFlushed.ok) return photosFlushed;
  const output: PhotoFacesIndexOutput = {
    inScope: scope.value.inScope,
    scanned: scope.value.candidates.length,
    indexed,
    observationsAdded,
    failed,
  };
  const done = await report(progress, {
    step: 'photo-faces-summary',
    percentage: 100,
    data: { root: input.root, ...output, peopleCreated },
  });
  if (!done.ok) return done;
  return ok(output);
};

const isCancellation = (progress: JobExecutionContext | undefined, error: AppError): boolean =>
  progress?.signal.aborted === true || error.message === JOB_CANCELLED_ERROR_MESSAGE;

interface IndexCandidateOutcome {
  result: Result<{ observationsAdded: number; peopleCreated: number }, AppError>;
  pool: FaceObservation[];
}

const indexCandidate = async (
  deps: FacesIndexDeps,
  candidate: FaceIndexCandidate,
  poolIn: FaceObservation[],
  progress: JobExecutionContext | undefined,
  candidateIndex: number,
  candidatesTotal: number,
): Promise<IndexCandidateOutcome> => {
  let pool = poolIn;
  const fingerprint = candidate.file.fingerprint;
  const stale = candidate.previousEngineVersion !== null && candidate.previousEngineVersion < FACE_ENGINE_VERSION;
  if (stale) {
    const purged = await deps.globalCatalog.deleteFaceObservationsForFile(fingerprint);
    if (!purged.ok) return { result: purged, pool };
    const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
    const removedCrops = await deleteCropPaths(
      deps.fs,
      purged.value.cropPaths.map((path) => reanchorFaceCropPath(currentCatalogDir, path)),
    );
    if (!removedCrops.ok) return { result: removedCrops, pool };
    pool = pool.filter((observation) => observation.fingerprint !== fingerprint);
  }
  const existing = await deps.globalCatalog.listFaceObservations({ fingerprint });
  if (!existing.ok) return { result: existing, pool };
  const existingObsIds = new Set(existing.value.map((observation) => observation.obsId));
  const videoPath = deps.fs.join(candidate.folder.currentPath, candidate.file.fileName);
  const frameDirectory = deps.fs.join(deps.fs.tempDirectory(), 'ai-video-cataloger', 'faces', fingerprint);
  const extracting = await report(progress, {
    step: 'faces_extracting_frames',
    current: candidateIndex + 1,
    total: candidatesTotal,
    data: { fingerprint, videoPath },
  });
  if (!extracting.ok) return { result: extracting, pool };
  const frames = await deps.media.extractFrames({
    videoPath,
    outputDirectory: frameDirectory,
    frameCount: FACE_LIMITS.maxFramesPerVideo,
    signal: progress?.signal,
  });
  if (!frames.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: frames, pool };
  }
  const probe = await deps.media.probe({ videoPath });
  if (!probe.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: probe, pool };
  }
  const added = await indexFramesForFile(deps, {
    fingerprint,
    videoPath,
    durationS: probe.value.duration,
    framePaths: frames.value.framePaths,
  }, pool, existingObsIds, progress);
  if (!added.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: added, pool };
  }
  const completed = await deps.globalCatalog.completeFaceIndex(fingerprint, FACE_ENGINE_VERSION);
  if (!completed.ok) {
    await deps.fs.deletePath(frameDirectory);
    return { result: completed, pool };
  }
  // best effort: a leftover temp frame directory is a disk-space leak, not a reason to
  // fail an index that is already stored
  await deps.fs.deletePath(frameDirectory);
  return { result: added, pool };
};

const indexPhotoCandidate = async (
  deps: FacesIndexDeps,
  photos: PhotosStore,
  candidate: PhotoFaceIndexCandidate,
  poolIn: FaceObservation[],
  progress: JobExecutionContext | undefined,
  candidateIndex: number,
  candidatesTotal: number,
): Promise<IndexCandidateOutcome> => {
  let pool = poolIn;
  const fingerprint = candidate.fingerprint;
  const stale = candidate.previousEngineVersion !== null && candidate.previousEngineVersion < FACE_ENGINE_VERSION;
  if (stale) {
    const purged = await deps.globalCatalog.deleteFaceObservationsForFile(fingerprint);
    if (!purged.ok) return { result: purged, pool };
    const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
    const removedCrops = await deleteCropPaths(
      deps.fs,
      purged.value.cropPaths.map((cropPath) => reanchorFaceCropPath(currentCatalogDir, cropPath)),
    );
    if (!removedCrops.ok) return { result: removedCrops, pool };
    pool = pool.filter((observation) => observation.fingerprint !== fingerprint);
  }
  const photo = await photos.getPhoto(fingerprint);
  if (!photo.ok) return { result: photo, pool };
  if (photo.value === null) {
    return { result: { ok: false, error: appError('file_not_found', `Photo not found: ${fingerprint}`) }, pool };
  }
  if (photo.value.proxyWidth === null || photo.value.proxyHeight === null) {
    return { result: { ok: false, error: appError('processing_error', `Photo proxy dimensions are unavailable: ${fingerprint}`) }, pool };
  }
  const proxyPath = photoProxyPath(deps.fs, photoArtifactsRoot(deps.fs, photos), fingerprint);
  const existing = await deps.globalCatalog.listFaceObservations({ fingerprint });
  if (!existing.ok) return { result: existing, pool };
  const existingObsIds = new Set(existing.value.map((observation) => observation.obsId));
  const detecting = await report(progress, {
    step: 'photo-faces-detecting',
    current: candidateIndex + 1,
    total: candidatesTotal,
    data: { fingerprint, photoPath: candidate.currentPath, proxyPath },
  });
  if (!detecting.ok) return { result: detecting, pool };
  const frame: FaceFrameInput = { kind: 'image-path', frameJpegPath: proxyPath };
  const detections = await deps.faceEngine.detect(frame);
  if (!detections.ok) return { result: detections, pool };
  let observationsAdded = 0;
  let peopleCreated = 0;
  for (let detectionIndex = 0; detectionIndex < detections.value.length; detectionIndex += 1) {
    const detection = detections.value[detectionIndex];
    if (detection === undefined) continue;
    const indexed = await indexDetection(
      deps,
      { fingerprint, frameTsS: null },
      frame,
      0,
      detectionIndex,
      detection,
      pool,
      existingObsIds,
      'photo',
      { sourceWidth: photo.value.proxyWidth, sourceHeight: photo.value.proxyHeight },
    );
    if (!indexed.ok) return { result: indexed, pool };
    observationsAdded += indexed.value.observationsAdded;
    peopleCreated += indexed.value.peopleCreated;
  }
  const completed = await photos.completePhotoFaceIndex(fingerprint, FACE_ENGINE_VERSION);
  if (!completed.ok) return { result: completed, pool };
  return { result: ok({ observationsAdded, peopleCreated }), pool };
};

export const runFacesExemplarsPass = async (
  deps: FacesExemplarsDeps,
  input: { dryRun: boolean; limit: number | null },
  progress?: JobExecutionContext,
): Promise<Result<FacesExemplarsOutput, AppError>> => {
  const startedAt = Date.now();
  const artifactsReady = await faceArtifactsInstalled(deps.downloads);
  if (!artifactsReady.ok) return artifactsReady;
  if (!artifactsReady.value) return { ok: false, error: appError('model_not_installed', 'Face artifacts are not installed') };

  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;

  const currentCatalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  const planObservations: ExemplarPlanObservation[] = [];
  for (const observation of observations.value) {
    if (observation.personId === null) continue;
    let cropPath = observation.cropPath === null ? null : reanchorFaceCropPath(currentCatalogDir, observation.cropPath);
    if (cropPath !== null) {
      const exists = await deps.fs.exists(cropPath);
      if (!exists.ok) return exists;
      if (!exists.value) cropPath = null;
    }
    planObservations.push({
      obsId: observation.obsId,
      fingerprint: observation.fingerprint,
      quality: observation.quality,
      cropPath,
      personId: observation.personId,
      frameTsS: observation.frameTsS,
      bbox: observation.bbox,
    });
  }

  const plan = planExemplarBackfill(planObservations);

  const fingerprintsOrdered: string[] = [];
  const seenFingerprints = new Set<string>();
  for (const item of plan.items) {
    if (seenFingerprints.has(item.fingerprint)) continue;
    seenFingerprints.add(item.fingerprint);
    fingerprintsOrdered.push(item.fingerprint);
  }
  const limitReached = input.limit !== null && fingerprintsOrdered.length > input.limit;
  const selectedFingerprints = input.limit === null ? fingerprintsOrdered : fingerprintsOrdered.slice(0, input.limit);
  const selectedFingerprintSet = new Set(selectedFingerprints);
  const items = plan.items.filter((item) => selectedFingerprintSet.has(item.fingerprint));

  const locations = await deps.globalCatalog.listAnalyzedFileLocations(selectedFingerprints);
  if (!locations.ok) return locations;
  const locationByFingerprint = new Map(locations.value.map((location) => [location.fingerprint, location]));

  const itemsByFingerprint = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = itemsByFingerprint.get(item.fingerprint);
    if (bucket === undefined) itemsByFingerprint.set(item.fingerprint, [item]);
    else bucket.push(item);
  }

  const observationByObsId = new Map(observations.value.map((observation) => [observation.obsId, observation]));
  const cropPathByObsId = new Map<string, string>();

  let filesVisited = 0;
  let filesUnavailable = 0;
  let cropsWritten = 0;
  let detectionsMismatched = 0;

  try {
    for (let fileIndex = 0; fileIndex < selectedFingerprints.length; fileIndex += 1) {
      const fingerprint = selectedFingerprints[fileIndex];
      if (fingerprint === undefined) continue;
      const location = locationByFingerprint.get(fingerprint);
      const fingerprintItems = itemsByFingerprint.get(fingerprint) ?? [];
      if (location === undefined || location.folderPath === null) {
        filesUnavailable += 1;
        continue;
      }
      const videoPath = deps.fs.join(location.folderPath, location.fileName);
      const extracting = await report(progress, {
        step: 'faces_extracting_frames',
        current: fileIndex + 1,
        total: selectedFingerprints.length,
        data: { fingerprint, videoPath },
      });
      if (!extracting.ok) return extracting;
      const exists = await deps.fs.exists(videoPath);
      if (!exists.ok) return exists;
      if (!exists.value) {
        filesUnavailable += 1;
        continue;
      }
      const cancellation = cancelled(progress);
      if (!cancellation.ok) return cancellation;
      if (input.dryRun) {
        filesVisited += 1;
        continue;
      }

      let undecodable = false;
      for (const item of fingerprintItems) {
        const detecting = await report(progress, {
          step: 'faces_detecting',
          current: fileIndex + 1,
          total: selectedFingerprints.length,
          data: { fingerprint, videoPath, frameTsS: item.frameTsS },
        });
        if (!detecting.ok) return detecting;
        const detections = await deps.faceEngine.detect({ kind: 'video-timestamp', videoPath, timestampS: item.frameTsS });
        if (!detections.ok) {
          undecodable = true;
          break;
        }
        const detected = detections.value[item.detectionIndex - 1];
        if (detected === undefined || boxIoU(item.bbox, detected.bbox) < EXEMPLAR_BBOX_MIN_IOU) {
          detectionsMismatched += 1;
          continue;
        }
        const aligned = await deps.faceEngine.align({ kind: 'video-timestamp', videoPath, timestampS: item.frameTsS }, detected);
        if (!aligned.ok) return aligned;
        const cropPath = await writeObservationCrop(deps, item.obsId, aligned.value);
        if (typeof cropPath !== 'string') return cropPath;
        const original = observationByObsId.get(item.obsId);
        if (original === undefined) continue;
        const updated = await deps.globalCatalog.upsertFaceObservation({ ...original, cropPath });
        if (!updated.ok) return updated;
        cropPathByObsId.set(item.obsId, cropPath);
        cropsWritten += 1;
      }
      if (undecodable) filesUnavailable += 1;
      else filesVisited += 1;
    }
  } finally {
    await deps.faceEngine.dispose();
  }

  if (!input.dryRun) {
    const flushed = await deps.globalCatalog.flush();
    if (!flushed.ok) return flushed;
  }

  const afterObservations = planObservations.map((observation) => ({
    ...observation,
    cropPath: cropPathByObsId.get(observation.obsId) ?? observation.cropPath,
  }));
  const peopleWithoutExemplarAfter = planExemplarBackfill(afterObservations).personsWithoutExemplar;

  const output: FacesExemplarsOutput = {
    dryRun: input.dryRun,
    people: people.value.length,
    peopleWithoutExemplarBefore: plan.personsWithoutExemplar,
    peopleWithoutExemplarAfter,
    filesPlanned: selectedFingerprints.length,
    filesVisited,
    filesUnavailable,
    cropsPlanned: items.length,
    cropsWritten,
    detectionsMismatched,
    observationsUnaddressable: plan.observationsUnaddressable,
    limitReached,
    elapsedMs: Date.now() - startedAt,
  };

  const done = await report(progress, { step: 'faces_done', percentage: 100, data: { ...output } });
  if (!done.ok) return done;
  return ok(output);
};

const indexFramesForFile = async (
  deps: FacesIndexDeps,
  input: { fingerprint: string; videoPath: string; durationS: number | null; framePaths: string[] },
  pool: FaceObservation[],
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
      const indexed = await indexDetection(deps, { fingerprint: input.fingerprint, frameTsS: timestampS }, framePath, frameIndex, detectionIndex, detection, pool, existingObsIds, 'video');
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
  input: { fingerprint: string; frameTsS: number | null },
  frame: FaceFrameInput | string,
  frameIndex: number,
  detectionIndex: number,
  detection: FaceDetection,
  pool: FaceObservation[],
  existingObsIds: ReadonlySet<string>,
  media: FaceObservation['media'],
  sourceDimensions?: { sourceWidth: number; sourceHeight: number } | undefined,
): Promise<Result<{ observationsAdded: number; peopleCreated: number }, AppError>> => {
  const obsId = `${input.fingerprint}:face:${frameIndex + 1}:${detectionIndex + 1}`;
  if (existingObsIds.has(obsId)) return ok({ observationsAdded: 0, peopleCreated: 0 });
  const boxPx = Math.min(detection.bbox.width, detection.bbox.height);
  if (!passesFaceQuality({ score: detection.score, boxPx })) return ok({ observationsAdded: 0, peopleCreated: 0 });
  const aligned = await deps.faceEngine.align(frame, detection);
  if (!aligned.ok) return aligned;
  const cropPath = await writeObservationCrop(deps, obsId, aligned.value);
  if (typeof cropPath !== 'string') return cropPath;
  const embedded = await deps.faceEngine.embed(aligned.value);
  if (!embedded.ok) return embedded;
  const embedding = normalizeEmbedding([...embedded.value]);
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const assignment = classifyFace(embedding, people.value.map((person) => ({ personId: person.personId, centroid: person.centroid })));
  const assignedPersonId = assignment.decision === 'assign' ? assignment.personId : null;
  const observation: FaceObservation = {
    obsId,
    fingerprint: input.fingerprint,
    kind: 'face',
    frameTsS: input.frameTsS,
    bbox: sourceDimensions === undefined ? detection.bbox : { ...detection.bbox, ...sourceDimensions },
    embedding,
    quality: detection.score,
    personId: assignedPersonId,
    cropPath,
    media,
  };
  const stored = await deps.globalCatalog.upsertFaceObservation(observation);
  if (!stored.ok) return stored;
  pool.push(observation);
  if (assignedPersonId !== null) {
    const updated = await updatePersonCentroid(deps.globalCatalog, assignedPersonId, embedding);
    if (!updated.ok) return updated;
    return ok({ observationsAdded: 1, peopleCreated: 0 });
  }
  const clustered = await seedNewPersonIfReady(deps, pool);
  if (!clustered.ok) return clustered;
  return ok({ observationsAdded: 1, peopleCreated: clustered.value });
};

const seedNewPersonIfReady = async (
  deps: FacesIndexDeps,
  pool: FaceObservation[],
): Promise<Result<number, AppError>> => {
  const unassigned = pool.filter((observation) => observation.personId === null);
  const seed = findNewClusterSeed(unassigned.map((observation) => observation.embedding));
  if (seed.length === 0) return ok(0);
  const personId = `person-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const embeddings = seed.map((index) => unassigned[index]?.embedding).filter((value): value is number[] => value !== undefined);
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
    const observation = unassigned[index];
    if (observation === undefined) continue;
    const updatedObservation = { ...observation, personId };
    const updated = await deps.globalCatalog.upsertFaceObservation(updatedObservation);
    if (!updated.ok) return updated;
    const poolIndex = pool.indexOf(observation);
    if (poolIndex !== -1) pool[poolIndex] = updatedObservation;
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

const writeObservationCrop = async (
  deps: Pick<FacesIndexDeps, 'faceEngine' | 'fs' | 'globalCatalog'>,
  obsId: string,
  alignedCrop: AlignedFaceCrop,
): Promise<string | Result<never, AppError>> => {
  const parsed = parseFaceObsId(obsId);
  if (parsed === null) return { ok: false, error: appError('internal', `Cannot parse face observation id: ${obsId}`) };
  const directory = deps.fs.join(deps.fs.dirname(deps.globalCatalog.databasePath()), 'faces', 'obs', parsed.fingerprint);
  const ensured = await deps.fs.ensureDirectory(directory);
  if (!ensured.ok) return ensured;
  const cropPath = deps.fs.join(directory, faceCropFileName(parsed));
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

export const reanchorFaceCropPath = (currentCatalogDir: string, stored: string): string => {
  if (stored.startsWith(currentCatalogDir)) return stored;
  const marker = '/.ai-video-cataloger/';
  const markerIndex = stored.indexOf(marker);
  if (markerIndex === -1) return stored;
  const suffix = stored.slice(markerIndex + marker.length);
  return `${currentCatalogDir}/${suffix}`;
};

const personView = (person: Person, observations: readonly FaceObservation[], currentCatalogDir: string): FacePersonView => {
  const matching = observations.filter((observation) => observation.personId === person.personId);
  const selected = selectExemplars(matching);
  const exemplarCropPaths = selected
    .filter((observation): observation is FaceObservation & { cropPath: string } => observation.cropPath !== null)
    .map((observation) => reanchorFaceCropPath(currentCatalogDir, observation.cropPath));
  return {
    ...person,
    observationCount: matching.length,
    exemplarCropPath: exemplarCropPaths[0] ?? null,
    exemplarCropPaths,
  };
};

export const deleteCropPaths = async (fs: FileSystemPort, cropPaths: readonly string[]): Promise<Result<number, AppError>> => {
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
