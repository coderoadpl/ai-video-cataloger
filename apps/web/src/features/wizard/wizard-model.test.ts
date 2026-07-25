import { describe, expect, it } from 'vitest';

import { analyzerProviderConfigSchema } from '@core/domain/index.js';

import {
  analyzerBackendFor,
  buildApiProvider,
  buildGeminiProvider,
  buildHarnessProvider,
  buildLocalProvider,
  emptyApiDraft,
  emptyGeminiDraft,
  harnessDescriptors,
  recommendedTier,
  type LocalAiTier,
} from './wizard-model.js';

const tier = (patch: Partial<LocalAiTier>): LocalAiTier => ({
  tag: 'gemma3:12b',
  label: 'Gemma 3 12B',
  downloadGB: 8,
  minTotalMemGB: 16,
  supportLevel: 'ok',
  installed: false,
  recommended: false,
  ...patch,
});

describe('wizard-model builders', () => {
  it('builds a valid local provider config', () => {
    const provider = buildLocalProvider('gemma3:12b');
    expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
    expect(analyzerBackendFor(provider)).toBe('local');
  });

  it('builds each built-in harness into a valid config', () => {
    for (const descriptor of harnessDescriptors()) {
      const provider = buildHarnessProvider(descriptor);
      expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
      expect(analyzerBackendFor(provider)).toBe('claude');
    }
  });

  it('omits price fields when the draft leaves them blank', () => {
    const provider = buildApiProvider(emptyApiDraft());
    expect(provider.pricePerMTokensInput).toBeUndefined();
    expect(provider.pricePerMTokensOutput).toBeUndefined();
    expect(provider.apiKeyRef).toBe('openai');
    expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
  });

  it('parses numeric price fields when provided', () => {
    const provider = buildApiProvider({
      ...emptyApiDraft(),
      pricePerMTokensInput: '0.15',
      pricePerMTokensOutput: '0.6',
    });
    expect(provider.pricePerMTokensInput).toBe(0.15);
    expect(provider.pricePerMTokensOutput).toBe(0.6);
  });

  it('uses the endpoint hostname as the credential slot for compatible APIs', () => {
    const provider = buildApiProvider({
      ...emptyApiDraft(),
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(provider.providerId).toBe('openrouter.ai');
    expect(provider.apiKeyRef).toBe('openrouter.ai');
  });

  it('builds a valid gemini-native provider with priced defaults', () => {
    const draft = emptyGeminiDraft();
    const provider = buildGeminiProvider(draft);

    expect(draft.model.length).toBeGreaterThan(0);
    expect(draft.credential).toBe('');
    expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
    expect(provider.family).toBe('gemini-native');
    expect(provider.apiKeyRef).toBe('gemini');
    expect(provider.model).toBe(draft.model);
    expect(provider.pricePerMTokensInput).toBeGreaterThan(0);
    expect(analyzerBackendFor(provider)).toBe('claude');
  });

  it('carries the chosen gemini model into the provider config', () => {
    const provider = buildGeminiProvider({ ...emptyGeminiDraft(), model: 'gemini-flash-lite-latest' });

    expect(provider.model).toBe('gemini-flash-lite-latest');
    expect(analyzerProviderConfigSchema.parse(provider)).toEqual(provider);
  });

  it('prefers the recommended tier, then the first supported one', () => {
    expect(recommendedTier([tier({ recommended: false }), tier({ tag: 'gemma3:4b', recommended: true })])?.tag).toBe(
      'gemma3:4b',
    );
    expect(recommendedTier([tier({ supportLevel: 'insufficient-ram' }), tier({ tag: 'gemma3:4b' })])?.tag).toBe(
      'gemma3:4b',
    );
    expect(recommendedTier([])).toBeNull();
  });
});
