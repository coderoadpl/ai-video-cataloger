import { z } from 'zod';

export const peoplePairDecisionKindSchema = z.enum(['same', 'different', 'skip']);
export const peoplePairDecisionSourceSchema = z.enum(['user', 'import']);
export const peoplePairDecisionSchema = z.object({
  obsAId: z.string().min(1),
  obsBId: z.string().min(1),
  personAId: z.string().min(1).nullable(),
  personBId: z.string().min(1).nullable(),
  decision: peoplePairDecisionKindSchema,
  decidedAt: z.iso.datetime(),
  source: peoplePairDecisionSourceSchema,
}).strict();
export type PeoplePairDecision = z.output<typeof peoplePairDecisionSchema>;

export const orderObservationPair = (a: string, b: string): [string, string] => a <= b ? [a, b] : [b, a];
export const orderPersonPair = orderObservationPair;
export const PAIR_REVIEW_SKIP_DAYS = 30;

export const pairDecisionIsActive = (decision: PeoplePairDecision, nowIso: string): boolean =>
  decision.decision !== 'skip' || Date.parse(nowIso) < Date.parse(decision.decidedAt) + PAIR_REVIEW_SKIP_DAYS * 86400000;

export const normalizePeoplePairDecision = (input: PeoplePairDecision): PeoplePairDecision => {
  const row = peoplePairDecisionSchema.parse(input);
  return row.obsAId <= row.obsBId ? row : {
    ...row, obsAId: row.obsBId, obsBId: row.obsAId, personAId: row.personBId, personBId: row.personAId,
  };
};
