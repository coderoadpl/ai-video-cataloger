import {
  FACE_CLUSTERING, PAIR_REVIEW_ASK_LOW_BY_SCOPE, buildPeoplePairCandidates, configValueSchema,
  selectExemplars, pairDecisionIsActive, appError, ok, type AppError, type Result, type PeoplePairCandidate,
} from '@core/domain/index.js';
import { buildVisiblePeople, ensureFacesEnabled, reanchorFaceCropPath, type FacesPeopleDeps } from './faces.js';
import { resolveConfigValues } from './config-resolution.js';

export interface FacesPairsOutput {
  scope: 'careful' | 'standard' | 'wide';
  askLow: number;
  clusterCut: number;
  pending: number;
  truncated: boolean;
  candidates: PeoplePairCandidate[];
}

export const loadPairReviewPeople = async (deps: FacesPeopleDeps) => {
  const people = await deps.globalCatalog.listPeople();
  if (!people.ok) return people;
  const observations = await deps.globalCatalog.listFaceObservationSummaries();
  if (!observations.ok) return observations;
  const hiddenVideos = await deps.globalCatalog.listHiddenFingerprints();
  if (!hiddenVideos.ok) return hiddenVideos;
  const hiddenPhotos = await deps.photos.listHiddenFingerprints();
  if (!hiddenPhotos.ok) return hiddenPhotos;
  const hidden = new Set([...hiddenVideos.value, ...hiddenPhotos.value]);
  const visible = observations.value.filter((o) => !hidden.has(o.fingerprint));
  const catalogDir = deps.fs.dirname(deps.globalCatalog.databasePath());
  return ok({ allPeople: people.value, visible, anchors: observations.value, people: buildVisiblePeople(people.value, visible, catalogDir), catalogDir });
};

export interface FacesPairsCache {
  revision: string | null;
  output: FacesPairsOutput | null;
}

export const facesPairs = async (deps: FacesPeopleDeps, input: { limit: number }, cache?: FacesPairsCache): Promise<Result<FacesPairsOutput, AppError>> => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const loaded = await loadPairReviewPeople(deps);
  if (!loaded.ok) return loaded;
  const config = await resolveConfigValues(deps.config);
  if (!config.ok) return config;
  const scope = configValueSchema.shape.faces_pair_scope.safeParse(config.value.effective.faces_pair_scope);
  if (!scope.success) return { ok: false, error: appError('validation', 'Invalid pair review scope') };
  const decisions = await deps.globalCatalog.listPeoplePairDecisions();
  if (!decisions.ok) return decisions;
  const observations = new Map<string, typeof loaded.value.visible>();
  for (const observation of loaded.value.visible) {
    if (observation.personId === null) continue;
    const group = observations.get(observation.personId) ?? [];
    group.push(observation);
    observations.set(observation.personId, group);
  }
  const ids = [...observations.values()].flatMap((group) => selectExemplars(group).map((o) => o.obsId));
  const embeddings = await deps.globalCatalog.listFaceObservationEmbeddings(ids);
  if (!embeddings.ok) return embeddings;
  const askLow = PAIR_REVIEW_ASK_LOW_BY_SCOPE[scope.data];
  const nowIso = new Date().toISOString();
  const activeDecisions = decisions.value.filter((d) => pairDecisionIsActive(d, nowIso));
  const revision = JSON.stringify([loaded.value, [...embeddings.value].map(([id, vector]) => [id, [...vector]]), activeDecisions, scope.data, input.limit]);
  if (cache?.revision === revision && cache.output !== null) return ok(cache.output);
  const queue = buildPeoplePairCandidates({
    people: loaded.value.people, visibleObservations: loaded.value.visible, anchorObservations: loaded.value.anchors,
    exemplarEmbeddings: embeddings.value, decisions: activeDecisions, nowIso,
    askLow, cut: FACE_CLUSTERING.clusterCutSimilarity, limit: input.limit,
  });
  for (const candidate of queue.candidates) for (const side of [candidate.a, candidate.b]) side.cropPaths = side.cropPaths.map((p) => reanchorFaceCropPath(loaded.value.catalogDir, p));
  const output = { ...queue, scope: scope.data, askLow, clusterCut: FACE_CLUSTERING.clusterCutSimilarity };
  if (cache !== undefined) { cache.revision = revision; cache.output = output; }
  return ok(output);
};
