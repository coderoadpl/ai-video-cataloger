import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, unwrap } from '@core/client/index.js';

import { createDesktopApp } from './composition.js';

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop composition', () => {
  it('resolves wizard home writes against linked managed artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-composition-'));
    roots.push(root);
    const cache = path.join(root, 'cache', '.ai-video-cataloger');
    const home = path.join(root, 'home');
    const appDirectory = path.join(home, '.ai-video-cataloger');
    const bin = path.join(cache, 'bin');
    const models = path.join(cache, 'models');
    const runtime = path.join(cache, 'runtime');
    await mkdir(path.join(models, 'whisper'), { recursive: true });
    await mkdir(path.join(models, 'ollama', 'manifests', 'registry.ollama.ai', 'library', 'gemma3'), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(models, 'whisper', 'ggml-base.bin'), 'model', 'utf8');
    await writeFile(path.join(models, 'ollama', 'manifests', 'registry.ollama.ai', 'library', 'gemma3', '4b'), '{}', 'utf8');
    await symlink(process.execPath, path.join(bin, 'whisper'));
    await mkdir(appDirectory, { recursive: true });
    await Promise.all(['bin', 'models', 'runtime'].map((name) => symlink(path.join(cache, name), path.join(appDirectory, name), 'dir')));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('OLLAMA_HOST', 'http://127.0.0.1:1');

    const desktopApp = await createDesktopApp({ version: 'test', isPackaged: false });
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: async (input, init) => desktopApp.honoApp.request(input, init),
    });
    unwrap(await api.readiness({ scope: 'home' }));
    const writes = [
      ['analyzer_provider', JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'gemma3:4b' })],
      ['analyzer_backend', 'local'],
      ['local_model', 'gemma3:4b'],
      ['whisper_mode', 'local'],
      ['whisper_model', 'base'],
      ['whisper_binary_path', ''],
    ] as const;
    for (const [key, value] of writes) unwrap(await api.setConfig({ key, value }));

    const invalidated = unwrap(await api.readiness({ scope: 'home' }));
    const refreshed = unwrap(await api.readiness({ scope: 'home', refresh: 'true' }));

    expect(invalidated.ready).toBe(true);
    expect(refreshed).toMatchObject({
      ready: true,
      analyzer: { available: true, family: 'local', providerId: 'local' },
      transcriber: { available: true, mode: 'local', model: 'base' },
      missingPieces: [],
      suggestedAction: null,
    });
    await desktopApp.dispose();
  });

  it('refuses the in-memory database driver in packaged builds', async () => {
    vi.stubEnv('DB_DRIVER', 'memory');

    await expect(createDesktopApp({ version: 'test', isPackaged: true })).rejects.toThrowError(
      'Invalid configuration: packaged app does not support DB_DRIVER=memory',
    );
  });
});
