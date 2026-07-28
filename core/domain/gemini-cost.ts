import { z } from 'zod';

const geminiPricingModeSchema = z.enum(['interactive', 'batch']);
export type GeminiPricingMode = z.output<typeof geminiPricingModeSchema>;

const geminiPriceTierSchema = z.object({
  maximumPromptTokens: z.number().int().positive().nullable(),
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
});

const geminiPriceTableEntrySchema = z.object({
  model: z.string().min(1),
  label: z.string().min(1),
  tiers: z.array(geminiPriceTierSchema).min(1),
});

export const GEMINI_PRICE_TABLE = geminiPriceTableEntrySchema.array().parse([
  {
    model: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    tiers: [{ maximumPromptTokens: null, inputPerMillionUsd: 1.5, outputPerMillionUsd: 7.5 }],
  },
  {
    model: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    tiers: [
      { maximumPromptTokens: 200_000, inputPerMillionUsd: 2, outputPerMillionUsd: 12 },
      { maximumPromptTokens: null, inputPerMillionUsd: 4, outputPerMillionUsd: 18 },
    ],
  },
]);

interface GeminiUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
}

export interface GeminiUsageAccounting extends GeminiUsage {
  billedOutputTokens: number;
  totalTokens: number;
  model: string;
  pricingMode: GeminiPricingMode;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  estimatedCostUsd: number | null;
}

export const geminiCostEstimateSchema = z.object({
  kind: z.literal('estimate'),
  provider: z.literal('gemini'),
  model: z.string().min(1),
  pricingMode: geminiPricingModeSchema,
  promptTokens: z.number().int().nonnegative(),
  candidatesTokens: z.number().int().nonnegative(),
  thoughtsTokens: z.number().int().nonnegative(),
  billedOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

export type GeminiCostEstimate = z.output<typeof geminiCostEstimateSchema>;

export const spendLedgerEntrySchema = geminiCostEstimateSchema.extend({
  schemaVersion: z.literal(1),
  recordedAt: z.iso.datetime(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  providerId: z.string().min(1),
  videoPath: z.string().min(1),
  runId: z.string().min(1).nullable(),
});

export type SpendLedgerEntry = z.output<typeof spendLedgerEntrySchema>;

export const geminiModelPrice = (
  model: string,
  promptTokens: number,
  pricingMode: GeminiPricingMode = 'interactive',
): { inputPerMillionUsd: number; outputPerMillionUsd: number } | null => {
  const entry = GEMINI_PRICE_TABLE.find((candidate) => candidate.model === model);
  if (entry === undefined) return null;
  const tier = entry.tiers.find((candidate) =>
    candidate.maximumPromptTokens === null || promptTokens <= candidate.maximumPromptTokens);
  if (tier === undefined) return null;
  const multiplier = pricingMode === 'batch' ? 0.5 : 1;
  return {
    inputPerMillionUsd: tier.inputPerMillionUsd * multiplier,
    outputPerMillionUsd: tier.outputPerMillionUsd * multiplier,
  };
};

export const geminiUsageAccounting = (
  usage: GeminiUsage,
  model: string,
  pricingMode: GeminiPricingMode = 'interactive',
): GeminiUsageAccounting => {
  const promptTokens = Math.max(0, usage.promptTokens);
  const candidatesTokens = Math.max(0, usage.candidatesTokens);
  const thoughtsTokens = Math.max(0, usage.thoughtsTokens);
  const billedOutputTokens = candidatesTokens + thoughtsTokens;
  const pricing = geminiModelPrice(model, promptTokens, pricingMode);
  return {
    promptTokens,
    candidatesTokens,
    thoughtsTokens,
    billedOutputTokens,
    totalTokens: promptTokens + billedOutputTokens,
    model,
    pricingMode,
    inputPerMillionUsd: pricing?.inputPerMillionUsd ?? null,
    outputPerMillionUsd: pricing?.outputPerMillionUsd ?? null,
    estimatedCostUsd: pricing === null
      ? null
      : (promptTokens * pricing.inputPerMillionUsd + billedOutputTokens * pricing.outputPerMillionUsd) / 1_000_000,
  };
};

export const geminiCostEstimateFromUsage = (usage: GeminiUsageAccounting): GeminiCostEstimate | null => {
  if (
    usage.inputPerMillionUsd === null
    || usage.outputPerMillionUsd === null
    || usage.estimatedCostUsd === null
  ) return null;
  const estimate = geminiCostEstimateSchema.safeParse({
    kind: 'estimate',
    provider: 'gemini',
    model: usage.model,
    pricingMode: usage.pricingMode,
    promptTokens: usage.promptTokens,
    candidatesTokens: usage.candidatesTokens,
    thoughtsTokens: usage.thoughtsTokens,
    billedOutputTokens: usage.billedOutputTokens,
    totalTokens: usage.totalTokens,
    inputPerMillionUsd: usage.inputPerMillionUsd,
    outputPerMillionUsd: usage.outputPerMillionUsd,
    estimatedCostUsd: usage.estimatedCostUsd,
  });
  return estimate.success ? estimate.data : null;
};

export const spendMonth = (date: Date): string => date.toISOString().slice(0, 7);
