import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { actions } from './api.js';
import { invalidateAffected, type Invalidation } from './api-invalidation.js';

const cases = [
  ['catalog', actions.catalogTree({ folder: '/media' }), actions.config()],
  ['video', actions.catalogLocations, actions.modelsWhisper],
  ['photos', actions.photosStatus(), actions.localAiRequirements],
  ['faces', actions.facesPeople, actions.modelsWhisper],
  ['config', actions.readiness(), actions.facesPeople],
  ['credentials', actions.providers, actions.catalogLocations],
  ['localAi', actions.localAiRequirements, actions.modelsWhisper],
  ['whisper', actions.modelsWhisper, actions.localAiRequirements],
  ['setup', actions.whisperRuntime, actions.facesPeople],
] as const;

describe('mutation invalidation', () => {
  it.each(cases)('%s refreshes affected queries and preserves unrelated data', async (change: Invalidation, affected, unrelated) => {
    const client = new QueryClient();
    client.setQueryData(affected.queryKey, {});
    client.setQueryData(unrelated.queryKey, {});
    await invalidateAffected(client, change);
    expect(client.getQueryState(affected.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated.queryKey)?.isInvalidated).toBe(false);
    client.clear();
  });
});
