import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

export type PhotoListItem = z.output<typeof photoListItemSchema>;
