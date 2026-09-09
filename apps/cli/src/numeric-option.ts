import { InvalidArgumentError } from 'commander';
import type { z } from 'zod';

import { gpsBackfillInputSchema } from '@core/contract/index.js';
import { configValueSchema } from '@core/domain/index.js';

const integerOption = (schema: z.ZodNumber) => (value: string): number => {
  const parsed = schema.safeParse(/^-?\d+$/.test(value) ? Number(value) : Number.NaN);
  if (parsed.success) return parsed.data;
  throw new InvalidArgumentError(`Expected an integer in the range ${String(schema.minValue)}..${String(schema.maxValue)}`);
};

export const timeoutOption = integerOption(configValueSchema.shape.timeout.unwrap().out);
export const toleranceMinutesOption = integerOption(gpsBackfillInputSchema.shape.toleranceMinutes.unwrap());
export const maxVisitHoursOption = integerOption(gpsBackfillInputSchema.shape.maxVisitHours.unwrap());
