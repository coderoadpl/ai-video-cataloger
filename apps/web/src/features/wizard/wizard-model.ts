import type { z } from 'zod';

import {
  apiProviderIdForBaseUrl,
  builtInHarnessProviders,
  type AnalyzerProviderConfig,
} from '@core/domain/index.js';
import type { localAiTierSchema, machineSchema } from '@core/contract/index.js';

export type LocalAiTier = z.output<typeof localAiTierSchema>;
export type Machine = z.output<typeof machineSchema>;
export type HarnessDescriptor = ReturnType<typeof builtInHarnessProviders>[number];
export type ApiProviderConfig = Extract<AnalyzerProviderConfig, { family: 'api' }>;

export type WizardStep = 'welcome' | 'analyzer' | 'transcription' | 'downloads' | 'readiness' | 'done';

export const WIZARD_STEPS: readonly WizardStep[] = [
  'welcome',
  'analyzer',
  'transcription',
  'downloads',
  'readiness',
  'done',
];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  welcome: 'Welcome',
  analyzer: 'Analyzer',
  transcription: 'Transcription',
  downloads: 'Downloads',
  readiness: 'Readiness',
  done: 'Done',
};

export type AnalyzerFamily = 'local' | 'api' | 'harness';
export type TranscriptionMode = 'managed' | 'own' | 'api' | 'skip';

export interface ApiDraft {
  baseUrl: string;
  model: string;
  credential: string;
  pricePerMTokensInput: string;
  pricePerMTokensOutput: string;
}

export const emptyApiDraft = (): ApiDraft => ({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  credential: '',
  pricePerMTokensInput: '',
  pricePerMTokensOutput: '',
});

export const harnessDescriptors = (): readonly HarnessDescriptor[] => builtInHarnessProviders();

export const recommendedTier = (tiers: readonly LocalAiTier[]): LocalAiTier | null =>
  tiers.find((tier) => tier.recommended) ?? tiers.find((tier) => tier.supportLevel === 'ok') ?? null;

export const buildLocalProvider = (modelTag: string): AnalyzerProviderConfig => ({
  family: 'local',
  providerId: 'local',
  modelTag,
});

export const buildHarnessProvider = (descriptor: HarnessDescriptor, model = ''): AnalyzerProviderConfig => ({
  family: 'harness',
  providerId: descriptor.providerId,
  command: descriptor.command,
  argsTemplate: [...descriptor.argsTemplate],
  promptStyle: descriptor.promptStyle,
  ...(model.trim().length === 0 ? {} : { model: model.trim() }),
});

const optionalPrice = (value: string): number | undefined => {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const buildApiProvider = (draft: ApiDraft): ApiProviderConfig => {
  const priceInput = optionalPrice(draft.pricePerMTokensInput);
  const priceOutput = optionalPrice(draft.pricePerMTokensOutput);
  const baseUrl = draft.baseUrl.trim();
  const providerId = apiProviderIdForBaseUrl(baseUrl) ?? 'openai';
  return {
    family: 'api',
    providerId,
    baseUrl,
    apiKeyRef: providerId,
    model: draft.model.trim(),
    maxImageDetail: 'auto',
    ...(priceInput === undefined ? {} : { pricePerMTokensInput: priceInput }),
    ...(priceOutput === undefined ? {} : { pricePerMTokensOutput: priceOutput }),
  };
};

export const analyzerBackendFor = (provider: AnalyzerProviderConfig): 'claude' | 'local' =>
  provider.family === 'local' ? 'local' : 'claude';
