import { describe, expect, it } from 'vitest';

import { getConfig, setConfig } from './config.js';
import { InMemoryConfig, InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

describe('config use-cases', () => {
  it('sets normalized folder config and reads it back with defaults', async () => {
    const deps = { config: new InMemoryConfig(), fs: new InMemoryFileSystem('/work') };

    const set = await setConfig(deps, { key: 'frames', value: '4' });
    const get = await getConfig(deps, { key: 'frames' });

    expect(set).toEqual({ ok: true, value: { key: 'frames', value: '4', previousValue: null } });
    expect(get).toEqual({
      ok: true,
      value: {
        key: 'frames',
        value: '4',
        defaultValue: '3',
        description: 'Number of frames to extract for analysis',
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
});
