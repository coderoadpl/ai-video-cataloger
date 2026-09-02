import { type Dictionary } from '../../i18n/dictionary.js';
import { type VariantLabelCopy, type VariantLabelModel } from './core/variant-model.js';

const transcriptionLabel = (copy: VariantLabelCopy, dictionary: Dictionary): string => {
  switch (copy.key) {
    case 'legacySettingsUnknown':
      return dictionary.details.variants.legacySettingsUnknown;
    case 'translation':
      return dictionary.details.variants.translation;
    case 'nativeTranscription':
      return dictionary.details.variants.nativeTranscription;
    case 'localTranscription':
      return dictionary.details.variants.localTranscription(copy.model ?? dictionary.details.unknown);
    case 'apiTranscription':
      return dictionary.details.variants.apiTranscription(copy.model ?? dictionary.details.unknown);
    case 'transcriptionSkipped':
      return dictionary.details.variants.transcriptionSkipped;
  }
};

export const variantLabelText = (model: VariantLabelModel, dictionary: Dictionary): string => {
  if (model.transcription.key === 'legacySettingsUnknown') {
    return dictionary.details.variants.legacySettingsUnknown;
  }
  if (model.transcription.key === 'translation') {
    const modelName = model.analyzer ?? dictionary.details.unknown;
    return `${dictionary.details.variants.translation} / ${modelName}`;
  }
  const analyzer = model.analyzer ?? dictionary.details.unknown;
  const frames = model.frames === null
    ? dictionary.details.variants.noFrames
    : dictionary.details.variants.frameCount(model.frames);
  return dictionary.details.variants.configuredLabel(
    analyzer,
    transcriptionLabel(model.transcription, dictionary),
    frames,
  );
};
