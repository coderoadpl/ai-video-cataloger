import { z } from 'zod';

/**
 * Single source of truth for the HTTP API shared by the server and every
 * client. Each route carries its method and zod schemas; the server implements
 * them, `core/client` consumes them. No side hand-writes URLs or response types.
 */

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

/**
 * Every route carries its HTTP method so clients discriminate reads from writes
 * at the type level (CQRS partition): safe GETs are queries, unsafe verbs are
 * commands. `core/client` brands its call surface from these methods.
 */
export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
} as const;
