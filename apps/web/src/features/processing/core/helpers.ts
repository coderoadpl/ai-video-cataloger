import { ApiError } from '@core/client/index.js';
import type { z } from 'zod';
import type { scanVideoSchema } from '@core/contract/index.js';

export type ProcessVideo = Pick<z.output<typeof scanVideoSchema>, 'path' | 'filename' | 'status'>;

export const isPending = (status: ProcessVideo['status']): boolean =>
  status === 'pending' || status === 'not_tracked';

export const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};
