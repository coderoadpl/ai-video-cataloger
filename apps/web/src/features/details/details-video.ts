import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

/** A scanned video as the details panel consumes it (same shape as `scan`). */
export type DetailsVideo = z.output<typeof scanVideoSchema>;

type IntermediateStatus = 'frames_extracted' | 'audio_extracted' | 'transcribed' | 'analyzed';

/** True for the interrupted, mid-pipeline statuses that the UI labels "Incomplete". */
export const isIncomplete = (status: DetailsVideo['status']): status is IntermediateStatus =>
  status === 'frames_extracted' ||
  status === 'audio_extracted' ||
  status === 'transcribed' ||
  status === 'analyzed';
