import type { z } from 'zod';

import type {
  dependencyStatusSchema,
  doctorOutputSchema,
  readinessOutputSchema,
} from '@core/contract/index.js';

export type DoctorResult = z.output<typeof doctorOutputSchema>;
export type DependencyStatus = z.output<typeof dependencyStatusSchema>;
export type ReadinessResult = z.output<typeof readinessOutputSchema>;

const DEPENDENCY_DISPLAY_NAMES: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  whisper: 'Whisper',
  claude: 'Claude CLI',
  'local-ai': 'Local AI (managed Ollama)',
};

export const dependencyDisplayName = (name: string): string =>
  DEPENDENCY_DISPLAY_NAMES[name] ?? name;

export const missingCount = (doctor: DoctorResult, readiness: ReadinessResult): number =>
  doctor.dependencies.filter((dependency) => !dependency.available).length + readiness.missingPieces.length;
