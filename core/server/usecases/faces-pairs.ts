import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import { sha256Hex } from '@core/domain/sha256.js';

import type { GlobalCatalogStore } from '../ports.js';
import {
  FACE_CLUSTERING, PAIR_REVIEW_ASK_LOW_BY_SCOPE, PAIR_REVIEW_DEFAULT_LIMIT, PAIR_REVIEW_MAX_LIMIT, buildPeoplePairCandidatesSteps, configValueSchema,
  selectExemplars, selectPairReviewCrops, pairReviewSurvivor, pairDecisionIsActive, type PeoplePairDecision, type LabelledPair, appError, ok, type AppError, type Result, type PeoplePairCandidate, type PeoplePairScoreCache,
} from '@core/domain/index.js';
import { buildVisiblePeople, ensureFacesEnabled, reanchorFaceCropPath, withFaceMutation, type FacesDeps, type FacesPeopleDeps } from './faces.js';
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

const pairsInputSchema = z.object({ limit: z.number().int().min(1).max(PAIR_REVIEW_MAX_LIMIT) }).strict();

const pairScoreCaches = new WeakMap<GlobalCatalogStore, PeoplePairScoreCache>();

export const facesPairs = async (deps: FacesPeopleDeps, input: { limit: number }, cache?: FacesPairsCache): Promise<Result<FacesPairsOutput, AppError>> => {
  const parsed = pairsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('validation', 'Invalid pair review limit') };
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
  const visiblePersonIds = new Set(loaded.value.people.map((p) => p.personId));
  for (const observation of loaded.value.visible) {
    if (observation.personId === null || !visiblePersonIds.has(observation.personId)) continue;
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
  try {
    const peopleVersion = sha256Hex(JSON.stringify([loaded.value, [...embeddings.value].map(([id, vector]) => [id, [...vector]])]));
    const revision = sha256Hex(JSON.stringify([peopleVersion, activeDecisions, scope.data, parsed.data.limit]));
    if (cache?.revision === revision && cache.output !== null) return ok(cache.output);
    let scoreCache = pairScoreCaches.get(deps.globalCatalog);
    if (scoreCache === undefined) {
      scoreCache = {};
      pairScoreCaches.set(deps.globalCatalog, scoreCache);
    }
    const steps = buildPeoplePairCandidatesSteps({
      scoreCache, peopleVersion,
      people: loaded.value.people, visibleObservations: loaded.value.visible, anchorObservations: loaded.value.anchors,
      exemplarEmbeddings: embeddings.value, decisions: activeDecisions, nowIso,
      askLow, cut: FACE_CLUSTERING.clusterCutSimilarity, limit: parsed.data.limit,
    });
    let step = steps.next();
    while (!step.done) {
      await setImmediate();
      step = steps.next();
    }
    const queue = step.value;
    for (const candidate of queue.candidates) for (const side of [candidate.a, candidate.b]) side.cropPaths = side.cropPaths.map((p) => reanchorFaceCropPath(loaded.value.catalogDir, p));
    const output = { ...queue, scope: scope.data, askLow, clusterCut: FACE_CLUSTERING.clusterCutSimilarity };
    if (cache !== undefined) { cache.revision = revision; cache.output = output; }
    return ok(output);
  } catch {
    return { ok: false, error: appError('internal', 'Pair review candidate generation failed') };
  }
};

export interface FacesPairsDecideInput {
  personAId: string;
  personBId: string;
  decision: PeoplePairDecision['decision'];
  survivorPersonId?: string | undefined;
}
type PairMergeOutput = Extract<Awaited<ReturnType<GlobalCatalogStore['mergePeople']>>, { ok: true }>['value'];
export interface FacesPairsDecideOutput {
  personAId: string;
  personBId: string;
  decision: PeoplePairDecision['decision'];
  merge: PairMergeOutput | null;
  survivingPersonId: string | null;
  pending: number;
}
export interface FacesPairsUndoOutput {
  undone: boolean;
  reason: 'none_to_undo' | 'merge_not_undoable' | null;
  personAId: string | null;
  personBId: string | null;
  pending: number;
}
type PairMutationDeps = FacesPeopleDeps & Pick<FacesDeps, 'jobs'>;

export const facesPairsDecide = async (deps: PairMutationDeps, input: FacesPairsDecideInput): Promise<Result<FacesPairsDecideOutput, AppError>> => withFaceMutation(deps.jobs, async () => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  if (input.personAId === input.personBId) return { ok: false, error: appError('validation', 'Cannot decide a self-pair') };
  if (input.survivorPersonId !== undefined && input.survivorPersonId !== input.personAId && input.survivorPersonId !== input.personBId) return { ok: false, error: appError('validation', 'Survivor must belong to the pair') };
  const loaded = await loadPairReviewPeople(deps);
  if (!loaded.ok) return loaded;
  const a = loaded.value.allPeople.find((p) => p.personId === input.personAId);
  const b = loaded.value.allPeople.find((p) => p.personId === input.personBId);
  if (a === undefined || b === undefined) return { ok: false, error: appError('not_found', 'Person not found') };
  const anchor = (id: string) => {
    const visible = loaded.value.visible.filter((o) => o.personId === id);
    const all = loaded.value.anchors.filter((o) => o.personId === id);
    return { observation: selectPairReviewCrops(visible)[0] ?? selectPairReviewCrops(all)[0] ?? selectExemplars(all)[0], count: visible.length || all.length };
  };
  const anchorA = anchor(a.personId);
  const anchorB = anchor(b.personId);
  if (anchorA.observation === undefined || anchorB.observation === undefined) return { ok: false, error: appError('validation', 'A person without observations cannot be reviewed') };
  const row: PeoplePairDecision = {
    obsAId: anchorA.observation.obsId, obsBId: anchorB.observation.obsId,
    personAId: a.personId, personBId: b.personId, decision: input.decision,
    decidedAt: new Date().toISOString(), source: 'user',
  };
  let merge: PairMergeOutput | null = null;
  let survivingPersonId: string | null = null;
  if (input.decision === 'same') {
    const survivor = input.survivorPersonId ?? pairReviewSurvivor({ ...a, observationCount: anchorA.count }, { ...b, observationCount: anchorB.count });
    const merged = await deps.globalCatalog.withBatch(async () => {
      const result = await deps.globalCatalog.mergePeople({ fromPersonId: survivor === a.personId ? b.personId : a.personId, toPersonId: survivor });
      if (!result.ok) return result;
      const recorded = await deps.globalCatalog.recordPeoplePairDecision({ ...row, personAId: survivor, personBId: survivor });
      if (!recorded.ok) return recorded;
      return result;
    });
    if (!merged.ok) return merged;
    merge = merged.value;
    survivingPersonId = survivor;
  } else {
    const recorded = await deps.globalCatalog.recordPeoplePairDecision(row);
    if (!recorded.ok) return recorded;
  }
  const queue = await facesPairs(deps, { limit: PAIR_REVIEW_DEFAULT_LIMIT });
  if (!queue.ok) return queue;
  return ok({ personAId: a.personId, personBId: b.personId, decision: input.decision, merge, survivingPersonId, pending: queue.value.pending });
});

export const facesPairsUndo = async (deps: PairMutationDeps): Promise<Result<FacesPairsUndoOutput, AppError>> => withFaceMutation(deps.jobs, async () => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const latest = await deps.globalCatalog.latestUserPeoplePairDecision();
  if (!latest.ok) return latest;
  const row = latest.value;
  const reason = row === null ? 'none_to_undo' : row.decision === 'same' ? 'merge_not_undoable' : null;
  if (row !== null && reason === null) {
    const deleted = await deps.globalCatalog.deletePeoplePairDecision(row.obsAId, row.obsBId);
    if (!deleted.ok) return deleted;
  }
  const queue = await facesPairs(deps, { limit: PAIR_REVIEW_DEFAULT_LIMIT });
  if (!queue.ok) return queue;
  return ok({ undone: reason === null, reason, personAId: row?.personAId ?? null, personBId: row?.personBId ?? null, pending: queue.value.pending });
});

export interface FacesPairsImportOutput {
  dryRun: boolean;
  imported: number;
  skipped: number;
  unresolved: number;
  alreadyTogether: number;
  conflicting: number;
  merges: number;
  decisionsInvalidated: number;
}

export const facesPairsImport = async (deps: PairMutationDeps, input: {
  pairs: readonly LabelledPair[]; applyMerges: boolean; dryRun: boolean;
}): Promise<Result<FacesPairsImportOutput, AppError>> => withFaceMutation(deps.jobs, async () => {
  const enabled = await ensureFacesEnabled(deps);
  if (!enabled.ok) return enabled;
  const operation = async (): Promise<Result<FacesPairsImportOutput, AppError>> => {
    const loaded = await deps.globalCatalog.listFaceObservationSummaries();
    if (!loaded.ok) return loaded;
    const observations = new Map(loaded.value.map((o) => [o.obsId, o]));
    const output: FacesPairsImportOutput = { dryRun: input.dryRun, imported: 0, skipped: 0, unresolved: 0, alreadyTogether: 0, conflicting: 0, merges: 0, decisionsInvalidated: 0 };
    for (const pair of input.pairs) {
      if (pair.verdict === 'unsure' || pair.verdict === 'not_face') { output.skipped += 1; continue; }
      const a = observations.get(pair.left);
      const b = observations.get(pair.right);
      if (a === undefined || b === undefined) { output.unresolved += 1; continue; }
      let personAId = a.personId;
      let personBId = b.personId;
      if (personAId !== null && personAId === personBId) {
        if (pair.verdict === 'same') output.alreadyTogether += 1;
        else output.conflicting += 1;
      }
      if (!input.dryRun && input.applyMerges && pair.verdict === 'same' && personAId !== null && personBId !== null && personAId !== personBId) {
        const personA = await deps.globalCatalog.getPerson(personAId);
        if (!personA.ok) return personA;
        const personB = await deps.globalCatalog.getPerson(personBId);
        if (!personB.ok) return personB;
        if (personA.value === null || personB.value === null) return { ok: false, error: appError('not_found', 'Person not found') };
        const all = [...observations.values()];
        const survivor = pairReviewSurvivor({ ...personA.value, observationCount: all.filter((o) => o.personId === personAId).length }, { ...personB.value, observationCount: all.filter((o) => o.personId === personBId).length });
        const from = survivor === personAId ? personBId : personAId;
        const merged = await deps.globalCatalog.mergePeople({ fromPersonId: from, toPersonId: survivor });
        if (!merged.ok) return merged;
        output.merges += 1;
        output.decisionsInvalidated += merged.value.decisionsInvalidated;
        for (const [id, observation] of observations) if (observation.personId === from) observations.set(id, { ...observation, personId: survivor });
        personAId = survivor;
        personBId = survivor;
      }
      if (!input.dryRun) {
        const recorded = await deps.globalCatalog.recordPeoplePairDecision({
          obsAId: a.obsId, obsBId: b.obsId, personAId, personBId, decision: pair.verdict,
          source: 'import', decidedAt: new Date().toISOString(),
        });
        if (!recorded.ok) return recorded;
      }
      output.imported += 1;
    }
    return ok(output);
  };
  return input.dryRun ? operation() : deps.globalCatalog.withBatch(operation);
});
