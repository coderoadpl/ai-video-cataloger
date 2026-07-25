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

export interface GeminiUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
}

export interface GeminiUsageAccounting {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  billedOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

// Gemini bills "thoughts" (thinking) tokens as output, so billed output is
// candidates + thoughts, not candidates alone.
export const geminiUsageAccounting = (
  usage: GeminiUsage,
  pricing: { pricePerMTokensInput?: number | undefined; pricePerMTokensOutput?: number | undefined },
): GeminiUsageAccounting => {
  const promptTokens = Math.max(0, usage.promptTokens);
  const candidatesTokens = Math.max(0, usage.candidatesTokens);
  const thoughtsTokens = Math.max(0, usage.thoughtsTokens);
  const billedOutputTokens = candidatesTokens + thoughtsTokens;
  const hasPricing = pricing.pricePerMTokensInput !== undefined && pricing.pricePerMTokensOutput !== undefined;
  const estimatedCostUsd = hasPricing
    ? (promptTokens * (pricing.pricePerMTokensInput ?? 0) + billedOutputTokens * (pricing.pricePerMTokensOutput ?? 0)) / 1_000_000
    : null;
  return {
    promptTokens,
    candidatesTokens,
    thoughtsTokens,
    billedOutputTokens,
    totalTokens: promptTokens + billedOutputTokens,
    estimatedCostUsd,
  };
};
