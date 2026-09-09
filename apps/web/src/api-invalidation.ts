import type { QueryClient } from '@tanstack/react-query';

import { invalidateQueryKeys } from '@core/client/index.js';

import { actions } from './api.js';

const family = (query: { queryKey: readonly unknown[] }): readonly unknown[] => query.queryKey.slice(0, 1);
const browse = [
  family(actions.libraryCollection({})), family(actions.search({ query: ' ' })),
  actions.libraryFacets.queryKey, actions.catalogLocations.queryKey,
  actions.tagsList.queryKey, family(actions.libraryPreview({ fingerprint: ' ' })),
  family(actions.librarySelectionPreview({ scope: { kind: 'fingerprints', fingerprints: [' '] } })),
];
const catalog = [
  family(actions.scan({ folder: ' ' })), family(actions.catalogTree({ folder: ' ' })),
  family(actions.catalogTreeFolder({ folder: ' ' })), family(actions.catalogFolder({ folder: ' ' })),
  family(actions.catalogTreeAbsent({ folder: ' ' })), family(actions.status()), actions.indexStatus.queryKey,
];
const readiness = [family(actions.readiness()), actions.doctor.queryKey];
const config = [family(actions.config()), ...readiness, actions.providers.queryKey,
  ...catalog, ...browse, family(actions.photosStatus()), actions.facesStatus.queryKey, actions.modelsWhisper.queryKey];
const whisper = [actions.modelsWhisper.queryKey, actions.whisperRuntime.queryKey, ...config];
const localAi = [actions.localAiRequirements.queryKey, ...readiness, actions.providers.queryKey];
const affectedKeys = {
  catalog: [...catalog, ...browse, family(actions.facesPeople), family(actions.photosStatus()), family(actions.variants({ fingerprint: ' ' }))],
  folder: [...catalog, ...browse, family(actions.photosStatus()), family(actions.config()), ...readiness],
  video: [...catalog, ...browse, family(actions.variants({ fingerprint: ' ' }))],
  drive: [...catalog, ...browse, family(actions.variants({ fingerprint: ' ' })), family(actions.facesPeople)],
  photos: [family(actions.photosStatus()), ...browse, actions.indexStatus.queryKey],
  faces: [family(actions.facesPeople), ...browse],
  config,
  credentials: [actions.providers.queryKey, ...readiness],
  localAi,
  whisper,
  setup: [...whisper, ...localAi, actions.faceArtifacts.queryKey],
};

export type Invalidation = keyof typeof affectedKeys;

export const invalidateAffected = async (client: QueryClient, change: Invalidation): Promise<void> => {
  await invalidateQueryKeys(client, affectedKeys[change]);
};
