import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { buildReadinessChecklist } from './readiness-checklist.js';
import type { WhisperModelChoice } from './wizard-model.js';

interface DepInput {
  name: string;
  available: boolean;
  warning?: string;
}

const dependency = ({ name, available, warning }: DepInput) => ({
  name,
  available,
  version: available ? '1.0' : null,
  source: available ? ('system' as const) : null,
  path: null,
  installHint: available ? '' : 'install it',
  ...(warning === undefined ? {} : { warning }),
});

const readiness = (options: {
  ready?: boolean;
  analyzerAvailable?: boolean;
  transcriberMode?: 'local' | 'api' | 'skip';
  transcriberModel?: 'base' | 'small' | null;
  transcriberAvailable?: boolean;
}) => ({
  ready: options.ready ?? true,
  analyzer: {
    kind: 'analyzer' as const,
    family: 'harness' as const,
    providerId: 'claude-code',
    name: 'claude-code',
    available: options.analyzerAvailable ?? true,
    message: 'checked',
    suggestedAction: null,
    warning: null,
  },
  transcriber: {
    kind: 'transcriber' as const,
    mode: options.transcriberMode ?? 'local',
    model: options.transcriberModel === undefined ? 'base' : options.transcriberModel,
    name: 'whisper',
    available: options.transcriberAvailable ?? true,
    message: 'checked',
    suggestedAction: null,
    warning: null,
    engine: null,
    binaryPath: null,
  },
  missingPieces: [],
  suggestedAction: null,
});

const doctor = (dependencies: ReturnType<typeof dependency>[], configured: ReturnType<typeof readiness>) => ({
  dependencies,
  harnesses: [],
  machine: { platform: 'darwin', arch: 'arm64', totalMemGB: 32, appleSilicon: true },
  recommendedLocalModel: 'gemma3:12b',
  allAvailable: dependencies.every((entry) => entry.available),
  warnings: [],
  configured,
});

const installed = (names: WhisperModelChoice['name'][]): WhisperModelChoice[] =>
  names.map((name) => ({ name, size: '1 GB', downloaded: true }));

describe('buildReadinessChecklist', () => {
  it('marks every checked item green when everything is available', () => {
    const rows = buildReadinessChecklist(
      en,
      doctor(
        [dependency({ name: 'ffmpeg', available: true }), dependency({ name: 'whisper', available: true })],
        readiness({ ready: true }),
      ),
      readiness({ ready: true }),
      installed(['base']),
    );
    expect(rows.every((row) => row.status === 'ok')).toBe(true);
    expect(rows.every((row) => row.action === null)).toBe(true);
    expect(rows.map((row) => row.id)).toContain('configured-analyzer');
    expect(rows.map((row) => row.id)).toContain('configured-whisper-model');
  });

  it('flags a dependency warning as a warning row, not an error', () => {
    const rows = buildReadinessChecklist(
      en,
      doctor([dependency({ name: 'faces', available: true, warning: 'model not downloaded' })], readiness({})),
      readiness({}),
      installed(['base']),
    );
    const facesRow = rows.find((row) => row.id === 'dep-faces');
    expect(facesRow?.status).toBe('warning');
  });

  it('offers to activate the best installed model when the configured model is missing', () => {
    const rows = buildReadinessChecklist(
      en,
      null,
      readiness({ ready: false, transcriberModel: 'base', transcriberAvailable: false }),
      installed(['small']),
    );
    const whisperRow = rows.find((row) => row.id === 'configured-whisper-model');
    expect(whisperRow?.status).toBe('error');
    expect(whisperRow?.action).toEqual({ kind: 'activate-whisper', model: 'small' });
    expect(whisperRow?.actionLabel).toBe('Use small');
  });

  it('offers to download the configured model when nothing better is installed', () => {
    const rows = buildReadinessChecklist(
      en,
      null,
      readiness({ ready: false, transcriberModel: 'base', transcriberAvailable: false }),
      [],
    );
    const whisperRow = rows.find((row) => row.id === 'configured-whisper-model');
    expect(whisperRow?.action).toEqual({ kind: 'download-whisper', model: 'base' });
    expect(whisperRow?.actionLabel).toBe('Download base');
  });

  it('reflects the same configured whisper model that downloads would target', () => {
    const configuredModel = 'small';
    const rows = buildReadinessChecklist(
      en,
      null,
      readiness({ transcriberModel: configuredModel, transcriberAvailable: true }),
      installed(['small']),
    );
    const whisperRow = rows.find((row) => row.id === 'configured-whisper-model');
    expect(whisperRow?.name).toContain(configuredModel);
  });
});
