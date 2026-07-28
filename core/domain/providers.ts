import { z } from 'zod';

import { GEMINI_PRICE_TABLE, geminiModelPrice, type GeminiPricingMode } from './gemini-cost.js';

export const ANALYZER_PROVIDER_FAMILIES = ['api', 'harness', 'local', 'gemini-native'] as const;
export const MAX_IMAGE_DETAILS = ['low', 'high', 'auto'] as const;
export const HARNESS_PROMPT_STYLES = ['file-urls', 'dir-access'] as const;
export const HARNESS_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export const CREDENTIALS_BACKENDS = ['keychain', 'file'] as const;
export const CREDENTIALS_BACKEND_REASONS = ['ok', 'disabled', 'unsupported', 'unavailable', 'degraded'] as const;

export const credentialsBackendStatusSchema = z.object({
  backend: z.enum(CREDENTIALS_BACKENDS),
  reason: z.enum(CREDENTIALS_BACKEND_REASONS),
});

export type CredentialsBackendStatus = z.output<typeof credentialsBackendStatusSchema>;

export const credentialsBackendSchema = z.enum(CREDENTIALS_BACKENDS);

export type CredentialsBackend = z.output<typeof credentialsBackendSchema>;

export const credentialDeletionSchema = z.object({
  cleared: z.array(credentialsBackendSchema),
  retained: z.array(credentialsBackendSchema),
  unreadableEntry: z.string().min(1).optional(),
});

export type CredentialDeletion = z.output<typeof credentialDeletionSchema>;

export const CREDENTIALS_BACKEND_LABELS: Record<(typeof CREDENTIALS_BACKENDS)[number], string> = {
  keychain: 'macOS Keychain',
  file: 'config file (~/.ai-video-cataloger/credentials.json)',
};

export const analyzerProviderFamilySchema = z.enum(ANALYZER_PROVIDER_FAMILIES);
export const maxImageDetailSchema = z.enum(MAX_IMAGE_DETAILS);
export const harnessPromptStyleSchema = z.enum(HARNESS_PROMPT_STYLES);
export const harnessReasoningEffortSchema = z.enum(HARNESS_REASONING_EFFORTS);

const providerIdSchema = z.string().trim().min(1);
const labelSchema = z.string().trim().min(1);
const argsTemplateSchema = z.array(z.string()).min(1).superRefine((args, context) => {
  if (!args.some((argument) => argument.includes('{prompt}'))) {
    context.addIssue({ code: 'custom', message: 'argsTemplate must contain {prompt}' });
  }
  for (const argument of args) {
    const unsupported = argument.match(/\{[^}]+\}/g)?.filter((value) => value !== '{prompt}' && value !== '{videoDir}');
    if (unsupported !== undefined && unsupported.length > 0) {
      context.addIssue({ code: 'custom', message: `Unsupported placeholder: ${unsupported[0]}` });
    }
  }
});

export const apiAnalyzerProviderConfigSchema = z.object({
  family: z.literal('api'),
  providerId: providerIdSchema,
  baseUrl: z.url().default('https://api.openai.com/v1'),
  apiKeyRef: z.string().trim().min(1),
  model: z.string().trim().min(1),
  maxImageDetail: maxImageDetailSchema,
  pricePerMTokensInput: z.number().nonnegative().optional(),
  pricePerMTokensOutput: z.number().nonnegative().optional(),
}).strict();

export const harnessAnalyzerProviderConfigSchema = z.object({
  family: z.literal('harness'),
  providerId: providerIdSchema,
  command: z.string().trim().min(1),
  argsTemplate: argsTemplateSchema,
  promptStyle: harnessPromptStyleSchema,
  model: z.string().trim().min(1).optional(),
  reasoningEffort: harnessReasoningEffortSchema.optional(),
}).strict();

export const localAnalyzerProviderConfigSchema = z.object({
  family: z.literal('local'),
  providerId: providerIdSchema,
  modelTag: z.string().trim().min(1),
}).strict();

export const geminiNativeAnalyzerProviderConfigSchema = z.object({
  family: z.literal('gemini-native'),
  providerId: providerIdSchema,
  apiKeyRef: z.string().trim().min(1),
  model: z.string().trim().min(1),
  pricePerMTokensInput: z.number().nonnegative().optional(),
  pricePerMTokensOutput: z.number().nonnegative().optional(),
}).strict();

export const analyzerProviderConfigSchema = z.discriminatedUnion('family', [
  apiAnalyzerProviderConfigSchema,
  harnessAnalyzerProviderConfigSchema,
  localAnalyzerProviderConfigSchema,
  geminiNativeAnalyzerProviderConfigSchema,
]);

export type AnalyzerProviderConfig = z.output<typeof analyzerProviderConfigSchema>;

export const apiProviderIdForBaseUrl = (baseUrl: string): string | null => {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname.length === 0) return null;
    return hostname === 'api.openai.com' ? 'openai' : hostname;
  } catch {
    return null;
  }
};

export const apiProviderDescriptorSchema = z.object({
  family: z.literal('api'),
  providerId: providerIdSchema,
  label: labelSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1),
  maxImageDetail: maxImageDetailSchema,
  pricePerMTokensInput: z.number().nonnegative().optional(),
  pricePerMTokensOutput: z.number().nonnegative().optional(),
}).strict();

export const harnessProviderDescriptorSchema = z.object({
  family: z.literal('harness'),
  providerId: providerIdSchema,
  label: labelSchema,
  command: z.string().trim().min(1),
  argsTemplate: argsTemplateSchema,
  promptStyle: harnessPromptStyleSchema,
}).strict();

export const localProviderDescriptorSchema = z.object({
  family: z.literal('local'),
  providerId: providerIdSchema,
  label: labelSchema,
  modelTag: z.string().trim().min(1),
}).strict();

export const geminiNativeProviderDescriptorSchema = z.object({
  family: z.literal('gemini-native'),
  providerId: providerIdSchema,
  label: labelSchema,
  model: z.string().trim().min(1),
  pricePerMTokensInput: z.number().nonnegative().optional(),
  pricePerMTokensOutput: z.number().nonnegative().optional(),
}).strict();

export const analyzerProviderDescriptorSchema = z.discriminatedUnion('family', [
  apiProviderDescriptorSchema,
  harnessProviderDescriptorSchema,
  localProviderDescriptorSchema,
  geminiNativeProviderDescriptorSchema,
]);

export type AnalyzerProviderDescriptor = z.output<typeof analyzerProviderDescriptorSchema>;

export const ANALYZER_PROVIDERS: readonly AnalyzerProviderDescriptor[] = analyzerProviderDescriptorSchema.array().parse([
  {
    family: 'api',
    providerId: 'openai',
    label: 'OpenAI-compatible API',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    maxImageDetail: 'auto',
  },
  {
    family: 'harness',
    providerId: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
    promptStyle: 'file-urls',
  },
  {
    family: 'harness',
    providerId: 'codex',
    label: 'Codex',
    command: 'codex',
    argsTemplate: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', '{videoDir}', '{prompt}'],
    promptStyle: 'dir-access',
  },
  {
    family: 'harness',
    providerId: 'cursor-agent',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    argsTemplate: ['--print', '--trust', '--mode', 'ask', '--workspace', '{videoDir}', '{prompt}'],
    promptStyle: 'file-urls',
  },
  {
    family: 'local',
    providerId: 'local',
    label: 'Local Ollama',
    modelTag: 'gemma3:12b',
  },
  {
    family: 'gemini-native',
    providerId: 'gemini',
    label: 'Gemini native video',
    model: 'gemini-3.6-flash',
    pricePerMTokensInput: 1.5,
    pricePerMTokensOutput: 7.5,
  },
]);

export const ANALYZER_PROVIDER_IDS = ['openai', 'claude-code', 'codex', 'cursor-agent', 'local', 'gemini'] as const;
export const analyzerProviderIdSchema = z.enum(ANALYZER_PROVIDER_IDS);
export type AnalyzerProviderId = z.output<typeof analyzerProviderIdSchema>;

export const builtInAnalyzerProvider = (
  providerId: string,
  localModel = 'gemma3:12b',
): AnalyzerProviderConfig | null => {
  const descriptor = ANALYZER_PROVIDERS.find((candidate) => candidate.providerId === providerId);
  if (descriptor === undefined) return null;
  switch (descriptor.family) {
    case 'api':
      return {
        family: 'api',
        providerId: descriptor.providerId,
        baseUrl: descriptor.baseUrl,
        apiKeyRef: descriptor.providerId,
        model: descriptor.model,
        maxImageDetail: descriptor.maxImageDetail,
        ...(descriptor.pricePerMTokensInput === undefined ? {} : { pricePerMTokensInput: descriptor.pricePerMTokensInput }),
        ...(descriptor.pricePerMTokensOutput === undefined ? {} : { pricePerMTokensOutput: descriptor.pricePerMTokensOutput }),
      };
    case 'harness':
      return {
        family: 'harness',
        providerId: descriptor.providerId,
        command: descriptor.command,
        argsTemplate: descriptor.argsTemplate,
        promptStyle: descriptor.promptStyle,
      };
    case 'local':
      return { family: 'local', providerId: descriptor.providerId, modelTag: localModel };
    case 'gemini-native':
      return {
        family: 'gemini-native',
        providerId: descriptor.providerId,
        apiKeyRef: descriptor.providerId,
        model: descriptor.model,
        ...(descriptor.pricePerMTokensInput === undefined ? {} : { pricePerMTokensInput: descriptor.pricePerMTokensInput }),
        ...(descriptor.pricePerMTokensOutput === undefined ? {} : { pricePerMTokensOutput: descriptor.pricePerMTokensOutput }),
      };
  }
};

export const legacyAnalyzerProvider = (
  backend: 'claude' | 'local',
  localModel = 'gemma3:12b',
): AnalyzerProviderConfig => backend === 'local'
  ? { family: 'local', providerId: 'local', modelTag: localModel }
  : {
      family: 'harness',
      providerId: 'claude-code',
      command: 'claude',
      argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
      promptStyle: 'file-urls',
    };

export const builtInHarnessProviders = (): Extract<AnalyzerProviderDescriptor, { family: 'harness' }>[] =>
  ANALYZER_PROVIDERS.filter((provider): provider is Extract<AnalyzerProviderDescriptor, { family: 'harness' }> =>
    provider.family === 'harness');

export const HARNESS_MODEL_OPTIONS: Record<string, readonly string[]> = {
  'claude-code': ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5'],
  codex: ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol'],
  'cursor-agent': [],
};

export const curatedHarnessModels = (providerId: string): readonly string[] =>
  HARNESS_MODEL_OPTIONS[providerId] ?? [];

// Valid = curated for this provider, or a genuine custom id (the escape hatch); an id
// claimed by a different provider's curated set is a cross-provider leak and rejected.
export const isModelValidForHarness = (providerId: string, model: string): boolean => {
  const curated = HARNESS_MODEL_OPTIONS[providerId];
  if (curated !== undefined && curated.includes(model)) return true;
  return !Object.entries(HARNESS_MODEL_OPTIONS)
    .some(([id, models]) => id !== providerId && models.includes(model));
};

export const GEMINI_NATIVE_API_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_NATIVE_INLINE_LIMIT_BYTES = 20 * 1024 * 1024;
export const GEMINI_NATIVE_FILES_API_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const GEMINI_NATIVE_FILE_TTL_HOURS = 48;

export const GEMINI_NATIVE_MODELS = [
  ...GEMINI_PRICE_TABLE.map((entry) => ({ id: entry.model, label: entry.label })),
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
];

export const geminiNativeModelIds = (): readonly string[] => GEMINI_NATIVE_MODELS.map((model) => model.id);

export const GEMINI_BATCH_PRICE_MULTIPLIER = 0.5;

export const geminiPricingModeMultiplier = (mode: GeminiPricingMode): number =>
  mode === 'batch' ? GEMINI_BATCH_PRICE_MULTIPLIER : 1;

export const geminiNativeModelPricing = (
  modelId: string,
  mode: GeminiPricingMode = 'interactive',
  promptTokens = 0,
): { pricePerMTokensInput: number; pricePerMTokensOutput: number } | null => {
  const pricing = geminiModelPrice(modelId, promptTokens, mode);
  if (pricing === null) return null;
  return {
    pricePerMTokensInput: pricing.inputPerMillionUsd,
    pricePerMTokensOutput: pricing.outputPerMillionUsd,
  };
};

export const defaultGeminiNativeProvider = (
  modelId: string = GEMINI_NATIVE_MODELS[0]?.id ?? 'gemini-3.6-flash',
): Extract<AnalyzerProviderConfig, { family: 'gemini-native' }> => {
  const pricing = geminiNativeModelPricing(modelId);
  return {
    family: 'gemini-native',
    providerId: 'gemini',
    apiKeyRef: 'gemini',
    model: modelId,
    ...(pricing === null ? {} : pricing),
  };
};
