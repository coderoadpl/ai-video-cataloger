import { z } from 'zod';

export const VIDEO_STATUSES = [
  'pending',
  'frames_extracted',
  'audio_extracted',
  'transcribed',
  'analyzed',
  'completed',
  'error',
] as const;

export const videoStatusSchema = z.enum(VIDEO_STATUSES);
export type VideoStatus = z.output<typeof videoStatusSchema>;

export const videoSchema = z.object({
  id: z.number().int().positive(),
  originalPath: z.string().min(1),
  originalName: z.string().min(1),
  newName: z.string().min(1).nullable(),
  fileHash: z.string().min(1),
  status: videoStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  errorMessage: z.string().nullable(),
});

export type Video = z.output<typeof videoSchema>;
