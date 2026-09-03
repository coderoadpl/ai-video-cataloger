import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('GET /api/library/facets', () => {
  it('returns empty facets and zero counts for an empty catalog', async () => {
    const app = buildApp(createInMemoryDeps({ version: '4.5.6' }));

    const response = await app.request('/api/library/facets');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        tags: [],
        people: [],
        places: [],
        years: [],
        folders: [],
        counts: { total: 0, withGps: 0, withoutCaptureDate: 0, missing: 0, hidden: 0, offlineFolders: 0 },
      },
    });
  });
});
