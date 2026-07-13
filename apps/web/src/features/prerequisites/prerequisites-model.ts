import type { z } from 'zod';

import type { dependencyStatusSchema, doctorOutputSchema } from '@core/contract/index.js';

export type DoctorResult = z.output<typeof doctorOutputSchema>;
export type DependencyStatus = z.output<typeof dependencyStatusSchema>;

const DEPENDENCY_DISPLAY_NAMES: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  whisper: 'Whisper',
  claude: 'Claude CLI',
  'local-ai': 'Local AI (managed Ollama)',
};

export const dependencyDisplayName = (name: string): string =>
  DEPENDENCY_DISPLAY_NAMES[name] ?? name;

export const missingCount = (result: DoctorResult): number =>
  result.dependencies.filter((dependency) => !dependency.available).length;
