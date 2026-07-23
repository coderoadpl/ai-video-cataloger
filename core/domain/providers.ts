import { z } from 'zod';

export const ANALYZER_PROVIDER_FAMILIES = ['api', 'harness', 'local'] as const;
export const MAX_IMAGE_DETAILS = ['low', 'high', 'auto'] as const;
export const HARNESS_PROMPT_STYLES = ['file-urls', 'dir-access'] as const;
export const HARNESS_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export const analyzerProviderFamilySchema = z.enum(ANALYZER_PROVIDER_FAMILIES);
export const maxImageDetailSchema = z.enum(MAX_IMAGE_DETAILS);
export const harnessPromptStyleSchema = z.enum(HARNESS_PROMPT_STYLES);
export const harnessReasoningEffortSchema = z.enum(HARNESS_REASONING_EFFORTS);

const providerIdSchema = z.string().trim().min(1);
const labelSchema = z.string().trim().min(1);
const argsTemplateSchema = z.array(z.string()).min(1).superRefine((args, context) => {
  if (!args.some((argument) => argument.includes('{prompt}'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'argsTemplate must contain {prompt}' });
  }
  for (const argument of args) {
    const unsupported = argument.match(/\{[^}]+\}/g)?.filter((value) => value !== '{prompt}' && value !== '{videoDir}');
    if (unsupported !== undefined && unsupported.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Unsupported placeholder: ${unsupported[0]}` });
    }
  }
});

export const apiAnalyzerProviderConfigSchema = z.object({
  family: z.literal('api'),
  providerId: providerIdSchema,
  baseUrl: z.string().url().default('https://api.openai.com/v1'),
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

export const analyzerProviderConfigSchema = z.discriminatedUnion('family', [
  apiAnalyzerProviderConfigSchema,
  harnessAnalyzerProviderConfigSchema,
  localAnalyzerProviderConfigSchema,
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
  baseUrl: z.string().url(),
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

export const analyzerProviderDescriptorSchema = z.discriminatedUnion('family', [
  apiProviderDescriptorSchema,
  harnessProviderDescriptorSchema,
  localProviderDescriptorSchema,
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
]);

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
