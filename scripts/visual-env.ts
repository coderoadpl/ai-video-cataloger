import { z } from 'zod';

const visualEnvironmentSchema = z.enum(['local-darwin', 'ci-macos-15']);

export type VisualEnvironment = z.infer<typeof visualEnvironmentSchema>;

const baselineDirectory: Record<VisualEnvironment, string> = {
  'local-darwin': 'darwin',
  'ci-macos-15': 'ci-macos-15',
};

export const resolveVisualEnvironment = (raw: string | undefined): VisualEnvironment => {
  if (raw === undefined || raw === '') return 'local-darwin';
  const parsed = visualEnvironmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid VISUAL_ENV="${raw}" — expected one of ${visualEnvironmentSchema.options.join(', ')}.`,
    );
  }
  return parsed.data;
};

export const visualSnapshotPathTemplate = (environment: VisualEnvironment): string =>
  `{testDir}/__screenshots__/${baselineDirectory[environment]}/{projectName}/{arg}{ext}`;
