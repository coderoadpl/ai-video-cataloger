import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('GET /api/catalog/locations', () => {
  it('returns an empty locations envelope for an empty catalog', async () => {
    const app = buildApp(createInMemoryDeps({ version: '4.5.6' }));

    const response = await app.request('/api/catalog/locations');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { totalFiles: 0, locatedFiles: 0, totalPhotos: 0, locatedPhotos: 0, locations: [] },
    });
  });
});
