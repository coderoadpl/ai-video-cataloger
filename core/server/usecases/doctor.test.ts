import { describe, expect, it } from 'vitest';

import { runDoctor } from './doctor.js';
import { dependency, InMemoryAnalyzer, InMemoryLocalAi, InMemoryMedia, InMemoryTranscriber } from '../../../test/server/usecases/test-fakes.js';

describe('runDoctor', () => {
  it('combines dependency status with machine recommendation', async () => {
    const localAi = new InMemoryLocalAi();
    localAi.machineValue = { platform: 'darwin', arch: 'arm64', ramGb: 16 };
    const deps = {
      media: new InMemoryMedia(),
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      localAi,
    };

    const result = await runDoctor(deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true },
        recommendedLocalModel: 'gemma3:12b',
        allAvailable: true,
      },
    });
  });

  it('marks allAvailable false when one dependency is unavailable', async () => {
    const media = new InMemoryMedia();
    media.dependenciesValue = [dependency('ffmpeg', false)];
    const deps = {
      media,
      transcriber: new InMemoryTranscriber(),
      analyzer: new InMemoryAnalyzer(),
      localAi: new InMemoryLocalAi(),
    };

    const result = await runDoctor(deps);

    expect(result).toMatchObject({ ok: true, value: { allAvailable: false } });
  });
});
