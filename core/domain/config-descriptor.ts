import { z } from 'zod';

import { sha256Hex } from './sha256.js';

import {
  configSchema,
  outputLanguageSchema,
  whisperLanguageSchema,
  type AppConfig,
  type ConfigInput,
  type ConfigKey,
} from './config.js';
import { whisperModelNameSchema } from './models.js';
import {
  harnessPromptStyleSchema,
  harnessReasoningEffortSchema,
  maxImageDetailSchema,
} from './providers.js';

export const LEGACY_CONFIG_ID = 'legacy';

export const CONFIG_IDENTITY_CLASSIFICATION = {
  whisper_binary_path: 'excluded',
  whisper_model: 'identity',
  whisper_language: 'identity',
  whisper_mode: 'identity',
  whisper_api_base_url: 'identity',
  whisper_api_model: 'identity',
  frames: 'identity',
  timeout: 'excluded',
  skip_rename: 'excluded',
  analyzer_backend: 'identity',
  local_model: 'identity',
  analyzer_provider: 'identity',
  faces_enabled: 'excluded',
  gemini_batch_mode: 'excluded',
  gemini_monthly_budget_usd: 'excluded',
  output_language: 'identity',
  ui_language: 'excluded',
} satisfies Record<ConfigKey, 'identity' | 'excluded'>;

const configDescriptorShape = z.object({
  family: z.enum(['api', 'harness', 'local', 'gemini-native']),
  providerId: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  modelTag: z.string().trim().min(1).optional(),
  maxImageDetail: maxImageDetailSchema.optional(),
  promptStyle: harnessPromptStyleSchema.optional(),
  reasoningEffort: harnessReasoningEffortSchema.optional(),
  whisper_mode: z.enum(['local', 'api', 'skip']).optional(),
  whisper_model: whisperModelNameSchema.optional(),
  whisper_language: whisperLanguageSchema.optional(),
  whisper_api_base_url: z.url().optional(),
  whisper_api_model: z.string().trim().min(1).optional(),
  frames: z.number().int().min(1).max(10).optional(),
  output_language: outputLanguageSchema,
  promptVersion: z.number().int().min(1),
}).strict();

const analyzerFieldNames = ['model', 'modelTag', 'maxImageDetail', 'promptStyle', 'reasoningEffort'] as const;
type AnalyzerFieldName = (typeof analyzerFieldNames)[number];

const requiredAnalyzerFields = (
  family: ConfigDescriptor['family'],
): readonly AnalyzerFieldName[] => {
  switch (family) {
    case 'api':
      return ['model', 'maxImageDetail'];
    case 'harness':
      return ['promptStyle'];
    case 'local':
      return ['modelTag'];
    case 'gemini-native':
      return ['model'];
  }
};

export const configDescriptorSchema = configDescriptorShape.superRefine((descriptor, context) => {
  const analyzerFields = requiredAnalyzerFields(descriptor.family);
  const analyzerOptionalFields: readonly AnalyzerFieldName[] = descriptor.family === 'harness'
    ? ['model', 'reasoningEffort']
    : [];
  for (const field of analyzerFieldNames) {
    const expected = analyzerFields.includes(field) || analyzerOptionalFields.includes(field);
    if (expected && analyzerFields.includes(field) && descriptor[field] === undefined) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} is required for ${descriptor.family}` });
    }
    if (!expected && descriptor[field] !== undefined) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} is not valid for ${descriptor.family}` });
    }
  }

  if (descriptor.family === 'gemini-native') {
    for (const field of ['whisper_mode', 'whisper_model', 'whisper_language', 'whisper_api_base_url', 'whisper_api_model', 'frames'] as const) {
      if (descriptor[field] !== undefined) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} is not valid for gemini-native` });
      }
    }
    return;
  }

  if (descriptor.whisper_mode === undefined) {
    context.addIssue({ code: 'custom', path: ['whisper_mode'], message: 'whisper_mode is required' });
  }
  if (descriptor.frames === undefined) {
    context.addIssue({ code: 'custom', path: ['frames'], message: 'frames is required' });
  }
  // Descriptors persisted before whisper_language existed must keep parsing (their
  // configId is history); the builder materializes the default for every new one.
  if (descriptor.whisper_mode === 'local') {
    if (descriptor.whisper_model === undefined) {
      context.addIssue({ code: 'custom', path: ['whisper_model'], message: 'whisper_model is required for local' });
    }
    if (descriptor.whisper_api_base_url !== undefined || descriptor.whisper_api_model !== undefined) {
      context.addIssue({ code: 'custom', path: ['whisper_mode'], message: 'API transcription fields are not valid for local' });
    }
  }
  if (descriptor.whisper_mode === 'api') {
    if (descriptor.whisper_api_base_url === undefined) {
      context.addIssue({ code: 'custom', path: ['whisper_api_base_url'], message: 'whisper_api_base_url is required for api' });
    }
    if (descriptor.whisper_api_model === undefined) {
      context.addIssue({ code: 'custom', path: ['whisper_api_model'], message: 'whisper_api_model is required for api' });
    }
    if (descriptor.whisper_model !== undefined) {
      context.addIssue({ code: 'custom', path: ['whisper_model'], message: 'whisper_model is not valid for api' });
    }
  }
  if (descriptor.whisper_mode === 'skip' && (
    descriptor.whisper_model !== undefined
    || descriptor.whisper_language !== undefined
    || descriptor.whisper_api_base_url !== undefined
    || descriptor.whisper_api_model !== undefined
  )) {
    context.addIssue({ code: 'custom', path: ['whisper_mode'], message: 'Transcription fields are not valid for skip' });
  }
});

export type ConfigDescriptor = z.output<typeof configDescriptorSchema>;

const transcriptionIdentity = (config: AppConfig) => {
  switch (config.whisper_mode) {
    case 'local':
      return {
        whisper_mode: config.whisper_mode,
        whisper_model: config.whisper_model,
        whisper_language: config.whisper_language,
      };
    case 'api':
      return {
        whisper_mode: config.whisper_mode,
        whisper_language: config.whisper_language,
        whisper_api_base_url: config.whisper_api_base_url,
        whisper_api_model: config.whisper_api_model,
      };
    case 'skip':
      return { whisper_mode: config.whisper_mode };
  }
};

export const buildConfigDescriptor = (input: ConfigInput, promptVersion: number): ConfigDescriptor => {
  const config = configSchema.parse(input);
  const common = { output_language: config.output_language, promptVersion };
  const provider = config.analyzer_provider;
  switch (provider.family) {
    case 'api':
      return configDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        model: provider.model,
        maxImageDetail: provider.maxImageDetail,
        ...transcriptionIdentity(config),
        frames: config.frames,
        ...common,
      });
    case 'harness':
      return configDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        promptStyle: provider.promptStyle,
        ...(provider.model === undefined ? {} : { model: provider.model }),
        ...(provider.reasoningEffort === undefined ? {} : { reasoningEffort: provider.reasoningEffort }),
        ...transcriptionIdentity(config),
        frames: config.frames,
        ...common,
      });
    case 'local':
      return configDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        modelTag: provider.modelTag,
        ...transcriptionIdentity(config),
        frames: config.frames,
        ...common,
      });
    case 'gemini-native':
      return configDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        model: provider.model,
        ...common,
      });
  }
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  throw new TypeError('Config descriptors must contain only JSON values');
};

export const configId = (descriptor: ConfigDescriptor): string => {
  const parsed = configDescriptorSchema.parse(descriptor);
  const digest = sha256Hex(canonicalJson(parsed));
  return `cfg_${digest.slice(0, 12)}`;
};
