import type { z } from 'zod';

import { WHISPER_MODELS } from '@core/domain/index.js';
import type {
  dependencyStatusSchema,
  localAiTierSchema,
  machineSchema,
  whisperModelListEntrySchema,
} from '@core/contract/index.js';

export type WhisperModelEntry = z.output<typeof whisperModelListEntrySchema>;
export type LocalAiTier = z.output<typeof localAiTierSchema>;
export type Machine = z.output<typeof machineSchema>;
export type DependencyStatus = z.output<typeof dependencyStatusSchema>;

export const whisperDiskUsageMb = (models: readonly WhisperModelEntry[]): number =>
  models
    .filter((model) => model.downloaded)
    .reduce((total, model) => total + WHISPER_MODELS[model.name].sizeMb, 0);

export const formatMb = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

export const tierSupportBadge = (tier: LocalAiTier): { text: string; token: 'completed' | 'error' } => {
  switch (tier.supportLevel) {
    case 'ok':
      return { text: 'Compatible', token: 'completed' };
    case 'insufficient-ram':
      return { text: `Needs ${tier.minTotalMemGB} GB RAM`, token: 'error' };
    case 'unsupported-platform':
      return { text: 'Apple Silicon required', token: 'error' };
  }
};
