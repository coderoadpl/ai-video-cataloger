import { describe, expect, it } from 'vitest';

import {
  CONFIG_DEFAULTS,
  ERROR_CODES,
  LOCAL_AI_HARDWARE_TIERS,
  VIDEO_STATUSES,
  WHISPER_MODELS,
  configSchema,
  getLocalAiSupportLevel,
  videoStatusSchema,
} from './index.js';

describe('domain taxonomy', () => {
  it('contains the closed US-201 error code union', () => {
    expect(ERROR_CODES).toEqual([
      'validation',
      'not_found',
      'conflict',
      'file_not_found',
      'invalid_file_type',
      'not_a_file',
      'missing_api_key',
      'prerequisites_failed',
      'invalid_model',
      'model_not_found',
      'confirmation_required',
      'force_required',
      'download_error',
      'delete_error',
      'video_not_found',
      'reset_failed',
      'unknown_config_key',
      'invalid_config_value',
      'folder_not_found',
      'not_a_directory',
      'read_error',
      'nested_databases_found',
      'thumbnail_error',
      'processing_error',
      'analysis_parse_failed',
      'model_not_installed',
      'ollama_unavailable',
      'hw_requirements_not_met',
      'internal',
    ]);
  });

  it('keeps not_tracked out of domain video statuses', () => {
    expect(VIDEO_STATUSES).toEqual([
      'pending',
      'frames_extracted',
      'audio_extracted',
      'transcribed',
      'analyzed',
      'completed',
      'error',
    ]);
    expect(videoStatusSchema.safeParse('not_tracked').success).toBe(false);
  });
});

describe('config schema', () => {
  it('applies INV defaults', () => {
    expect(CONFIG_DEFAULTS).toEqual({
      whisper_model: 'base',
      whisper_mode: 'local',
      frames: 3,
      timeout: 120,
      skip_rename: false,
      analyzer_backend: 'claude',
      local_model: 'gemma3:12b',
    });
  });

  it('normalizes persisted number and boolean strings', () => {
    expect(configSchema.parse({ frames: '10', timeout: '30', skip_rename: 'yes' })).toMatchObject({
      frames: 10,
      timeout: 30,
      skip_rename: true,
    });
    expect(configSchema.parse({ skip_rename: '0' }).skip_rename).toBe(false);
  });

  it('rejects config validation edges outside INV ranges and values', () => {
    expect(configSchema.safeParse({ frames: 0 }).success).toBe(false);
    expect(configSchema.safeParse({ frames: 11 }).success).toBe(false);
    expect(configSchema.safeParse({ timeout: 29 }).success).toBe(false);
    expect(configSchema.safeParse({ timeout: 601 }).success).toBe(false);
    expect(configSchema.safeParse({ whisper_model: 'large' }).success).toBe(false);
    expect(configSchema.safeParse({ whisper_mode: 'none' }).success).toBe(false);
    expect(configSchema.safeParse({ analyzer_backend: 'remote' }).success).toBe(false);
    expect(configSchema.safeParse({ skip_rename: 'maybe' }).success).toBe(false);
  });
});

describe('model catalogs', () => {
  it('contains the INV whisper model catalog', () => {
    expect(WHISPER_MODELS).toEqual({
      tiny: { name: 'tiny', size: '75MB', sizeMb: 75 },
      base: { name: 'base', size: '142MB', sizeMb: 142 },
      small: { name: 'small', size: '466MB', sizeMb: 466 },
      medium: { name: 'medium', size: '1.5GB', sizeMb: 1536 },
      'large-v3': { name: 'large-v3', size: '3.1GB', sizeMb: 3174 },
    });
  });

  it('evaluates local AI support as Apple-Silicon-only with RAM thresholds', () => {
    const standardTier = LOCAL_AI_HARDWARE_TIERS['gemma3:12b'];
    expect(getLocalAiSupportLevel(standardTier, { platform: 'darwin', arch: 'arm64', ramGb: 16 })).toBe(
      'ok',
    );
    expect(getLocalAiSupportLevel(standardTier, { platform: 'darwin', arch: 'arm64', ramGb: 8 })).toBe(
      'insufficient-ram',
    );
    expect(getLocalAiSupportLevel(standardTier, { platform: 'darwin', arch: 'x64', ramGb: 64 })).toBe(
      'unsupported-platform',
    );
    expect(getLocalAiSupportLevel(standardTier, { platform: 'linux', arch: 'arm64', ramGb: 64 })).toBe(
      'unsupported-platform',
    );
  });
});
