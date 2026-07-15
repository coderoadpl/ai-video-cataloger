import { describe, expect, it } from 'vitest';

import { API_USAGE_CHARGE_NOTICE, apiCostSignal, estimateApiTokens } from './api-cost.js';

describe('API cost signaling', () => {
  it('estimates transcript and image input tokens plus a rough output allowance', () => {
    expect(estimateApiTokens({ transcriptCharacters: 401, frameCount: 3 })).toEqual({
      inputTokens: 2396,
      outputTokens: 250,
    });
  });

  it('shows the mandatory provider charge notice when either price is unset', () => {
    const signal = apiCostSignal({
      family: 'api',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyRef: 'openai',
      model: 'vision-model',
      maxImageDetail: 'auto',
    }, estimateApiTokens({ transcriptCharacters: 0, frameCount: 3 }));

    expect(signal).toMatchObject({ kind: 'notice', message: API_USAGE_CHARGE_NOTICE, estimatedCostUsd: null });
  });

  it('labels calculated prices as rough per-video estimates', () => {
    const signal = apiCostSignal({
      family: 'api',
      providerId: 'compatible',
      baseUrl: 'https://provider.example/v1',
      apiKeyRef: 'compatible',
      model: 'vision-model',
      maxImageDetail: 'high',
      pricePerMTokensInput: 10,
      pricePerMTokensOutput: 30,
    }, { inputTokens: 2500, outputTokens: 500 });

    expect(signal.kind).toBe('estimate');
    expect(signal.message).toBe('~$0.04 per video (rough estimate)');
    expect(signal.estimatedCostUsd).toBeCloseTo(0.04);
  });
});
