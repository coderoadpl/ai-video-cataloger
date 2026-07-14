import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

export type DetailsVideo = z.output<typeof scanVideoSchema>;

type IntermediateStatus = 'frames_extracted' | 'audio_extracted' | 'transcribed' | 'analyzed';

export const isIncomplete = (status: DetailsVideo['status']): status is IntermediateStatus =>
  status === 'frames_extracted' ||
  status === 'audio_extracted' ||
  status === 'transcribed' ||
  status === 'analyzed';
