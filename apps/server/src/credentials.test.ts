import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';

describe('credential route', () => {
  it('stores a home-scoped credential without returning the secret', async () => {
    const deps = createDeps({ dbDriver: 'memory' });
    const secret = 'sk-never-emit-this';
    const response = await buildApp(deps).request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai', credential: secret }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      ok: true,
      data: { providerId: 'openai', stored: true },
    });
    expect(responseText).not.toContain(secret);
    expect(await deps.credentials.get('openai')).toEqual({ ok: true, value: secret });
    expect(await deps.config.getAll({ kind: 'folder', folder: '/work' })).toEqual({ ok: true, value: {} });
  });
});
