import type { z } from 'zod';

import type { collectionMediaSchema } from '@core/contract/index.js';

export type LibraryMedia = z.output<typeof collectionMediaSchema>;

export const isLibraryMedia = (value: string): value is LibraryMedia =>
  value === 'all' || value === 'video' || value === 'photo';
