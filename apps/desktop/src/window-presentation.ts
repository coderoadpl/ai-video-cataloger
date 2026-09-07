import { z } from 'zod';

const inactiveFlagSchema = z.literal('1');

export interface WindowPresentation {
  inactive: boolean;
  hideDock: boolean;
}

export const windowPresentation = (
  environmentValue: string | undefined = process.env.AVC_WINDOW_INACTIVE,
  platform: NodeJS.Platform = process.platform,
): WindowPresentation => {
  const inactive = inactiveFlagSchema.safeParse(environmentValue).success;
  return { inactive, hideDock: inactive && platform === 'darwin' };
};
