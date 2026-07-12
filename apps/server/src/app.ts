import { Hono } from 'hono';

import { API_PATHS, HTTP_STATUS_BY_ERROR_CODE, toEnvelope } from '@core/contract/index.js';
import type { AppError, Result } from '@core/domain/index.js';
import { checkHealth } from '@core/server/index.js';

import type { AppDeps } from './composition.js';

const respond = <T>(result: Result<T, AppError>): Response => {
  const envelope = toEnvelope(result);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  });
};

export const buildApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  app.get(API_PATHS.health, () => respond(checkHealth({ version: deps.version })));
  return app;
};
