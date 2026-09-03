import { z } from 'zod';

import { folderIdSchema } from './global-catalog.js';

export const hiddenScopeSchema = z.enum(['exclude', 'only', 'include']);

export const librarySelectionFilterSchema = z.object({
  query: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  place: z.string().min(1).optional(),
  from: z.iso.date().or(z.iso.datetime()).optional(),
  to: z.iso.date().or(z.iso.datetime()).optional(),
  hasGps: z.boolean().nullable().default(null),
  folderId: folderIdSchema.optional(),
  media: z.enum(['all', 'video', 'photo']).default('all'),
  hideUnavailable: z.boolean().default(false),
  hidden: hiddenScopeSchema.default('exclude'),
}).strict();

export const librarySelectionScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fingerprints'),
    fingerprints: z.array(z.string().min(1)).min(1).max(5000),
  }).strict(),
  z.object({
    kind: z.literal('filter'),
    filter: librarySelectionFilterSchema,
  }).strict(),
  z.object({
    kind: z.literal('person'),
    personId: z.string().min(1),
    skipSharedWithOtherPeople: z.boolean(),
  }).strict(),
]);

export type HiddenScope = z.output<typeof hiddenScopeSchema>;
export type LibrarySelectionFilter = z.output<typeof librarySelectionFilterSchema>;
export type LibrarySelectionScope = z.output<typeof librarySelectionScopeSchema>;
