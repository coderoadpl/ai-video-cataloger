import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { JsonCredentialsStore } from './index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('JsonCredentialsStore', () => {
  it('stores credentials in the home scope with owner-only permissions', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'credentials-store-'));
    roots.push(home);
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.set('openrouter', 'secret-value')).toEqual({ ok: true, value: undefined });
    expect(await store.get('openrouter')).toEqual({ ok: true, value: 'secret-value' });

    const filePath = path.join(home, '.ai-video-cataloger', 'credentials.json');
    const mode = (await stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ openrouter: 'secret-value' });
  });

  it('returns null for an unknown provider reference', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'credentials-store-'));
    roots.push(home);
    const store = new JsonCredentialsStore({ homeDirectory: home });

    expect(await store.get('missing')).toEqual({ ok: true, value: null });
  });
});
