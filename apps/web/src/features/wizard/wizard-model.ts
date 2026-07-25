import type { z } from 'zod';

import {
  apiProviderIdForBaseUrl,
  builtInHarnessProviders,
  defaultGeminiNativeProvider,
  geminiNativeModelIds,
  type AnalyzerProviderConfig,
  type WhisperModelName,
} from '@core/domain/index.js';
import type { localAiTierSchema, machineSchema } from '@core/contract/index.js';

import { type Dictionary } from '../../i18n/dictionary.js';

export type LocalAiTier = z.output<typeof localAiTierSchema>;
export type Machine = z.output<typeof machineSchema>;
export type HarnessDescriptor = ReturnType<typeof builtInHarnessProviders>[number];
export type ApiProviderConfig = Extract<AnalyzerProviderConfig, { family: 'api' }>;
export type GeminiNativeProviderConfig = Extract<AnalyzerProviderConfig, { family: 'gemini-native' }>;

export type WizardStep =
  | 'welcome'
  | 'language'
  | 'analyzer'
  | 'transcription'
  | 'downloads'
  | 'readiness'
  | 'done';

export const WIZARD_STEPS: readonly WizardStep[] = [
  'welcome',
  'language',
  'analyzer',
  'transcription',
  'downloads',
  'readiness',
  'done',
];

export const wizardStepLabels = (dictionary: Dictionary): Record<WizardStep, string> => dictionary.wizard.stepLabels;

export const WIZARD_UI_LANGUAGE_OPTIONS = ['en', 'pl'] as const;
export const WIZARD_OUTPUT_LANGUAGE_OPTIONS = ['auto', 'en', 'pl'] as const;

export const wizardNextLabel = (
  dictionary: Dictionary,
  step: WizardStep,
  hasPlannedDownloads: boolean,
): string => {
  if (step === 'downloads') {
    return hasPlannedDownloads ? dictionary.wizard.nextLabels.installAndContinue : dictionary.wizard.nextLabels.continue;
  }
  if (step === 'welcome') return dictionary.wizard.nextLabels.getStarted;
  if (step === 'done') return dictionary.wizard.nextLabels.finish;
  return dictionary.wizard.nextLabels.continue;
};

export type AnalyzerFamily = 'local' | 'api' | 'harness' | 'gemini-native';
export type TranscriptionMode = 'managed' | 'own' | 'api' | 'skip';

export interface GeminiDraft {
  model: string;
  credential: string;
}

export const emptyGeminiDraft = (): GeminiDraft => ({
  model: geminiNativeModelIds()[0] ?? '',
  credential: '',
});

export const buildGeminiProvider = (draft: GeminiDraft): GeminiNativeProviderConfig =>
  defaultGeminiNativeProvider(draft.model);

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

export interface WhisperModelChoice {
  name: WhisperModelName;
  size: string;
  downloaded: boolean;
}

const WHISPER_QUALITY_ORDER: readonly WhisperModelName[] = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3-turbo',
  'large-v3',
];

export const bestInstalledWhisperModel = (
  models: readonly WhisperModelChoice[],
): WhisperModelName | null => {
  const installed = new Set(models.filter((model) => model.downloaded).map((model) => model.name));
  for (let index = WHISPER_QUALITY_ORDER.length - 1; index >= 0; index -= 1) {
    const candidate = WHISPER_QUALITY_ORDER[index];
    if (candidate !== undefined && installed.has(candidate)) return candidate;
  }
  return null;
};

export const recommendedTier = (tiers: readonly LocalAiTier[]): LocalAiTier | null =>
  tiers.find((tier) => tier.recommended) ?? tiers.find((tier) => tier.supportLevel === 'ok') ?? null;

export const buildLocalProvider = (modelTag: string): AnalyzerProviderConfig => ({
  family: 'local',
  providerId: 'local',
  modelTag,
});

const HARNESS_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

const asReasoningEffort = (effort: string): (typeof HARNESS_EFFORTS)[number] | undefined =>
  HARNESS_EFFORTS.find((option) => option === effort.trim());

export const buildHarnessProvider = (
  descriptor: HarnessDescriptor,
  model = '',
  effort = '',
): AnalyzerProviderConfig => {
  const reasoningEffort = asReasoningEffort(effort);
  return {
    family: 'harness',
    providerId: descriptor.providerId,
    command: descriptor.command,
    argsTemplate: [...descriptor.argsTemplate],
    promptStyle: descriptor.promptStyle,
    ...(model.trim().length === 0 ? {} : { model: model.trim() }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
};

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
