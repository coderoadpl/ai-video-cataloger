import { describe, expect, it } from 'vitest';

import type { ApiClient } from '@core/client/index.js';
import { ok, type AppError, type Result } from '@core/domain/index.js';

import { doctorHuman } from './doctor-human.js';

type DoctorOutput = Awaited<ReturnType<ApiClient['doctor']>> extends Result<infer T, AppError> ? T : never;

const doctorOutput = (overrides: Partial<DoctorOutput> = {}): DoctorOutput => ({
  dependencies: [
    { name: 'ffmpeg', available: true, version: '7.1', source: 'bundled', path: '/bundled/ffmpeg', installHint: '' },
    {
      name: 'whisper',
      available: true,
      version: '1.2.3',
      source: 'system',
      path: '/opt/homebrew/bin/whisper',
      installHint: '',
      engine: 'openai-whisper',
    },
  ],
  harnesses: [],
  machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 32, appleSilicon: true },
  recommendedLocalModel: null,
  allAvailable: true,
  warnings: [],
  configured: {
    ready: true,
    analyzer: {
      kind: 'analyzer',
      name: 'codex',
      available: true,
      message: 'codex is available',
      suggestedAction: null,
      family: 'harness',
      providerId: 'codex',
    },
    transcriber: {
      kind: 'transcriber',
      name: 'whisper',
      available: true,
      message: 'whisper is available',
      suggestedAction: null,
      mode: 'local',
      model: 'base',
      engine: 'openai-whisper',
      binaryPath: '/opt/homebrew/bin/whisper',
    },
    missingPieces: [],
    suggestedAction: null,
  },
  ...overrides,
});

const live = ok({ status: 'ok' as const, version: '0.5.14' });
const ready = ok({ status: 'ok' as const, version: '0.5.14', checks: [] });

describe('doctorHuman', () => {
  it('names the engine and binary of the resolved whisper dependency', () => {
    const output = doctorHuman(doctorOutput(), live, ready);

    expect(output).toContain('whisper: available (engine: openai-whisper (python, CPU), binary: /opt/homebrew/bin/whisper)');
    expect(output).toContain('Transcriber (local): available (engine: openai-whisper (python, CPU), binary: /opt/homebrew/bin/whisper)');
    expect(output.split('\n')).toContain('ffmpeg: available');
  });

  it('labels a whisper.cpp resolution and omits the suffix when no engine is known', () => {
    const data = doctorOutput();
    const output = doctorHuman({
      ...data,
      dependencies: data.dependencies.map((entry) =>
        entry.name === 'whisper' ? { ...entry, path: '/opt/homebrew/bin/whisper-cli', engine: 'whisper-cli' as const } : entry),
      configured: {
        ...data.configured,
        transcriber: { ...data.configured.transcriber, mode: 'api' as const, model: null, engine: null, binaryPath: null },
      },
    }, live, ready);

    expect(output).toContain('whisper: available (engine: whisper.cpp, binary: /opt/homebrew/bin/whisper-cli)');
    expect(output.split('\n')).toContain('Transcriber (api): available');
  });
});
