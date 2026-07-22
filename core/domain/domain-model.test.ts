import { describe, expect, it } from 'vitest';

import {
  CONFIG_DEFAULTS,
  ERROR_CODES,
  LOCAL_AI_HARDWARE_TIERS,
  VIDEO_STATUSES,
  WHISPER_MODEL_NAMES,
  WHISPER_MODELS,
  configSchema,
  getLocalAiSupportLevel,
  analyzerProviderConfigSchema,
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
      'provider_auth_failed',
      'rate_limited',
      'provider_error',
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
      'drive_root_empty',
      'drive_run_aborted',
      'thumbnail_error',
      'processing_error',
      'analysis_parse_failed',
      'model_not_installed',
      'ollama_unavailable',
      'hw_requirements_not_met',
      'faces_disabled',
      'snapshot_incompatible',
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
      whisper_binary_path: '',
      whisper_model: 'base',
      whisper_mode: 'local',
      whisper_api_base_url: 'https://api.openai.com/v1',
      whisper_api_model: 'whisper-1',
      frames: 3,
      timeout: 120,
      skip_rename: false,
      analyzer_backend: 'claude',
      local_model: 'gemma3:12b',
      analyzer_provider: {
        family: 'harness',
        providerId: 'claude-code',
        command: 'claude',
        argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
        promptStyle: 'file-urls',
      },
      faces_enabled: false,
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

describe('analyzer provider schema', () => {
  it.each([
    {
      family: 'api',
      providerId: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyRef: 'openrouter-main',
      model: 'openai/gpt-4.1-mini',
      maxImageDetail: 'high',
      pricePerMTokensInput: 2.5,
      pricePerMTokensOutput: 10,
    },
    {
      family: 'harness',
      providerId: 'custom-agent',
      command: '/opt/bin/custom-agent',
      argsTemplate: ['run', '{prompt}', '--directory', '{videoDir}'],
      promptStyle: 'dir-access',
      model: 'custom-model',
      reasoningEffort: 'medium',
    },
    {
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
    },
  ])('round-trips a closed $family provider config', (provider) => {
    expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
  });

  it('rejects fields from another family and unsupported harness placeholders', () => {
    expect(analyzerProviderConfigSchema.safeParse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      apiKeyRef: 'must-not-cross-families',
    }).success).toBe(false);
    expect(analyzerProviderConfigSchema.safeParse({
      family: 'harness',
      providerId: 'custom',
      command: 'agent',
      argsTemplate: ['{query}'],
      promptStyle: 'file-urls',
    }).success).toBe(false);
  });

  it('defaults API providers to the OpenAI-compatible v1 base URL', () => {
    const provider = analyzerProviderConfigSchema.parse({
      family: 'api',
      providerId: 'openai',
      apiKeyRef: 'openai',
      model: 'vision-model',
      maxImageDetail: 'auto',
    });

    expect(provider).toMatchObject({ baseUrl: 'https://api.openai.com/v1' });
  });

  it('maps legacy analyzer aliases to canonical provider configs', () => {
    expect(configSchema.parse({ analyzer_backend: 'claude' }).analyzer_provider).toMatchObject({
      family: 'harness',
      providerId: 'claude-code',
    });
    expect(configSchema.parse({ analyzer_backend: 'local', local_model: 'gemma3:27b' }).analyzer_provider).toEqual({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:27b',
    });
  });
});

describe('model catalogs', () => {
  it('contains the INV whisper model catalog', () => {
    expect(WHISPER_MODEL_NAMES).toEqual(['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo']);
    expect(WHISPER_MODELS).toEqual({
      tiny: { name: 'tiny', size: '75MB', sizeMb: 75 },
      base: { name: 'base', size: '142MB', sizeMb: 142 },
      small: { name: 'small', size: '466MB', sizeMb: 466 },
      medium: { name: 'medium', size: '1.5GB', sizeMb: 1536 },
      'large-v3': { name: 'large-v3', size: '3.1GB', sizeMb: 3174 },
      'large-v3-turbo': { name: 'large-v3-turbo', size: '1.6GB', sizeMb: 1549 },
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
