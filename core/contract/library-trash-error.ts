import { z } from 'zod';

import { libraryTrashSummarySchema } from './routes.js';

const libraryTrashErrorDetailsSchema = z.object({ summary: libraryTrashSummarySchema });

type LibraryTrashSummary = z.output<typeof libraryTrashSummarySchema>;

export const libraryTrashSummaryOfDetails = (details: unknown): LibraryTrashSummary | null => {
  const parsed = libraryTrashErrorDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data.summary : null;
};
