/**
 * Integration coverage for the folderless onboarding flow (architecture Delta 7,
 * "configured readiness" + Delta 3 precedence): the wizard writes every analyzer
 * and transcription key into the home scope with no folder, and readiness — both
 * the explicit home request the wizard sends and the fresh-folder request that
 * follows — must resolve the SELECTED model tag, not the built-in default. These
 * drive the real routes/use-cases and the real config store; no GUI involved.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApiClient, unwrap } from '@core/client/index.js';
import { buildApp } from '@server/src/app.js';
import { createDeps } from '@server/src/composition.js';

import { InMemoryAnalyzer, InMemoryTranscriber, dependency } from '../server/usecases/test-fakes.js';

const SELECTED_TAG = 'gemma3:4b';
const storedConfigSchema = z.record(z.string(), z.string());
const roots: string[] = [];

const readStoredConfig = (home: string): Record<string, string> =>
  storedConfigSchema.parse(JSON.parse(readFileSync(join(home, '.ai-video-cataloger', 'config.json'), 'utf8')));

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};

// The six writes the wizard performs for a local analyzer + managed whisper,
// in order, each with no folder so they land in the home scope.
const replayWizardHomeWrites = async (
  api: ReturnType<typeof createApiClient>,
  tag: string,
): Promise<void> => {
  unwrap(await api.setConfig({
    key: 'analyzer_provider',
    value: JSON.stringify({ family: 'local', providerId: 'local', modelTag: tag }),
  }));
  unwrap(await api.setConfig({ key: 'analyzer_backend', value: 'local' }));
  unwrap(await api.setConfig({ key: 'local_model', value: tag }));
  unwrap(await api.setConfig({ key: 'whisper_mode', value: 'local' }));
  unwrap(await api.setConfig({ key: 'whisper_model', value: 'base' }));
  unwrap(await api.setConfig({ key: 'whisper_binary_path', value: '' }));
};

const writeOllamaManifest = (home: string, model: string, tag: string): void => {
  const dir = join(home, '.ai-video-cataloger', 'models', 'ollama', 'manifests', 'registry.ollama.ai', 'library', model);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, tag), '{}', 'utf8');
};

describe('wizard home writes -> configured readiness (H3)', () => {
  it('persists every key to the home config file in a single scope', async () => {
    const home = tempDir('avc-h3-persist-');
    const deps = createDeps({ homeDirectory: home, workingDirectory: home });
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

    await replayWizardHomeWrites(api, SELECTED_TAG);

    const onDisk = readStoredConfig(home);
    expect(onDisk).toEqual({
      analyzer_provider: JSON.stringify({ family: 'local', providerId: 'local', modelTag: SELECTED_TAG }),
      analyzer_backend: 'local',
      local_model: SELECTED_TAG,
      whisper_mode: 'local',
      whisper_model: 'base',
      whisper_binary_path: '',
    });
  });

  it('resolves the selected tag for the explicit home readiness request', async () => {
    const home = tempDir('avc-h3-home-');
    const deps = createDeps({ homeDirectory: home, workingDirectory: home });
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency('local', true);
    deps.analyzer = analyzer;
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = dependency('whisper-base', true);
    deps.transcriber = transcriber;
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

    await replayWizardHomeWrites(api, SELECTED_TAG);
    const readiness = unwrap(await api.readiness({ scope: 'home', refresh: 'true' }));

    expect(readiness.ready).toBe(true);
    expect(analyzer.dependencyProviders.at(-1)).toMatchObject({ family: 'local', modelTag: SELECTED_TAG });
  });

  it('carries the home default into a fresh folder readiness request', async () => {
    const home = tempDir('avc-h3-folder-home-');
    const folder = tempDir('avc-h3-folder-work-');
    const deps = createDeps({ homeDirectory: home, workingDirectory: home });
    const analyzer = new InMemoryAnalyzer();
    analyzer.dependencyValue = dependency('local', true);
    deps.analyzer = analyzer;
    const transcriber = new InMemoryTranscriber();
    transcriber.dependencyValue = dependency('whisper-base', true);
    deps.transcriber = transcriber;
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

    await replayWizardHomeWrites(api, SELECTED_TAG);
    const readiness = unwrap(await api.readiness({ folder, refresh: 'true' }));

    expect(readiness.ready).toBe(true);
    expect(analyzer.dependencyProviders.at(-1)).toMatchObject({ family: 'local', modelTag: SELECTED_TAG });
  });

  it('reports ready against the real local analyzer when the selected model manifest is on disk', async () => {
    const home = tempDir('avc-h3-real-');
    writeOllamaManifest(home, 'gemma3', '4b');
    const previousOllamaHost = process.env.OLLAMA_HOST;
    // Force the daemon-unreachable path so status() falls back to on-disk manifests (Delta 7).
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    try {
      const deps = createDeps({ homeDirectory: home, workingDirectory: home });
      const transcriber = new InMemoryTranscriber();
      transcriber.dependencyValue = dependency('whisper-base', true);
      deps.transcriber = transcriber;
      const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

      await replayWizardHomeWrites(api, SELECTED_TAG);
      const readiness = unwrap(await api.readiness({ scope: 'home', refresh: 'true' }));

      expect(readiness.analyzer).toMatchObject({ family: 'local', providerId: 'local', available: true });
      expect(readiness.ready).toBe(true);
      expect(readiness.suggestedAction).toBeNull();
    } finally {
      if (previousOllamaHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = previousOllamaHost;
    }
  });

  it('does not resolve ready when only the default model manifest is on disk', async () => {
    const home = tempDir('avc-h3-real-miss-');
    writeOllamaManifest(home, 'gemma3', '12b');
    const previousOllamaHost = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    try {
      const deps = createDeps({ homeDirectory: home, workingDirectory: home });
      const transcriber = new InMemoryTranscriber();
      transcriber.dependencyValue = dependency('whisper-base', true);
      deps.transcriber = transcriber;
      const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

      await replayWizardHomeWrites(api, SELECTED_TAG);
      const readiness = unwrap(await api.readiness({ scope: 'home', refresh: 'true' }));

      expect(readiness.ready).toBe(false);
      expect(readiness.analyzer.suggestedAction).toContain(SELECTED_TAG);
    } finally {
      if (previousOllamaHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = previousOllamaHost;
    }
  });

  it('fails an invalid analyzer_provider write loudly without half-persisting the scope', async () => {
    const home = tempDir('avc-h3-loud-');
    const deps = createDeps({ homeDirectory: home, workingDirectory: home });
    deps.analyzer = new InMemoryAnalyzer();
    deps.transcriber = new InMemoryTranscriber();
    const api = createApiClient({ baseUrl: '', fetchImpl: (input, init) => buildApp(deps).request(input, init) });

    unwrap(await api.setConfig({ key: 'analyzer_backend', value: 'local' }));
    const rejected = await api.setConfig({ key: 'analyzer_provider', value: '{"family":"local"}' });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error('expected the invalid write to fail');
    expect(rejected.error.code).toBe('invalid_config_value');
    const onDisk = readStoredConfig(home);
    expect(onDisk.analyzer_provider).toBeUndefined();
    expect(onDisk.analyzer_backend).toBe('local');
  });
});
