import type { z } from 'zod';

import type {
  dependencyStatusSchema,
  doctorOutputSchema,
  readinessOutputSchema,
} from '@core/contract/index.js';

import type { Dictionary } from '../../i18n/dictionary.js';

export type DoctorResult = z.output<typeof doctorOutputSchema>;
export type DependencyStatus = z.output<typeof dependencyStatusSchema>;
export type ReadinessResult = z.output<typeof readinessOutputSchema>;

export const dependencyDisplayName = (dictionary: Dictionary, name: string): string =>
  dictionary.prerequisites.dependencyDisplayNames[name] ?? name;

export const missingCount = (doctor: DoctorResult, readiness: ReadinessResult): number =>
  doctor.dependencies.filter((dependency) => !dependency.available).length + readiness.missingPieces.length;
