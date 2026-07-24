import type { Dictionary } from '../../i18n/dictionary.js';

export const stepLabel = (dictionary: Dictionary, step: string): string =>
  dictionary.processing.stepLabels[step] ?? step.replace(/_/g, ' ');
