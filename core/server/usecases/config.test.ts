import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS } from '@core/domain/index.js';

import { getConfig, setConfig } from './config.js';
import { InMemoryConfig, InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

describe('config use-cases', () => {
  it('sets normalized folder config and reads it back with defaults', async () => {
    const deps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem('/work') };

    const set = await setConfig(deps, { folder: '/work', key: 'frames', value: '4' });
    const get = await getConfig(deps, { folder: '/work', key: 'frames' });

    expect(set).toEqual({ ok: true, value: { key: 'frames', value: '4', previousValue: null } });
    expect(get).toEqual({
      ok: true,
      value: {
        key: 'frames',
        value: '4',
        defaultValue: '3',
        description: 'Number of frames to extract for analysis',
        effectiveValue: '4',
        source: 'folder',
      },
    });
  });

  it('returns all stored values with nulls for unset keys', async () => {
    const deps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem('/work') };
    await setConfig(deps, { key: 'skip_rename', value: 'yes' });

    const result = await getConfig(deps, { key: null });

    expect(result).toMatchObject({
      ok: true,
      value: {
        config: {
          whisper_model: null,
          whisper_mode: null,
          frames: null,
          timeout: null,
          skip_rename: 'true',
          analyzer_backend: null,
          local_model: null,
        },
      },
    });
  });

  it('rejects values outside the config schema', async () => {
    const deps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem('/work') };

    const result = await setConfig(deps, { key: 'timeout', value: '2' });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_config_value' } });
  });

  it('stores omitted-folder writes in home scope and explicit-folder writes in folder scope', async () => {
    const config = new InMemoryConfig();
    const deps = { config, fs: new InMemoryFileSystem('/work') };

    await setConfig(deps, { key: 'whisper_binary_path', value: '/opt/whisper-fast' });
    await setConfig(deps, { folder: '/work', key: 'whisper_binary_path', value: '/work/whisper-fast' });
    const home = await config.get({ kind: 'home' }, 'whisper_binary_path');
    const folder = await config.get({ kind: 'folder', folder: '/work' }, 'whisper_binary_path');
    const all = await getConfig(deps, { folder: '/work', key: null });

    expect(home).toEqual({ ok: true, value: '/opt/whisper-fast' });
    expect(folder).toEqual({ ok: true, value: '/work/whisper-fast' });
    expect(all).toMatchObject({
      ok: true,
      value: {
        config: { whisper_binary_path: '/work/whisper-fast' },
        effective: { whisper_binary_path: '/work/whisper-fast' },
        sources: { whisper_binary_path: 'folder' },
      },
    });
  });

  it('reports effective values and provenance for every key', async () => {
    const config = new InMemoryConfig();
    const deps = { config, fs: new InMemoryFileSystem('/work') };
    const homeValues = {
      whisper_binary_path: '/home/whisper',
      whisper_model: 'small',
      whisper_mode: 'api',
      whisper_api_base_url: 'https://home.example.com/v1',
      whisper_api_model: 'home-whisper',
      frames: '4',
      timeout: '180',
      skip_rename: 'true',
      analyzer_backend: 'local',
      local_model: 'home:model',
      analyzer_provider: JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'home:model' }),
      faces_enabled: 'true',
      output_language: 'pl',
      ui_language: 'pl',
    } as const;
    for (const key of CONFIG_KEYS) {
      await setConfig(deps, { key, value: homeValues[key] });
    }
    await setConfig(deps, { folder: '/work', key: 'frames', value: '6' });

    const result = await getConfig(deps, { folder: '/work', key: null });

    expect(result).toMatchObject({
      ok: true,
      value: {
        config: { frames: '6', whisper_model: null },
        effective: { ...homeValues, frames: '6' },
        sources: {
          whisper_binary_path: 'home',
          whisper_model: 'home',
          whisper_mode: 'home',
          whisper_api_base_url: 'home',
          whisper_api_model: 'home',
          frames: 'folder',
          timeout: 'home',
          skip_rename: 'home',
          analyzer_backend: 'home',
          local_model: 'home',
          analyzer_provider: 'home',
          faces_enabled: 'home',
          output_language: 'home',
          ui_language: 'home',
        },
      },
    });
  });

  it('lets folder values override home values for every key', async () => {
    const config = new InMemoryConfig();
    const deps = { config, fs: new InMemoryFileSystem('/work') };
    const homeValues = {
      whisper_binary_path: '/home/whisper',
      whisper_model: 'small',
      whisper_mode: 'api',
      whisper_api_base_url: 'https://home.example.com/v1',
      whisper_api_model: 'home-whisper',
      frames: '4',
      timeout: '180',
      skip_rename: 'true',
      analyzer_backend: 'local',
      local_model: 'home:model',
      analyzer_provider: JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'home:model' }),
      faces_enabled: 'false',
      output_language: 'en',
      ui_language: 'en',
    } as const;
    const folderValues = {
      whisper_binary_path: '/folder/whisper',
      whisper_model: 'tiny',
      whisper_mode: 'local',
      whisper_api_base_url: 'https://folder.example.com/v1',
      whisper_api_model: 'folder-whisper',
      frames: '6',
      timeout: '210',
      skip_rename: 'false',
      analyzer_backend: 'claude',
      local_model: 'folder:model',
      analyzer_provider: JSON.stringify({ family: 'local', providerId: 'local', modelTag: 'folder:model' }),
      faces_enabled: 'true',
      output_language: 'pl',
      ui_language: 'pl',
    } as const;
    for (const key of CONFIG_KEYS) {
      expect(await setConfig(deps, { key, value: homeValues[key] })).toMatchObject({ ok: true });
      expect(await setConfig(deps, { folder: '/work', key, value: folderValues[key] })).toMatchObject({ ok: true });
    }

    const result = await getConfig(deps, { folder: '/work', key: null });

    expect(result).toMatchObject({
      ok: true,
      value: {
        config: folderValues,
        effective: folderValues,
        sources: {
          whisper_binary_path: 'folder',
          whisper_model: 'folder',
          whisper_mode: 'folder',
          whisper_api_base_url: 'folder',
          whisper_api_model: 'folder',
          frames: 'folder',
          timeout: 'folder',
          skip_rename: 'folder',
          analyzer_backend: 'folder',
          local_model: 'folder',
          analyzer_provider: 'folder',
          faces_enabled: 'folder',
          output_language: 'folder',
          ui_language: 'folder',
        },
      },
    });
  });
});
