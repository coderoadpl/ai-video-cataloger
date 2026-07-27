import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
  homes.length = 0;
});

describe('credential route', () => {
  it('stores a home-scoped credential without returning the secret', async () => {
    const deps = createInMemoryDeps();
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
      data: { providerId: 'openai', stored: true, backend: { backend: 'file', reason: 'unsupported' } },
    });
    expect(responseText).not.toContain(secret);
    expect(await deps.credentials.get('openai')).toEqual({ ok: true, value: secret });
    expect(await deps.config.getAll({ kind: 'folder', folder: '/work' })).toEqual({ ok: true, value: {} });
  });

  it('forgets a stored credential and names the backends it cleared', async () => {
    const deps = createInMemoryDeps();
    const secret = 'sk-forget-me';
    const app = buildApp(deps);
    await app.request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai', credential: secret }),
    });

    const response = await app.request('/api/credentials', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai' }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      ok: true,
      data: { providerId: 'openai', cleared: ['file'], retained: [] },
    });
    expect(responseText).not.toContain(secret);
    expect(await deps.credentials.get('openai')).toEqual({ ok: true, value: null });
  });

  it('reports an untouched pair of backends for a provider that was never stored', async () => {
    const deps = createInMemoryDeps();

    const response = await buildApp(deps).request('/api/credentials', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'gemini' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { providerId: 'gemini', cleared: [], retained: [] },
    });
  });

  it('forwards the unreadable-entry report of the store it decorates', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'composition-credentials-'));
    homes.push(home);
    await mkdir(path.join(home, '.ai-video-cataloger'), { recursive: true });
    await writeFile(
      path.join(home, '.ai-video-cataloger', 'credentials.json'),
      JSON.stringify({ openai: 'sk-good', gemini: { value: 'sk-mangled', state: 'nonsense' } }),
      { mode: 0o600 },
    );
    const deps = createDeps({ homeDirectory: home, dbDriver: 'sql-js' });

    expect(await deps.credentials.unreadableCredentialEntries?.()).toEqual({ ok: true, value: ['gemini'] });
  });
});
