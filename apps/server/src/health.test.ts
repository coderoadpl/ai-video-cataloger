import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';

describe('health live/ready routes', () => {
  it('serves liveness at 200 with the composed version and no database touch', async () => {
    const app = buildApp(createDeps({ dbDriver: 'memory', version: '4.5.6' }));

    const response = await app.request('/api/health/live');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { status: 'ok', version: '4.5.6' } });
  });

  it('serves readiness at 200 with per-check detail when the catalog opens', async () => {
    const app = buildApp(createDeps({ dbDriver: 'memory', version: '4.5.6' }));

    const response = await app.request('/api/health/ready');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        status: 'ok',
        version: '4.5.6',
        checks: [
          { name: 'catalog', ok: true },
          { name: 'lock', ok: true },
          { name: 'provider_config', ok: true },
        ],
      },
    });
  });

  it('keeps the compat /api/health route', async () => {
    const app = buildApp(createDeps({ dbDriver: 'memory', version: '4.5.6' }));

    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { status: 'ok', version: '4.5.6' } });
  });
});
