import type { AnalyzerProviderConfig } from './providers.js';

export const API_USAGE_CHARGE_NOTICE = 'usage will be charged by your API provider';

export interface ApiTokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export interface ApiCostSignal {
  kind: 'estimate' | 'notice';
  message: string;
  estimate: ApiTokenEstimate;
  estimatedCostUsd: number | null;
}

const TOKENS_PER_IMAGE = 765;
const ESTIMATED_OUTPUT_TOKENS = 250;

export const estimateApiTokens = (input: {
  transcriptCharacters: number;
  frameCount: number;
}): ApiTokenEstimate => ({
  inputTokens: Math.ceil(Math.max(0, input.transcriptCharacters) / 4) + Math.max(0, input.frameCount) * TOKENS_PER_IMAGE,
  outputTokens: ESTIMATED_OUTPUT_TOKENS,
});

export const apiCostSignal = (
  provider: Extract<AnalyzerProviderConfig, { family: 'api' }>,
  estimate: ApiTokenEstimate,
): ApiCostSignal => {
  if (provider.pricePerMTokensInput === undefined || provider.pricePerMTokensOutput === undefined) {
    return {
      kind: 'notice',
      message: API_USAGE_CHARGE_NOTICE,
      estimate,
      estimatedCostUsd: null,
    };
  }
  const cost = (
    estimate.inputTokens * provider.pricePerMTokensInput
    + estimate.outputTokens * provider.pricePerMTokensOutput
  ) / 1_000_000;
  return {
    kind: 'estimate',
    message: `~$${cost.toFixed(2)} per video (rough estimate)`,
    estimate,
    estimatedCostUsd: cost,
  };
};
