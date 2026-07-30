import { describe, expect, it } from 'vitest';

import {
  CONFIG_DEFAULTS,
  CONFIG_IDENTITY_CLASSIFICATION,
  CONFIG_KEYS,
  LEGACY_CONFIG_ID,
  buildConfigDescriptor,
  configDescriptorSchema,
  configId,
  type ConfigInput,
} from './index.js';

const promptVersion = 1;

const goldenVectors = [
  {
    descriptor: configDescriptorSchema.parse({
      family: 'api',
      providerId: 'openai',
      model: 'gpt-5.5',
      maxImageDetail: 'high',
      whisper_mode: 'local',
      whisper_model: 'base',
      whisper_language: 'auto',
      frames: 3,
      output_language: 'en',
      promptVersion,
    }),
    id: 'cfg_5a3e7a0cd390',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'harness',
      providerId: 'codex',
      promptStyle: 'dir-access',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      whisper_mode: 'api',
      whisper_language: 'auto',
      whisper_api_base_url: 'https://api.openai.com/v1',
      whisper_api_model: 'whisper-1',
      frames: 8,
      output_language: 'pl',
      promptVersion,
    }),
    id: 'cfg_2fa33be067a7',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'skip',
      frames: 5,
      output_language: 'auto',
      promptVersion,
    }),
    id: 'cfg_6802f859cedc',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'gemini-native',
      providerId: 'gemini',
      model: 'gemini-3.6-flash',
      output_language: 'en',
      promptVersion,
    }),
    id: 'cfg_2a46b8d6a693',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'harness',
      providerId: 'claude-code',
      promptStyle: 'file-urls',
      whisper_mode: 'local',
      whisper_model: 'small',
      whisper_language: 'auto',
      frames: 3,
      output_language: 'pt-BR',
      promptVersion: 2,
    }),
    id: 'cfg_46625534e8ab',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:27b',
      whisper_mode: 'api',
      whisper_language: 'auto',
      whisper_api_base_url: 'https://speech.example.test/v1',
      whisper_api_model: 'whisper-large-v3',
      frames: 10,
      output_language: 'auto',
      promptVersion: 3,
    }),
    id: 'cfg_161154c06d8d',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'harness',
      providerId: 'codex',
      promptStyle: 'dir-access',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      whisper_mode: 'api',
      whisper_language: 'auto',
      whisper_api_base_url: 'https://api.openai.com/v1',
      whisper_api_model: 'whisper-1',
      frames: 8,
      output_language: 'pl',
      tag_language: 'en',
      promptVersion,
    }),
    id: 'cfg_42eee147a85d',
  },
  {
    descriptor: configDescriptorSchema.parse({
      family: 'gemini-native',
      providerId: 'gemini',
      model: 'gemini-3.6-flash',
      output_language: 'auto',
      tag_language: 'pl',
      promptVersion,
    }),
    id: 'cfg_9a046ebf1b1b',
  },
];

describe('config descriptor identity', () => {
  it('is closed and enforces family-specific and transcription-specific fields', () => {
    expect(configDescriptorSchema.safeParse({
      ...goldenVectors[0]?.descriptor,
      apiKeyRef: 'must-not-enter-the-descriptor',
    }).success).toBe(false);
    expect(configDescriptorSchema.safeParse({
      ...goldenVectors[3]?.descriptor,
      frames: 3,
    }).success).toBe(false);
    expect(configDescriptorSchema.safeParse({
      ...goldenVectors[2]?.descriptor,
      whisper_model: 'base',
    }).success).toBe(false);
  });

  it('pins canonical descriptor hashes with auto whisper language materialized for transcription', () => {
    expect(goldenVectors.map((vector) => configId(vector.descriptor))).toEqual(
      goldenVectors.map((vector) => vector.id),
    );
  });

  it('folds the claude legacy alias into the explicit harness provider', () => {
    const aliased = buildConfigDescriptor({ analyzer_backend: 'claude' }, promptVersion);
    const explicit = buildConfigDescriptor({
      analyzer_provider: {
        family: 'harness',
        providerId: 'claude-code',
        command: 'claude',
        argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
        promptStyle: 'file-urls',
      },
    }, promptVersion);

    expect(aliased).toEqual(explicit);
    expect(configId(aliased)).toBe(configId(explicit));
  });

  it('folds the local legacy alias and materializes defaults', () => {
    const aliased = buildConfigDescriptor({ analyzer_backend: 'local', local_model: 'gemma3:27b' }, promptVersion);
    const explicit = buildConfigDescriptor({
      analyzer_provider: { family: 'local', providerId: 'local', modelTag: 'gemma3:27b' },
    }, promptVersion);

    expect(aliased).toEqual(explicit);
    expect(buildConfigDescriptor({}, promptVersion)).toEqual(buildConfigDescriptor(CONFIG_DEFAULTS, promptVersion));
  });

  it.each([
    { field: 'timeout', mutation: { timeout: 600 } },
    { field: 'skip_rename', mutation: { skip_rename: true } },
    { field: 'gemini_batch_mode', mutation: { gemini_batch_mode: true } },
    { field: 'whisper_binary_path', mutation: { whisper_binary_path: '/machine-specific/whisper' } },
    { field: 'faces_enabled', mutation: { faces_enabled: true } },
    { field: 'ui_language', mutation: { ui_language: 'pl' } },
    { field: 'gemini_monthly_budget_usd', mutation: { gemini_monthly_budget_usd: 25 } },
  ] satisfies readonly { field: string; mutation: ConfigInput }[])('excludes $field from the id', ({ mutation }) => {
    const base = buildConfigDescriptor({}, promptVersion);
    const changed = buildConfigDescriptor({ ...mutation }, promptVersion);

    expect(configId(changed)).toBe(configId(base));
  });

  it('excludes analyzer credentials, endpoints, and pricing from identity', () => {
    const provider = {
      family: 'api',
      providerId: 'openai',
      baseUrl: 'https://first.example.test/v1',
      apiKeyRef: 'secret-one',
      model: 'gpt-5.5',
      maxImageDetail: 'auto',
      pricePerMTokensInput: 1,
      pricePerMTokensOutput: 2,
    } as const;
    const base = buildConfigDescriptor({ analyzer_provider: provider }, promptVersion);
    const changed = buildConfigDescriptor({
      analyzer_provider: {
        ...provider,
        baseUrl: 'https://second.example.test/v1',
        apiKeyRef: 'secret-two',
        pricePerMTokensInput: 30,
        pricePerMTokensOutput: 60,
      },
    }, promptVersion);

    expect(configId(changed)).toBe(configId(base));
    expect(JSON.stringify(base)).not.toContain('secret-one');
  });

  it('includes output language, whisper language, and prompt version in identity', () => {
    const base = buildConfigDescriptor({}, promptVersion);

    expect(configId(buildConfigDescriptor({ output_language: 'pl' }, promptVersion))).not.toBe(configId(base));
    expect(configId(buildConfigDescriptor({ whisper_language: 'pl' }, promptVersion))).not.toBe(
      configId(buildConfigDescriptor({ whisper_language: 'auto' }, promptVersion)),
    );
    expect(configId(buildConfigDescriptor({}, promptVersion + 1))).not.toBe(configId(base));
  });

  it('includes tag_language in identity when it diverges from output_language', () => {
    const withoutTagLanguage = buildConfigDescriptor({ output_language: 'pl' }, promptVersion);
    const withTagLanguage = buildConfigDescriptor({ output_language: 'pl', tag_language: 'en' }, promptVersion);

    expect(configId(withTagLanguage)).not.toBe(configId(withoutTagLanguage));
  });

  it('omits tag_language from the descriptor only when it and output_language both resolve to auto', () => {
    const defaultDescriptor = buildConfigDescriptor({}, promptVersion);
    expect(defaultDescriptor.tag_language).toBeUndefined();

    const pinnedOutput = buildConfigDescriptor({ output_language: 'pl' }, promptVersion);
    expect(pinnedOutput.tag_language).toBe('pl');

    const explicitlyEqual = buildConfigDescriptor({ output_language: 'pl', tag_language: 'pl' }, promptVersion);
    expect(configId(explicitlyEqual)).toBe(configId(pinnedOutput));
  });

  it('parses descriptors persisted before tag_language existed and keeps their historical configId', () => {
    const stored = configDescriptorSchema.parse({
      family: 'harness',
      providerId: 'codex',
      promptStyle: 'file-urls',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
      whisper_mode: 'local',
      whisper_model: 'large-v3-turbo',
      frames: 3,
      output_language: 'auto',
      promptVersion: 4,
    });

    expect(stored.tag_language).toBeUndefined();
    expect(configId(stored)).not.toBe(configId({ ...stored, tag_language: 'auto' }));
  });

  it('reserves legacy outside the generated id namespace', () => {
    for (const vector of goldenVectors) {
      expect(configId(vector.descriptor)).toMatch(/^cfg_[0-9a-f]{12}$/);
      expect(configId(vector.descriptor)).not.toBe(LEGACY_CONFIG_ID);
    }
  });

  it('parses descriptors persisted before whisper_language existed', () => {
    const stored = configDescriptorSchema.parse({
      family: 'harness',
      providerId: 'codex',
      promptStyle: 'file-urls',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
      whisper_mode: 'local',
      whisper_model: 'large-v3-turbo',
      frames: 3,
      output_language: 'auto',
      promptVersion: 4,
    });

    expect(stored.whisper_language).toBeUndefined();
    expect(configId(stored)).not.toBe(configId({ ...stored, whisper_language: 'auto' }));
  });

  it('pins the video descriptor id against origin/main before the photo-descriptor split (P1)', () => {
    expect(configId(buildConfigDescriptor(CONFIG_DEFAULTS, 4))).toBe('cfg_b445a6abf87f');
    expect(configId(buildConfigDescriptor({
      analyzer_provider: { family: 'gemini-native', providerId: 'gemini', apiKeyRef: 'ref', model: 'gemini-3.6-flash' },
      output_language: 'pl',
    }, 4))).toBe('cfg_8e038c12e087');
    expect(Object.keys(buildConfigDescriptor(CONFIG_DEFAULTS, 4))).not.toContain('kind');
  });

  it('classifies every config key as identity-bearing or excluded', () => {
    expect(Object.keys(CONFIG_IDENTITY_CLASSIFICATION).sort()).toEqual([...CONFIG_KEYS].sort());
    expect(Object.values(CONFIG_IDENTITY_CLASSIFICATION).every((value) => (
      value === 'identity' || value === 'excluded'
    ))).toBe(true);
  });
});
