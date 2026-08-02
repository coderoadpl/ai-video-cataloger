import { z } from 'zod';

import { canonicalJson, requiredAnalyzerFields } from './config-descriptor.js';
import { sha256Hex } from './sha256.js';

import { configSchema, outputLanguageSchema, type ConfigInput } from './config.js';
import {
  harnessPromptStyleSchema,
  harnessReasoningEffortSchema,
  maxImageDetailSchema,
} from './providers.js';

export const PHOTO_LIBRA_IMPORT_PROVIDER_ID = 'photo-libra';
export const PHOTO_LIBRA_IMPORT_PROMPT_VERSION = 1;

export const photoConfigDescriptorShape = z.object({
  kind: z.literal('photo'),
  family: z.enum(['api', 'harness', 'local', 'gemini-native', 'imported']),
  providerId: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  modelTag: z.string().trim().min(1).optional(),
  maxImageDetail: maxImageDetailSchema.optional(),
  promptStyle: harnessPromptStyleSchema.optional(),
  reasoningEffort: harnessReasoningEffortSchema.optional(),
  output_language: outputLanguageSchema,
  tag_language: outputLanguageSchema.optional(),
  photoPromptVersion: z.number().int().min(1),
}).strict();

const analyzerFieldNames = ['model', 'modelTag', 'maxImageDetail', 'promptStyle', 'reasoningEffort'] as const;
type AnalyzerFieldName = (typeof analyzerFieldNames)[number];

// 'imported' is not an analyzer family — it has no live prompt/model to describe, so it
// requires none of the analyzer fields (this is the descriptor's identity discipline: it
// cannot be built with analyzer fields set, so it can never be mistaken for a live variant).
const requiredPhotoAnalyzerFields = (
  family: PhotoConfigDescriptor['family'],
): readonly AnalyzerFieldName[] => (family === 'imported' ? [] : requiredAnalyzerFields(family));

export const photoConfigDescriptorSchema = photoConfigDescriptorShape.superRefine((descriptor, context) => {
  const analyzerFields: readonly AnalyzerFieldName[] = requiredPhotoAnalyzerFields(descriptor.family);
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
  if (descriptor.family === 'imported' && descriptor.providerId !== PHOTO_LIBRA_IMPORT_PROVIDER_ID) {
    context.addIssue({
      code: 'custom',
      path: ['providerId'],
      message: `providerId must be '${PHOTO_LIBRA_IMPORT_PROVIDER_ID}' for the imported family`,
    });
  }
});

export type PhotoConfigDescriptor = z.output<typeof photoConfigDescriptorSchema>;

export const buildPhotoConfigDescriptor = (
  input: ConfigInput,
  photoPromptVersion: number,
): PhotoConfigDescriptor => {
  const config = configSchema.parse(input);
  const common = {
    kind: 'photo' as const,
    output_language: config.output_language,
    ...(config.output_language === 'auto' && config.tag_language === 'auto' ? {} : { tag_language: config.tag_language }),
    photoPromptVersion,
  };
  const provider = config.analyzer_provider;
  switch (provider.family) {
    case 'api':
      return photoConfigDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        model: provider.model,
        maxImageDetail: provider.maxImageDetail,
        ...common,
      });
    case 'harness':
      return photoConfigDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        promptStyle: provider.promptStyle,
        ...(provider.model === undefined ? {} : { model: provider.model }),
        ...(provider.reasoningEffort === undefined ? {} : { reasoningEffort: provider.reasoningEffort }),
        ...common,
      });
    case 'local':
      return photoConfigDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        modelTag: provider.modelTag,
        ...common,
      });
    case 'gemini-native':
      return photoConfigDescriptorSchema.parse({
        family: provider.family,
        providerId: provider.providerId,
        model: provider.model,
        ...common,
      });
  }
};

export const buildImportedPhotoConfigDescriptor = (): PhotoConfigDescriptor =>
  photoConfigDescriptorSchema.parse({
    kind: 'photo',
    family: 'imported',
    providerId: PHOTO_LIBRA_IMPORT_PROVIDER_ID,
    // The imported corpus (PHOTO LIBRA's descPl field) is Polish text, so the descriptor
    // states that honestly rather than 'auto' — 'auto' would claim a live analyzer chose it.
    output_language: 'pl',
    photoPromptVersion: PHOTO_LIBRA_IMPORT_PROMPT_VERSION,
  });

export const photoConfigId = (descriptor: PhotoConfigDescriptor): string => {
  const parsed = photoConfigDescriptorSchema.parse(descriptor);
  const digest = sha256Hex(canonicalJson(parsed));
  return `cfg_${digest.slice(0, 12)}`;
};
