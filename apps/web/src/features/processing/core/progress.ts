import type { JobOutput } from '@core/client/index.js';

export interface ProgressModel {
  step: string;
  percentage: number;
  stepNumber: number;
  totalSteps: number;
}

export const toProgressModel = (progress: NonNullable<JobOutput['progress']>): ProgressModel => ({
  step: progress.step,
  percentage: progress.percentage ?? 0,
  stepNumber: progress.stepNumber ?? 0,
  totalSteps: progress.totalSteps ?? 5,
});
