import type { z } from 'zod';

import type { scanVideoSchema, variantsListOutputSchema } from '@core/contract/index.js';

export type VariantsData = z.output<typeof variantsListOutputSchema>;
export type VariantData = VariantsData['variants'][number];
export type DetailsVideoData = z.output<typeof scanVideoSchema>;

export type VariantLabelCopy =
  | { readonly key: 'legacySettingsUnknown' }
  | { readonly key: 'nativeTranscription'; readonly providerId: string; readonly model: string | null }
  | { readonly key: 'localTranscription'; readonly model: string | null }
  | { readonly key: 'apiTranscription'; readonly model: string | null }
  | { readonly key: 'transcriptionSkipped' };

export interface VariantLabelModel {
  readonly analyzer: string | null;
  readonly transcription: VariantLabelCopy;
  readonly frames: number | null;
}

export interface AnalysisPlan {
  readonly key: 'newVariant' | 'existingVariant';
  readonly configId: string;
  readonly label: VariantLabelModel;
}

export interface VariantPreview {
  readonly video: DetailsVideoData;
  readonly tags: readonly string[];
}

const analyzerLabel = (variant: Pick<VariantData, 'analyzer' | 'descriptor' | 'model'>): string | null => {
  if (variant.descriptor === null) {
    return [variant.analyzer, variant.model].filter((value): value is string => value !== null).join(' / ') || null;
  }
  const model = variant.descriptor.model ?? variant.descriptor.modelTag;
  return model === undefined ? variant.descriptor.providerId : `${variant.descriptor.providerId} ${model}`;
};

export const variantLabelModel = (
  variant: Pick<VariantData, 'analyzer' | 'configId' | 'descriptor' | 'model'>,
): VariantLabelModel => {
  const descriptor = variant.descriptor;
  if (variant.configId === 'legacy' || descriptor === null) {
    return { analyzer: analyzerLabel(variant), transcription: { key: 'legacySettingsUnknown' }, frames: null };
  }
  if (descriptor.family === 'gemini-native') {
    return {
      analyzer: analyzerLabel(variant),
      transcription: {
        key: 'nativeTranscription',
        providerId: descriptor.providerId,
        model: descriptor.model ?? null,
      },
      frames: null,
    };
  }
  switch (descriptor.whisper_mode) {
    case 'local':
      return {
        analyzer: analyzerLabel(variant),
        transcription: { key: 'localTranscription', model: descriptor.whisper_model ?? null },
        frames: descriptor.frames ?? null,
      };
    case 'api':
      return {
        analyzer: analyzerLabel(variant),
        transcription: { key: 'apiTranscription', model: descriptor.whisper_api_model ?? null },
        frames: descriptor.frames ?? null,
      };
    case 'skip':
      return {
        analyzer: analyzerLabel(variant),
        transcription: { key: 'transcriptionSkipped' },
        frames: descriptor.frames ?? null,
      };
    case undefined:
      return {
        analyzer: analyzerLabel(variant),
        transcription: { key: 'transcriptionSkipped' },
        frames: descriptor.frames ?? null,
      };
  }
};

export const analysisPlan = (data: VariantsData): AnalysisPlan => {
  const current = data.currentConfig;
  const existing = data.variants.find((variant) => variant.configId === current.configId);
  const label = variantLabelModel({
    configId: current.configId,
    descriptor: current.descriptor,
    analyzer: current.descriptor.providerId,
    model: current.descriptor.model ?? current.descriptor.modelTag ?? null,
  });
  return {
    key: existing === undefined ? 'newVariant' : 'existingVariant',
    configId: current.configId,
    label,
  };
};

export const resolvedPreviewVariant = (
  data: VariantsData,
  previewConfigId: string | null,
): VariantData | null => data.variants.find((variant) => variant.configId === previewConfigId)
  ?? data.variants.find((variant) => variant.selected)
  ?? data.variants[0]
  ?? null;

const framePaths = (variant: VariantData, selectedVideo: DetailsVideoData): string[] | null => {
  if (variant.selected) return selectedVideo.artifacts.framePaths;
  const count = variant.descriptor?.frames;
  const directory = variant.artifacts.framesDirectory;
  if (count === undefined || directory === null) return null;
  const base = directory.replace(/[\\/]+$/, '');
  return Array.from(
    { length: count },
    (_, index) => `${base}/frame-${String(index + 1).padStart(3, '0')}.jpg`,
  );
};

export const variantPreview = (
  selectedVideo: DetailsVideoData,
  variant: VariantData,
): VariantPreview => {
  const selectedSummary = variant.selected ? selectedVideo.artifacts.summary : null;
  const summary = variant.description === null ? null : {
    schemaVersion: 1 as const,
    description: variant.description,
    suggestedFilename: selectedSummary?.suggestedFilename ?? variant.finalName ?? '',
    fullAnalysis: selectedSummary?.fullAnalysis ?? '',
    tags: variant.tags,
    analyzedAt: variant.createdAt,
    ...(selectedSummary?.costEstimate === undefined ? {} : { costEstimate: selectedSummary.costEstimate }),
  };
  return {
    video: {
      ...selectedVideo,
      artifacts: {
        ...selectedVideo.artifacts,
        framePaths: framePaths(variant, selectedVideo),
        transcriptContent: variant.transcript,
        transcriptPath: variant.artifacts.transcriptPath,
        transcriptSegments: variant.selected ? selectedVideo.artifacts.transcriptSegments ?? null : null,
        summary,
        summaryPath: variant.artifacts.summaryPath,
        newFilename: variant.finalName,
      },
    },
    tags: variant.tags,
  };
};
